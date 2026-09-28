import os from "node:os";
import { randomUUID } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { iotConnectors, iotMessageSeen, workspaces, type IotConnector } from "@db/schema";
import { getDb } from "../../queries/connection";
import { SecretUnreadableError } from "../../lib/secretBox";
import { isDataError } from "../../lib/mysqlErrors";
import { within } from "../../lib/within";
import { fence, LeaseKeeper, type Lease, type LeaseStore } from "../leases";
import { brokerConfigFrom, envBrokerConfig, unreadableBrokerSecretMessage } from "./brokerConfig";
import { DEFAULT_TOPIC_PATTERN, MqttBrokerAdapter } from "./mqttAdapter";
import { ingestBrokerMessage, readBrokerMessage, type BrokerMessage } from "./iotIngestion";
import { CONNECTED_BROKER_TYPES, type AdapterSnapshot, type BrokerAdapter, type IotBrokerConfig, type MessageOutcome } from "./types";

/**
 * The IoT consumer: the broker connections, run by exactly one process however
 * many run Ontos. Every process with the consumer on (ONTOS_IOT_CONSUMER) tries
 * for the lease `iot-consumer` (services/leases.ts); the one holding it runs a
 * connection per enabled broker connector, and the others run none.
 *
 * The holder reconciles its connections with iot_connectors every 5 s, and at
 * once when this process has just changed a connector: it starts the enabled
 * ones, restarts one whose settings changed (its configVersion moved), and
 * stops the rest. It writes back what it observes (status, counters, errors)
 * to each connector's row, which is what the app shows. Losing the lease stops
 * every connection at once. A message is recorded under the lease it arrived
 * under (iotIngestion.ts's ingestBrokerMessage), so a holder that lost it
 * records nothing, and the broker delivers the message to the new holder.
 */

export const IOT_CONSUMER_LEASE = "iot-consumer";
/** The connector id messages from the IOT_BROKER_URL broker are recorded under: it has no row. */
export const ENV_BROKER_CONNECTOR_ID = 0;
/** How often the holder reconciles its connections with the connectors. */
export const RECONCILE_MS = 5_000;
/** How long a recorded message is recognised when it comes again. */
export const SEEN_RETENTION_DAYS = 7;
/** Pruning: every minute, a thousand rows at a time, ten batches at most per pass. */
const PRUNE_EVERY_MS = 60_000;
const PRUNE_BATCH = 1_000;
const PRUNE_BATCHES = 10;
/** A message that fails this often, in this process, is given up on, so it cannot hold up the rest. */
const MAX_ATTEMPTS = 5;
/** A running connection's observed state is written at least this often, so its observedAt stays fresh. */
const REPORT_EVERY_MS = 30_000;
/** Bounds on the waits of one pass. */
const DB_WAIT_MS = 10_000;
const STOP_WAIT_MS = 3_000;

/**
 * Whether this process runs the consumer (ONTOS_IOT_CONSUMER). Unset, the
 * process's default decides: a worker does; the web app does when it runs jobs
 * itself (development, or ONTOS_EMBEDDED_WORKER=true), since compose.yaml runs
 * a worker beside it. However many run it, only the lease's holder connects.
 */
export function iotConsumerEnabled(byDefault: boolean): boolean {
  const flag = process.env.ONTOS_IOT_CONSUMER;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return byDefault;
}

/** What the holder writes to one connector's row: what it observed. */
export type Observation = {
  connectorId: number;
  /** The settings version the observation is of. */
  version: number;
  status: "connected" | "disconnected" | "error";
  lastError: string | null;
  /** It connected since the last observation: lastConnectedAt becomes now. */
  connected: boolean;
  /** Messages settled, and errors, since the last observation. */
  messages: number;
  errors: number;
};

/** The consumer's view of the database: MySQL, or a fake in tests. */
export type ConnectorStore = {
  /** Every connector, its desired and observed state: a small table, read whole. */
  connectors(): Promise<IotConnector[]>;
  /** The workspace the IOT_BROKER_URL broker writes to. */
  envWorkspaceId(): Promise<number>;
  /** Writes observations, fenced by the lease: false, and nothing written, once it is gone. */
  observe(lease: Lease, observations: Observation[]): Promise<boolean>;
  /** Deletes up to `limit` seen-message rows older than the retention: how many it deleted. */
  pruneSeen(limit: number): Promise<number>;
};

