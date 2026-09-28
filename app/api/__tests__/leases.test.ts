/**
 * The lease keeper's state machine against a fake store that keeps leases as
 * MySQL does (mysql/leases.mysql.test.ts checks the real one): one clock for
 * the store and the keepers, moved by hand. Who holds the lease, when a holder
 * gives it up, and that a holder unsure whether it still holds it stops before
 * the lease could pass to another process.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaseKeeper, type Lease, type LeaseStore } from "../services/leases";

const LEASE_MS = 15_000;
const RENEW_MS = 5_000;

type Row = { owner: string | null; generation: number; expiresAt: number | null };

/** Leases as the SQL keeps them: taken when free or lapsed, each taking raising the generation. */
function fakeStore(clock: { now: number }) {
  const rows = new Map<string, Row>();
  const calls: string[] = [];
  const store: LeaseStore = {
    async acquire(name, owner, ms) {
      calls.push(`acquire ${owner}`);
      const row = rows.get(name) ?? { owner: null, generation: 0, expiresAt: null };
      rows.set(name, row);
      if (row.owner !== null && row.expiresAt !== null && row.expiresAt >= clock.now) return null;
      Object.assign(row, { owner, generation: row.generation + 1, expiresAt: clock.now + ms });
      return { name, owner, generation: row.generation };
    },
    async renew(lease, ms) {
      calls.push(`renew ${lease.owner}`);
      const row = rows.get(lease.name);
      if (!row || row.owner !== lease.owner || row.generation !== lease.generation) return false;
      row.expiresAt = clock.now + ms;
      return true;
    },
    async release(lease) {
      calls.push(`release ${lease.owner}`);
      const row = rows.get(lease.name);
      if (!row || row.owner !== lease.owner || row.generation !== lease.generation) return false;
      Object.assign(row, { owner: null, expiresAt: null });
      return true;
    },
  };
  return { store, rows, calls };
}

function setup() {
  const clock = { now: 0 };
  const fake = fakeStore(clock);
  const events: string[] = [];
  const keeper = (owner: string, store: LeaseStore = fake.store) =>
    new LeaseKeeper({
      name: "iot-consumer",
      owner,
      store,
      leaseMs: LEASE_MS,
      renewMs: RENEW_MS,
      now: () => clock.now,
      onAcquired: (l: Lease) => void events.push(`${owner} acquired ${l.generation}`),
      onLost: (l: Lease, why: string) => void events.push(`${owner} lost ${l.generation}: ${why}`),
      log: () => undefined,
    });
  return { clock, ...fake, events, keeper };
}

afterEach(() => vi.useRealTimers());

describe("taking the lease", () => {
  it("of two processes trying at once, exactly one holds it", async () => {
    const { keeper, events } = setup();
    const [a, b] = [keeper("a"), keeper("b")];
    await Promise.all([a.step(), b.step()]);
    expect(events).toEqual(["a acquired 1"]);
    expect(a.current()).toEqual({ name: "iot-consumer", owner: "a", generation: 1 });
    expect(b.current()).toBeNull();
  });

  it("is renewed while held, and the other goes on waiting", async () => {
    const { keeper, clock, rows } = setup();
    const [a, b] = [keeper("a"), keeper("b")];
    await a.step();
    for (let t = 1; t <= 6; t++) {
      clock.now = t * RENEW_MS;
      await a.step();
      await b.step();
    }
    expect(a.current()?.generation).toBe(1);
    expect(b.current()).toBeNull();
    expect(rows.get("iot-consumer")).toMatchObject({ owner: "a", generation: 1, expiresAt: 6 * RENEW_MS + LEASE_MS });
  });

  it("refuses a lease too short to be renewed in time", () => {
    const { store } = fakeStore({ now: 0 });
    expect(() => new LeaseKeeper({ name: "x", owner: "a", store, leaseMs: 10_000, renewMs: 5_000 })).toThrow(/more than two renewals/);
  });
});

