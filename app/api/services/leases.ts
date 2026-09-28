import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { leases } from "@db/schema";
import { getDb } from "../queries/connection";
import { within } from "../lib/within";

/**
 * Leases in MySQL, for work exactly one process may do at a time however many
 * run: the IoT consumer holds `iot-consumer`. A process acquires a lease for a
 * while and renews it long before that runs out; a process that stops renewing
 * (it died, froze, or lost the database) lets it lapse, and another takes it.
 * As in the job queue, every time is the database's now(), so hosts whose
 * clocks disagree never disagree about a lease, and every write is conditional
 * on the caller holding it.
 *
 * Every acquisition raises the lease's generation, a fencing token. Work done
 * under a lease checks it in the work's own transaction (fence): a holder that
 * lost the lease, still busy with work it began before, finds its generation
 * gone and writes nothing. The check keeps the lease's row locked, shared,
 * until the transaction ends, so the lease cannot change hands in between.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A lease as its holder knows it: whose, and which acquisition. */
export type Lease = { name: string; owner: string; generation: number };

/** Where leases are kept, as a process that wants one sees it: MySQL, or a fake in tests. */
export type LeaseStore = {
  /** Takes the lease for `ms` when nobody holds it or its holder's time is up; null otherwise. */
  acquire(name: string, owner: string, ms: number): Promise<Lease | null>;
  /** Extends a held lease to `ms` from now. False: it is not this holder's any more. */
  renew(lease: Lease, ms: number): Promise<boolean>;
  /** Gives a held lease up, so that another process need not wait for it to lapse. */
  release(lease: Lease): Promise<boolean>;
};

const heldAs = (lease: Lease) =>
  and(eq(leases.name, lease.name), eq(leases.owner, lease.owner), eq(leases.generation, lease.generation));

/** `ms` after the database's now, to the millisecond. */
const fromNow = (ms: number) => sql`now(3) + interval ${Math.max(0, Math.round(ms)) * 1000} microsecond`;

/** The leases table, through `db` (another pool, in tests). */
export function mysqlLeases(db: () => Db = getDb): LeaseStore {
  return {
    async acquire(name, owner, ms) {
      // A lease that someone holds is left alone, and unlocked: most attempts
      // come from processes that do not hold it, while the holder fences its
      // work on the same row.
      const [row] = await db()
        .select({ free: sql<number>`(${leases.owner} is null or ${leases.expiresAt} is null or ${leases.expiresAt} < now(3))` })
        .from(leases)
        .where(eq(leases.name, name));
      if (row && !Number(row.free)) return null;
      // Its row, made the first time. An upsert, which locks the one row it finds:
      // INSERT IGNORE's duplicate check would leave a shared lock that a second
      // statement then has to upgrade, and two sessions doing so deadlock.
      if (!row) await db().insert(leases).values({ name }).onDuplicateKeyUpdate({ set: { name: sql`${leases.name}` } });
      const [res] = await db()
        .update(leases)
        .set({
          owner,
          // The new generation comes back as the statement's insert id.
          generation: sql`last_insert_id(${leases.generation} + 1)`,
          expiresAt: fromNow(ms),
          acquiredAt: sql`now(3)`,
          renewedAt: sql`now(3)`,
        })
        .where(and(eq(leases.name, name), or(isNull(leases.owner), isNull(leases.expiresAt), lt(leases.expiresAt, sql`now(3)`))));
      if (res.affectedRows !== 1) return null;
      return { name, owner, generation: Number(res.insertId) };
    },

    async renew(lease, ms) {
      const [res] = await db()
        .update(leases)
        .set({ expiresAt: fromNow(ms), renewedAt: sql`now(3)` })
        .where(heldAs(lease));
      return res.affectedRows === 1;
    },

    async release(lease) {
      const [res] = await db().update(leases).set({ owner: null, expiresAt: null }).where(heldAs(lease));
      return res.affectedRows === 1;
    },
  };
}

/**
 * Inside a transaction: true while `lease` is still held as it was acquired,
 * false once it has lapsed into other hands (or was released). The lease's row
 * stays locked until the transaction ends, so whatever the transaction writes
 * commits under the lease or not at all: a process taking the lease over waits
 * for it. Work that finds the lease gone must roll back and stop.
 */
export async function fence(tx: Tx, lease: Lease): Promise<boolean> {
  const rows = await tx.select({ name: leases.name }).from(leases).where(heldAs(lease)).for("share");
  return rows.length > 0;
}

/** How long a lease lasts unrenewed, and how often its holder renews it. */
export const LEASE_MS = 15_000;
export const RENEW_MS = 5_000;