export function mysqlConnectorStore(): ConnectorStore {
  return {
    async connectors() {
      return getDb().select().from(iotConnectors).orderBy(iotConnectors.id);
    },

    async envWorkspaceId() {
      const configured = Number(process.env.IOT_WORKSPACE_ID);
      if (Number.isInteger(configured) && configured > 0) return configured;
      const [first] = await getDb().select({ id: workspaces.id }).from(workspaces).orderBy(workspaces.id).limit(1);
      return first?.id ?? 1;
    },

    observe(lease, observations) {
      return getDb().transaction(
        async (tx) => {
          if (!(await fence(tx, lease))) return false;
          for (const o of [...observations].sort((a, b) => a.connectorId - b.connectorId)) {
            await tx
              .update(iotConnectors)
              .set({
                status: o.status,
                lastError: o.lastError,
                ...(o.connected ? { lastConnectedAt: sql`now()` } : {}),
                messageCount: sql`${iotConnectors.messageCount} + ${o.messages}`,
                errorCount: sql`${iotConnectors.errorCount} + ${o.errors}`,
                observedVersion: o.version,
                consumerOwner: lease.owner,
                observedAt: sql`now(3)`,
                // An observation is not an edit: updatedAt keeps the last one.
                updatedAt: sql`${iotConnectors.updatedAt}`,
              })
              .where(eq(iotConnectors.id, o.connectorId));
          }
          return true;
        },
        { isolationLevel: "read committed" },
      );
    },

    pruneSeen(limit) {
      // READ COMMITTED: the range it deletes takes no gap lock, which would hold
      // up the consumer's inserts of new rows.
      return getDb().transaction(
        async (tx) => {
          const [res] = await tx
            .delete(iotMessageSeen)
            .where(lt(iotMessageSeen.seenAt, sql`now() - interval ${SEEN_RETENTION_DAYS} day`))
            .orderBy(iotMessageSeen.seenAt)
            .limit(limit);
          return res.affectedRows;
        },
        { isolationLevel: "read committed" },
      );
    },
  };
}

/** What the consumer hands the connection it starts for one connector. */
export type AdapterSpec = {
  connectorId: number;
  config: IotBrokerConfig;
  handle: (message: { topic: string; payload: Buffer }) => Promise<MessageOutcome>;
  canConnect: () => boolean;
  onFenced: () => void;
};

export type IotConsumerOptions = {
  /** This process, as the lease names its holder. */
  owner?: string;
  leases?: LeaseStore;
  leaseMs?: number;
  renewMs?: number;
  reconcileMs?: number;
  store?: ConnectorStore;
  /** Makes one connection: MQTT, or a fake in tests. */
  adapter?: (spec: AdapterSpec) => BrokerAdapter;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** A monotonic clock, in ms. */
  now?: () => number;
};

type Counts = { messages: number; errors: number; connections: number };
const NONE: Counts = { messages: 0, errors: 0, connections: 0 };