describe("losing it", () => {
  it("a holder that stops renewing lets it lapse: another takes it with a higher generation, and the first loses it at its next renewal", async () => {
    const { keeper, clock, events } = setup();
    const [a, b] = [keeper("a"), keeper("b")];
    await a.step();
    // a is frozen: it renews nothing for longer than the lease lasts.
    clock.now = LEASE_MS;
    await b.step();
    expect(events).toEqual(["a acquired 1"]);
    clock.now = LEASE_MS + 1;
    await b.step();
    expect(b.current()?.generation).toBe(2);

    await a.step();
    expect(events).toEqual(["a acquired 1", "b acquired 2", "a lost 1: another process holds it now"]);
    expect(a.current()).toBeNull();
  });

  it("an unconfirmed holder counts itself out before the lease could lapse, even before it tries again", async () => {
    const { keeper, clock } = setup();
    const a = keeper("a");
    await a.step();
    // Sure until one renewal period before the lease can end.
    clock.now = LEASE_MS - RENEW_MS - 1;
    expect(a.current()?.generation).toBe(1);
    clock.now = LEASE_MS - RENEW_MS;
    expect(a.current()).toBeNull();
  });

  it("a renewal that fails leaves it held while the last one still covers it, then gives it up", async () => {
    const { keeper, clock, events, store } = setup();
    let failing = false;
    const flaky: LeaseStore = {
      ...store,
      renew: async (l, ms) => {
        if (failing) throw new Error("connect ECONNREFUSED");
        return store.renew(l, ms);
      },
    };
    const a = keeper("a", flaky);
    await a.step();
    failing = true;
    clock.now = RENEW_MS;
    await a.step();
    expect(a.current()?.generation).toBe(1);
    expect(events).toEqual(["a acquired 1"]);

    clock.now = LEASE_MS - RENEW_MS;
    await a.step();
    expect(events).toEqual(["a acquired 1", "a lost 1: no renewal went through in time, so it may have lapsed"]);

    // Back in touch, it takes the lease again only once it is free: it may not be.
    failing = false;
    clock.now = LEASE_MS - RENEW_MS + 1;
    await a.step();
    expect(a.current()).toBeNull();
    clock.now = LEASE_MS + 1;
    await a.step();
    expect(a.current()?.generation).toBe(2);
  });

  it("a renewal that does not answer is waited for no longer than a renewal period", async () => {
    vi.useFakeTimers();
    const { keeper, clock, events, store } = setup();
    const a = keeper("a", { ...store, renew: () => new Promise<boolean>(() => undefined) });
    await a.step();
    clock.now = LEASE_MS - RENEW_MS;
    const renewing = a.step();
    await vi.advanceTimersByTimeAsync(RENEW_MS);
    await renewing;
    expect(events).toEqual(["a acquired 1", "a lost 1: no renewal went through in time, so it may have lapsed"]);
  });
});

describe("giving it up", () => {
  it("on stopping, stops its work first, then releases the lease, which another takes at once", async () => {
    vi.useFakeTimers();
    const { keeper, events, calls } = setup();
    const [a, b] = [keeper("a"), keeper("b")];
    a.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.current()?.generation).toBe(1);

    await a.stop();
    expect(events).toEqual(["a acquired 1", "a lost 1: this process is stopping"]);
    expect(calls.at(-1)).toBe("release a");
    await b.step();
    expect(b.current()?.generation).toBe(2);
  });

  it("stopped while it was being taken, it hands the lease straight back", async () => {
    vi.useFakeTimers();
    const { keeper, events, rows, store } = setup();
    let taken = () => undefined as void;
    const slow: LeaseStore = {
      ...store,
      acquire: async (name, owner, ms) => {
        const lease = await store.acquire(name, owner, ms);
        await new Promise<void>((resolve) => (taken = () => resolve()));
        return lease;
      },
    };
    const a = keeper("a", slow);
    a.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = a.stop();
    taken();
    await stopping;
    expect(events).toEqual([]);
    expect(rows.get("iot-consumer")).toMatchObject({ owner: null });
  });

  it("renews on its own while started, every renewal period", async () => {
    vi.useFakeTimers();
    const { keeper, calls, clock } = setup();
    const a = keeper("a");
    a.start();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(RENEW_MS);
      clock.now += RENEW_MS;
    }
    expect(calls).toEqual(["acquire a", "renew a", "renew a", "renew a"]);
    await a.stop();
  });
});