export type LeaseKeeperOptions = {
  name: string;
  owner: string;
  store?: LeaseStore;
  leaseMs?: number;
  /** How often the holder renews, and a process without the lease tries for it. */
  renewMs?: number;
  /** Awaited when this process takes the lease. */
  onAcquired?: (lease: Lease) => void | Promise<void>;
  /** Awaited when it loses the lease or gives it up: stop all the work done under it. */
  onLost?: (lease: Lease, why: string) => void | Promise<void>;
  log?: (line: string) => void;
  /** A monotonic clock, in ms. */
  now?: () => number;
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Keeps one lease for this process: tries for it while another holds it,
 * renews it while this one does, and says when it is gained or lost.
 *
 * A renewal that finds the lease in other hands loses it at once. A renewal
 * that fails, or does not answer, leaves the holder unsure: it goes on holding
 * only while its last confirmed renewal still covers it, less one renewal's
 * worth of margin, then gives the lease up. Every wait on the database is
 * bounded, so an unsure holder stops its work before the lease can lapse to
 * another process: with the defaults, its last 5 of 15 seconds are left unused.
 */
export class LeaseKeeper {
  readonly name: string;
  readonly owner: string;
  private readonly store: LeaseStore;
  private readonly leaseMs: number;
  private readonly renewMs: number;
  private readonly onAcquired: (lease: Lease) => void | Promise<void>;
  private readonly onLost: (lease: Lease, why: string) => void | Promise<void>;
  private readonly log: (line: string) => void;
  private readonly now: () => number;

  private lease: Lease | null = null;
  /** Until when, on this process's clock, the lease cannot have lapsed. */
  private sureUntil = 0;
  private state: "idle" | "running" | "stopping" | "stopped" = "idle";
  private loopDone: Promise<void> = Promise.resolve();
  private wake: (() => void) | null = null;

  constructor(opts: LeaseKeeperOptions) {
    this.name = opts.name;
    this.owner = opts.owner;
    this.store = opts.store ?? mysqlLeases();
    this.leaseMs = opts.leaseMs ?? LEASE_MS;
    this.renewMs = opts.renewMs ?? RENEW_MS;
    if (!(this.renewMs > 0 && this.leaseMs > 2 * this.renewMs)) {
      throw new Error(`a lease must last more than two renewals (${this.leaseMs} ms, renewed every ${this.renewMs} ms)`);
    }
    this.onAcquired = opts.onAcquired ?? (() => undefined);
    this.onLost = opts.onLost ?? (() => undefined);
    this.log = opts.log ?? ((line) => console.log(`[lease ${this.name}] ${line}`));
    this.now = opts.now ?? (() => performance.now());
  }

  /**
   * The lease, while this process is sure it holds it: taken or renewed
   * recently enough that it cannot have lapsed. Null otherwise, and as soon as
   * a failed renewal leaves the holder unsure, before it has given up.
   */
  current(): Lease | null {
    return this.lease && this.now() < this.sureUntil ? this.lease : null;
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "running";
    this.loopDone = this.loop();
  }

  /** Stops trying. A lease held is given up, its work stopped first, and released. */
  async stop(): Promise<void> {
    if (this.ending()) return;
    this.state = "stopping";
    this.wake?.();
    await this.loopDone;
    const lease = this.lease;
    if (lease) {
      await this.lose(lease, "this process is stopping");
      try {
        await within(this.store.release(lease), this.renewMs, "releasing the lease");
      } catch (err) {
        this.log(`could not release it: ${message(err)}; it lapses on its own`);
      }
    }
    this.state = "stopped";
  }

  /** One turn: renew the lease held, or try to take it. The loop takes one per renewal period. */
  async step(): Promise<void> {
    if (this.ending()) return;
    if (this.lease) await this.renew(this.lease);
    else await this.acquire();
  }

  private ending(): boolean {
    return this.state === "stopping" || this.state === "stopped";
  }

  private async acquire(): Promise<void> {
    const sent = this.now();
    let lease: Lease | null;
    try {
      lease = await within(this.store.acquire(this.name, this.owner, this.leaseMs), this.renewMs, "taking the lease");
    } catch (err) {
      this.log(`could not try for it: ${message(err)}`);
      return;
    }
    if (!lease) return;
    // Stopped while it was being taken: handed straight back.
    if (this.ending()) {
      await within(this.store.release(lease), this.renewMs, "releasing the lease").catch(() => undefined);
      return;
    }
    this.lease = lease;
    this.sureUntil = sent + this.leaseMs - this.renewMs;
    this.log(`${this.owner} holds it (generation ${lease.generation})`);
    await this.call(() => this.onAcquired(lease), "onAcquired");
  }

  private async renew(lease: Lease): Promise<void> {
    const sent = this.now();
    let held: boolean | null;
    try {
      held = await within(this.store.renew(lease, this.leaseMs), this.renewMs, "renewing the lease");
    } catch (err) {
      held = null;
      this.log(`could not renew it: ${message(err)}`);
    }
    if (this.lease !== lease) return;
    if (held === true) {
      this.sureUntil = Math.max(this.sureUntil, sent + this.leaseMs - this.renewMs);
    } else if (held === false) {
      await this.lose(lease, "another process holds it now");
    } else if (this.now() >= this.sureUntil) {
      await this.lose(lease, "no renewal went through in time, so it may have lapsed");
    }
  }

  private async lose(lease: Lease, why: string): Promise<void> {
    if (this.lease !== lease) return;
    this.lease = null;
    this.sureUntil = 0;
    this.log(`${this.owner} lost it (generation ${lease.generation}): ${why}`);
    await this.call(() => this.onLost(lease, why), "onLost");
  }

  private async call(fn: () => void | Promise<void>, what: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.log(`${what} failed: ${message(err)}`);
    }
  }

  private idle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  private async loop(): Promise<void> {
    while (this.state === "running") {
      await this.step();
      if (this.state !== "running") break;
      await this.idle(this.renewMs);
    }
  }
}