type Running = {
  version: number;
  /** The lease it runs under: messages are recorded under this generation or not at all. */
  lease: Lease;
  adapter: BrokerAdapter;
  /** Its counters as last written to its connector's row. */
  reported: Counts;
  /** When they were (this process's clock). */
  reportedAt: number;
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const isConnectedBroker = (row: IotConnector) => CONNECTED_BROKER_TYPES.includes(row.brokerType);

export class IotConsumer {
  readonly owner: string;
  private readonly keeper: LeaseKeeper;
  private readonly store: ConnectorStore;
  private readonly makeAdapter: (spec: AdapterSpec) => BrokerAdapter;
  private readonly reconcileMs: number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: (line: string) => void;
  private readonly now: () => number;

  /** The connections this process runs, by connector id (0: the IOT_BROKER_URL broker). */
  private readonly running = new Map<number, Running>();
  /** Counts of connections stopped since, still to be written to their rows. */
  private readonly banked = new Map<number, Counts>();
  /** Enabled connectors that could not be started, and why, at their version. */
  private readonly unstartable = new Map<number, { version: number; error: string }>();
  /** A generation a message found gone: nothing starts under it again. */
  private fencedOut: number | null = null;
  private nextPruneAt = 0;
  private lastWarning: string | null = null;

  private state: "idle" | "running" | "stopping" | "stopped" = "idle";
  private loopDone: Promise<void> = Promise.resolve();
  private wake: (() => void) | null = null;
  private nudged = false;

  constructor(opts: IotConsumerOptions = {}) {
    this.owner = opts.owner ?? `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.store = opts.store ?? mysqlConnectorStore();
    this.reconcileMs = opts.reconcileMs ?? RECONCILE_MS;
    this.env = opts.env ?? process.env;
    this.log = opts.log ?? ((line) => console.log(`[iot] ${line}`));
    this.now = opts.now ?? (() => performance.now());
    this.makeAdapter =
      opts.adapter ?? ((spec) => new MqttBrokerAdapter({ ...spec, log: (line) => this.log(`${spec.connectorId ? `connector ${spec.connectorId}` : "IOT_BROKER_URL"}: ${line}`) }));
    this.keeper = new LeaseKeeper({
      name: IOT_CONSUMER_LEASE,
      owner: this.owner,
      store: opts.leases,
      leaseMs: opts.leaseMs,
      renewMs: opts.renewMs,
      onAcquired: () => this.nudge(),
      // Every connection stops at once, before the lease can pass to another process.
      onLost: (_lease, why) => this.stopAll(`this process lost the IoT lease: ${why}`),
      log: (line) => this.log(`lease: ${line}`),
      now: this.now,
    });
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "running";
    this.keeper.start();
    this.loopDone = this.loop();
  }

  /** Stops every connection, then gives the lease up so another process takes it at once. */
  async stop(): Promise<void> {
    if (this.state !== "running") return;
    this.state = "stopping";
    this.wake?.();
    // The keeper stops the connections (onLost) before it releases the lease.
    // A pass still under way starts nothing without the lease, and its writes
    // are fenced, so it need not be waited for first.
    await this.keeper.stop();
    await this.stopAll("this process is stopping");
    await within(this.loopDone, DB_WAIT_MS, "finishing the reconciliation under way").catch(() => undefined);
    this.state = "stopped";
  }

  /** Reconciles now rather than at the next pass: a connector has just changed, or the lease was taken. */
  nudge(): void {
    // A pass under way may have read the connectors before the change: another follows it.
    this.nudged = true;
    this.wake?.();
  }

  /** What this process is doing, for its health endpoint. */
  status(): { owner: string; holdsLease: boolean; generation: number | null; connections: number } {
    const lease = this.keeper.current();
    return { owner: this.owner, holdsLease: lease !== null, generation: lease?.generation ?? null, connections: this.running.size };
  }

  /** One turn of the lease (tests drive it, the keeper's loop otherwise). */
  keepLease(): Promise<void> {
    return this.keeper.step();
  }

  /**
   * One reconciliation, when this process holds the lease: connections
   * started, restarted and stopped to match the connectors, then what they
   * observed written back. A process without the lease runs nothing.
   */
  async reconcile(): Promise<void> {
    const lease = this.leaseHeld();
    if (!lease) {
      if (this.running.size) await this.stopAll("this process does not hold the IoT lease");
      return;
    }
    let rows: IotConnector[];
    try {
      rows = await within(this.store.connectors(), DB_WAIT_MS, "reading the connectors");
    } catch (err) {
      this.warn(`could not read the connectors, so the connections stay as they are: ${message(err)}`);
      return;
    }

    // What should run: each enabled broker connector, at its settings version;
    // and the broker IOT_BROKER_URL names, if it does.
    const wanted = new Map<number, { version: number; row: IotConnector | null }>();
    for (const row of rows) if (row.enabled && isConnectedBroker(row)) wanted.set(row.id, { version: row.configVersion, row });
    if (this.env.IOT_BROKER_URL) wanted.set(ENV_BROKER_CONNECTOR_ID, { version: 1, row: null });

    for (const [id, run] of [...this.running]) {
      const want = wanted.get(id);
      if (want && want.version === run.version && run.lease.generation === lease.generation) continue;
      await this.stopOne(id, run, want ? "its settings changed" : "it is no longer enabled");
    }
    for (const [id, want] of wanted) {
      if (this.running.has(id)) continue;
      let config: IotBrokerConfig | null;
      try {
        config = want.row
          ? brokerConfigFrom(want.row)
          : envBrokerConfig(this.env, await within(this.store.envWorkspaceId(), DB_WAIT_MS, "finding the IOT_BROKER_URL workspace"));
      } catch (err) {
        const error = err instanceof SecretUnreadableError ? unreadableBrokerSecretMessage(err) : `Could not start: ${message(err)}`;
        if (this.unstartable.get(id)?.error !== error) this.log(`connector ${id} not started: ${error}`);
        this.unstartable.set(id, { version: want.version, error });
        continue;
      }
      this.unstartable.delete(id);
      // Checked again right before each start: the lease may have gone meanwhile.
      if (!this.holds(lease)) return;
      if (config) this.startOne(id, want.version, lease, config);
    }
    for (const id of this.unstartable.keys()) if (!wanted.has(id)) this.unstartable.delete(id);
    for (const id of this.banked.keys()) if (!rows.some((r) => r.id === id)) this.banked.delete(id);

    await this.report(lease, rows);
    await this.prune();
    this.lastWarning = null;
  }

  private leaseHeld(): Lease | null {
    const lease = this.keeper.current();
    return lease && lease.generation !== this.fencedOut ? lease : null;
  }

  /** This process surely holds `lease`, as it was when a connection started under it. */
  private holds(lease: Lease): boolean {
    return this.leaseHeld()?.generation === lease.generation;
  }

  private startOne(connectorId: number, version: number, lease: Lease, config: IotBrokerConfig): void {
    const adapter = this.makeAdapter({
      connectorId,
      config,
      handle: this.handler(connectorId, config, lease),
      canConnect: () => this.holds(lease),
      onFenced: () => void this.fenced(lease),
    });
    this.running.set(connectorId, { version, lease, adapter, reported: { ...NONE }, reportedAt: 0 });
    adapter.start();
  }

  private async stopOne(connectorId: number, run: Running, why: string): Promise<void> {
    this.running.delete(connectorId);
    this.bank(connectorId, run, run.adapter.snapshot());
    this.log(`stopping connector ${connectorId}'s connection: ${why}`);
    await within(run.adapter.stop(), STOP_WAIT_MS, "stopping a broker connection").catch(() => undefined);
  }

  /** Stops every connection at once. */
  private async stopAll(why: string): Promise<void> {
    if (!this.running.size) return;
    const all = [...this.running];
    this.running.clear();
    this.banked.clear();
    this.unstartable.clear();
    this.log(`stopping ${all.length} broker connection(s): ${why}`);
    await Promise.all(all.map(([, run]) => within(run.adapter.stop(), STOP_WAIT_MS, "stopping a broker connection").catch(() => undefined)));
  }

  /** A message found the lease gone before the lease keeper did: stop everything now. */
  private async fenced(lease: Lease): Promise<void> {
    if (this.fencedOut === lease.generation) return;
    this.fencedOut = lease.generation;
    await this.stopAll(`a message found the IoT lease (generation ${lease.generation}) in other hands`);
  }

  private bank(connectorId: number, run: Running, snap: AdapterSnapshot): void {
    const banked = this.banked.get(connectorId) ?? { ...NONE };
    banked.messages += snap.messages - run.reported.messages;
    banked.errors += snap.errors - run.reported.errors;
    banked.connections += snap.connections - run.reported.connections;
    this.banked.set(connectorId, banked);
  }

  /** How one broker message is recorded, for the connection under `lease`. */
  private handler(connectorId: number, config: IotBrokerConfig, lease: Lease): AdapterSpec["handle"] {
    const failures = new Map<string, number>();
    const pattern = config.topicPattern || DEFAULT_TOPIC_PATTERN;
    const from = { lease, connectorId, workspaceId: config.workspaceId, source: `mqtt:${config.name}`, deviceMappings: config.deviceMappings };
    return async ({ topic, payload }) => {
      // A process unsure that it still holds the lease records nothing, and
      // acknowledges nothing: the connection waits until it is sure again, or
      // stops with the lease. Only the database says the lease is gone (fenced).
      if (!this.holds(lease)) return { kind: "retry", error: "this process is not sure it still holds the IoT lease" };
      let msg: BrokerMessage;
      try {
        msg = readBrokerMessage(topic, payload, pattern);
      } catch (err) {
        return { kind: "rejected", error: message(err) };
      }
      try {
        const outcome = await ingestBrokerMessage(from, msg);
        failures.delete(msg.fingerprint);
        return outcome === "fenced" ? { kind: "fenced" } : { kind: "recorded" };
      } catch (err) {
        const why = message(err);
        if (isDataError(err)) return { kind: "rejected", error: why };
        const attempts = (failures.get(msg.fingerprint) ?? 0) + 1;
        failures.delete(msg.fingerprint);
        if (attempts >= MAX_ATTEMPTS) return { kind: "rejected", error: `not recorded in ${attempts} attempts: ${why}` };
        failures.set(msg.fingerprint, attempts);
        if (failures.size > 1000) failures.delete(failures.keys().next().value as string);
        return { kind: "retry", error: why };
      }
    };
  }

  /** Writes what the connections observed to their connectors' rows, where it differs. */
  private async report(lease: Lease, rows: IotConnector[]): Promise<void> {
    const now = this.now();
    const observations: Observation[] = [];
    const written: { run: Running; snap: AdapterSnapshot }[] = [];
    for (const row of rows) {
      if (!isConnectedBroker(row)) continue;
      const run = this.running.get(row.id);
      const banked = this.banked.get(row.id) ?? NONE;
      let o: Omit<Observation, "connected" | "messages" | "errors">;
      let counts: Counts = banked;
      if (run) {
        const snap = run.adapter.snapshot();
        // Not connected yet, nor failed: the change stays pending until it has.
        if (snap.status === "connecting" && snap.connections === 0 && snap.errors === 0) continue;
        o = {
          connectorId: row.id,
          version: run.version,
          status: snap.status === "connected" ? "connected" : snap.lastError ? "error" : "disconnected",
          lastError: snap.lastError,
        };
        counts = {
          messages: banked.messages + snap.messages - run.reported.messages,
          errors: banked.errors + snap.errors - run.reported.errors,
          connections: banked.connections + snap.connections - run.reported.connections,
        };
        written.push({ run, snap });
      } else if (row.enabled) {
        const failure = this.unstartable.get(row.id);
        if (!failure) continue;
        o = { connectorId: row.id, version: failure.version, status: "error", lastError: failure.error };
      } else {
        o = { connectorId: row.id, version: row.configVersion, status: "disconnected", lastError: null };
      }
      const same =
        row.status === o.status && (row.lastError ?? null) === o.lastError && row.observedVersion === o.version && row.consumerOwner === this.owner;
      const quiet = counts.messages === 0 && counts.errors === 0 && counts.connections === 0;
      const due = run !== undefined && now - run.reportedAt >= REPORT_EVERY_MS;
      if (same && quiet && !due) continue;
      observations.push({ ...o, connected: counts.connections > 0, messages: counts.messages, errors: counts.errors });
    }
    if (!observations.length) return;
    let held: boolean;
    try {
      held = await within(this.store.observe(lease, observations), DB_WAIT_MS, "writing what the connections observed");
    } catch (err) {
      this.warn(`could not write what the connections observed: ${message(err)}`);
      return;
    }
    if (!held) {
      await this.fenced(lease);
      return;
    }
    for (const o of observations) this.banked.delete(o.connectorId);
    for (const { run, snap } of written) {
      run.reported = { messages: snap.messages, errors: snap.errors, connections: snap.connections };
      run.reportedAt = now;
    }
  }

  /** Deletes messages seen longer ago than the retention, in bounded batches. */
  private async prune(): Promise<void> {
    const now = this.now();
    if (now < this.nextPruneAt) return;
    let deleted = 0;
    let more = false;
    try {
      for (let i = 0; i < PRUNE_BATCHES && (this.state === "idle" || this.state === "running"); i++) {
        const n = await within(this.store.pruneSeen(PRUNE_BATCH), DB_WAIT_MS, "pruning seen messages");
        deleted += n;
        more = n >= PRUNE_BATCH;
        if (!more) break;
      }
    } catch (err) {
      this.warn(`could not prune seen messages: ${message(err)}`);
    }
    // A backlog is worked off a pass at a time, the rest a minute apart.
    this.nextPruneAt = more ? 0 : now + PRUNE_EVERY_MS;
    if (deleted) this.log(`forgot ${deleted} message(s) seen more than ${SEEN_RETENTION_DAYS} days ago`);
  }

  private warn(line: string): void {
    if (line !== this.lastWarning) this.log(line);
    this.lastWarning = line;
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
      this.nudged = false;
      try {
        await this.reconcile();
      } catch (err) {
        this.warn(`reconciliation failed: ${message(err)}`);
      }
      if (this.state !== "running") break;
      if (!this.nudged) await this.idle(this.reconcileMs);
    }
  }
}

// A dev-server reload re-runs the module that starts the consumer; the one
// before must stop first, releasing the lease and closing its connections.
const holder = globalThis as typeof globalThis & { __ontosIotConsumer?: IotConsumer };

export async function startIotConsumer(opts?: IotConsumerOptions): Promise<IotConsumer> {
  await holder.__ontosIotConsumer?.stop();
  const consumer = new IotConsumer(opts);
  holder.__ontosIotConsumer = consumer;
  consumer.start();
  return consumer;
}

/** The consumer this process runs, if it runs one. */
export function localIotConsumer(): IotConsumer | undefined {
  return holder.__ontosIotConsumer;
}

/** Tells this process's consumer, if it runs one, that a connector has just changed. */
export function nudgeIotConsumer(): void {
  holder.__ontosIotConsumer?.nudge();
}
