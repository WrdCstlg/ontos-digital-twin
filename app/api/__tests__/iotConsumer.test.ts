/**
 * The IoT consumer's reconciliation against fake connectors, connections and
 * leases: what runs is what the connectors ask for, and only in the process
 * that holds the lease; a settings change restarts a connection; losing the
 * lease stops them all at once; what they observe is written back; and a
 * message is recorded under the lease its connection started with, or not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IotConnector } from "@db/schema";
import { env } from "../lib/env";
import { sealSecret, secretContext } from "../lib/secretBox";
import { IotConsumer, iotConsumerEnabled, type AdapterSpec, type ConnectorStore, type Observation } from "../services/iot/iotConsumer";
import { ingestBrokerMessage } from "../services/iot/iotIngestion";
import type { Lease, LeaseStore } from "../services/leases";
import type { AdapterSnapshot, BrokerAdapter } from "../services/iot/types";

vi.mock("../services/iot/iotIngestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/iot/iotIngestion")>()),
  ingestBrokerMessage: vi.fn(async () => "recorded"),
}));

const at = new Date("2026-01-01T00:00:00Z");
const row = (id: number, over: Partial<IotConnector> = {}): IotConnector => ({
  id,
  workspaceId: 1,
  name: `Broker ${id}`,
  brokerType: "mqtt",
  endpointUrl: `mqtt://broker-${id}.test:1883`,
  topicPattern: null,
  clientId: null,
  authType: "none",
  configJson: {},
  enabled: true,
  configVersion: 1,
  status: "disconnected",
  lastConnectedAt: null,
  messageCount: 0,
  errorCount: 0,
  lastError: null,
  observedVersion: null,
  consumerOwner: null,
  observedAt: null,
  createdAt: at,
  updatedAt: at,
  ...over,
});

type FakeAdapter = BrokerAdapter & { spec: AdapterSpec; started: boolean; stopped: boolean; snap: AdapterSnapshot };

function world(opts: { env?: NodeJS.ProcessEnv; now?: () => number } = {}) {
  let rows: IotConnector[] = [];
  const written: Observation[][] = [];
  const adapters: FakeAdapter[] = [];
  let observeHolds = true;
  let lease = { owner: null as string | null, generation: 0 };
  const leases: LeaseStore = {
    acquire: async (name, owner) => {
      if (lease.owner !== null) return null;
      lease = { owner, generation: lease.generation + 1 };
      return { name, owner, generation: lease.generation };
    },
    renew: async (l) => l.owner === lease.owner && l.generation === lease.generation,
    release: async (l) => {
      if (l.owner !== lease.owner || l.generation !== lease.generation) return false;
      lease.owner = null;
      return true;
    },
  };
  const store: ConnectorStore = {
    connectors: async () => rows.map((r) => ({ ...r })),
    envWorkspaceId: async () => 3,
    observe: async (_l: Lease, observations: Observation[]) => {
      if (!observeHolds) return false;
      written.push(observations);
      for (const o of observations) {
        const r = rows.find((x) => x.id === o.connectorId);
        if (r) Object.assign(r, { status: o.status, lastError: o.lastError, observedVersion: o.version, consumerOwner: "worker-a" });
      }
      return true;
    },
    pruneSeen: vi.fn(async () => 0),
  };
  const consumer = new IotConsumer({
    owner: "worker-a",
    leases,
    store,
    env: opts.env ?? {},
    now: opts.now,
    log: () => undefined,
    adapter: (spec) => {
      const a: FakeAdapter = {
        spec,
        started: false,
        stopped: false,
        snap: { status: "connecting", messages: 0, errors: 0, lastError: null, connections: 0 },
        start: () => void (a.started = true),
        stop: async () => void (a.stopped = true),
        snapshot: () => ({ ...a.snap }),
      };
      adapters.push(a);
      return a;
    },
  });
  return {
    consumer,
    store,
    written,
    adapters,
    setRows: (r: IotConnector[]) => (rows = r),
    rows: () => rows,
    /** Another process takes the lease, as if this one's lapsed. */
    takeover: () => void (lease = { owner: "worker-b", generation: lease.generation + 1 }),
    releaseForeign: () => void (lease.owner = null),
    refuseObservations: () => void (observeHolds = false),
    live: () => adapters.filter((a) => !a.stopped),
  };
}

const connected = (a: FakeAdapter, over: Partial<AdapterSnapshot> = {}) => Object.assign(a.snap, { status: "connected", connections: 1, ...over });

beforeEach(() => vi.mocked(ingestBrokerMessage).mockClear());
afterEach(() => vi.unstubAllEnvs());

describe("where the consumer runs", () => {
  it("ONTOS_IOT_CONSUMER decides, and unset, the process's default does", () => {
    vi.stubEnv("ONTOS_IOT_CONSUMER", "true");
    expect(iotConsumerEnabled(false)).toBe(true);
    vi.stubEnv("ONTOS_IOT_CONSUMER", "false");
    expect(iotConsumerEnabled(true)).toBe(false);
    vi.stubEnv("ONTOS_IOT_CONSUMER", undefined);
    expect([iotConsumerEnabled(true), iotConsumerEnabled(false)]).toEqual([true, false]);
  });
});

describe("reconciling connections with the connectors", () => {
  it("a process without the lease runs nothing", async () => {
    const w = world();
    w.setRows([row(5)]);
    await w.consumer.reconcile();
    expect(w.adapters).toEqual([]);
    expect(w.written).toEqual([]);
  });

  it("the holder runs every enabled broker connector, and none of the rest", async () => {
    const w = world();
    w.setRows([row(5), row(6, { enabled: false }), row(7, { brokerType: "webhook" })]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();

    expect(w.adapters.map((a) => [a.spec.connectorId, a.started])).toEqual([[5, true]]);
    expect(w.adapters[0].spec.config).toMatchObject({ id: 5, workspaceId: 1, endpointUrl: "mqtt://broker-5.test:1883" });
    // The disabled one is reported as such; the one connecting is not yet reported.
    expect(w.written).toEqual([[{ connectorId: 6, version: 1, status: "disconnected", lastError: null, connected: false, messages: 0, errors: 0 }]]);
    expect(w.consumer.status()).toMatchObject({ owner: "worker-a", holdsLease: true, generation: 1, connections: 1 });
  });

  it("reports a connection once it settles, then only what changed", async () => {
    const w = world();
    w.setRows([row(5)]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    connected(w.adapters[0], { messages: 3 });
    await w.consumer.reconcile();
    expect(w.written.at(-1)).toEqual([{ connectorId: 5, version: 1, status: "connected", lastError: null, connected: true, messages: 3, errors: 0 }]);

    await w.consumer.reconcile();
    expect(w.written).toHaveLength(1);

    connected(w.adapters[0], { messages: 5, errors: 1, lastError: "Message processing error: bad" });
    await w.consumer.reconcile();
    expect(w.written.at(-1)).toEqual([
      { connectorId: 5, version: 1, status: "connected", lastError: "Message processing error: bad", connected: false, messages: 2, errors: 1 },
    ]);
  });

  it("restarts a connection whose settings changed, and keeps counting what the old one saw", async () => {
    const w = world();
    w.setRows([row(5)]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    connected(w.adapters[0], { messages: 2 });
    await w.consumer.reconcile();
    connected(w.adapters[0], { messages: 4 });

    w.rows()[0].configVersion = 2;
    await w.consumer.reconcile();
    expect(w.adapters.map((a) => [a.spec.connectorId, a.stopped])).toEqual([
      [5, true],
      [5, false],
    ]);
    connected(w.adapters[1], { messages: 1 });
    await w.consumer.reconcile();
    expect(w.written.at(-1)).toEqual([{ connectorId: 5, version: 2, status: "connected", lastError: null, connected: true, messages: 3, errors: 0 }]);
  });

  it("stops a connection whose connector is switched off, or deleted", async () => {
    const w = world();
    w.setRows([row(5), row(6)]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    w.setRows([{ ...w.rows()[0], enabled: false, configVersion: 2 }]);
    await w.consumer.reconcile();
    expect(w.live()).toEqual([]);
    expect(w.written.at(-1)).toEqual([{ connectorId: 5, version: 2, status: "disconnected", lastError: null, connected: false, messages: 0, errors: 0 }]);
  });

  it("runs the IOT_BROKER_URL broker too, under connector id 0, its stable client id and its workspace", async () => {
    const w = world({ env: { IOT_BROKER_URL: "mqtt://env.test:1883", IOT_BROKER_TOPIC: "plant/+/data" } });
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    expect(w.adapters.map((a) => a.spec.connectorId)).toEqual([0]);
    expect(w.adapters[0].spec.config).toMatchObject({ workspaceId: 3, clientId: "ontos_env_client", endpointUrl: "mqtt://env.test:1883", topicPattern: "plant/+/data" });
  });

  it("reports a connector whose credentials this server cannot open, and starts the others", async () => {
    const saved = env.secretsKey;
    try {
      env.secretsKey = "b".repeat(64);
      const sealed = sealSecret("pw", secretContext.iotConnector(1, "password", "mqtt://broker-5.test:1883"));
      env.secretsKey = "a".repeat(64);
      const w = world();
      w.setRows([row(5, { configJson: { password: sealed } }), row(6)]);
      await w.consumer.keepLease();
      await w.consumer.reconcile();
      expect(w.adapters.map((a) => a.spec.connectorId)).toEqual([6]);
      expect(w.written[0]).toEqual([
        expect.objectContaining({ connectorId: 5, version: 1, status: "error", lastError: expect.stringMatching(/cannot be read: it was sealed under a key this server does not have/) }),
      ]);
    } finally {
      env.secretsKey = saved;
    }
  });
});

describe("the lease", () => {
  it("lost, every connection stops at once, and none starts again", async () => {
    const w = world();
    w.setRows([row(5), row(6)]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    expect(w.live()).toHaveLength(2);

    w.takeover();
    await w.consumer.keepLease();
    expect(w.live()).toEqual([]);
    await w.consumer.reconcile();
    expect(w.live()).toEqual([]);
    expect(w.consumer.status()).toMatchObject({ holdsLease: false, connections: 0 });
  });

  it("found gone by a message, everything stops before the keeper notices, and nothing restarts under it", async () => {
    const w = world();
    w.setRows([row(5), row(6)]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    w.takeover();
    w.adapters[0].spec.onFenced();
    await vi.waitFor(() => expect(w.live()).toEqual([]));
    await w.consumer.reconcile();
    expect(w.live()).toEqual([]);
    expect(w.adapters[0].spec.canConnect()).toBe(false);

    // Taken again later, under a new generation, it runs again.
    await w.consumer.keepLease();
    w.releaseForeign();
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    expect(w.live().map((a) => a.spec.connectorId)).toEqual([5, 6]);
    expect(w.consumer.status().generation).toBe(3);
  });

  it("refused by the fenced write of what it observed, it stops everything", async () => {
    const w = world();
    w.setRows([row(5), row(6, { enabled: false })]);
    await w.consumer.keepLease();
    w.refuseObservations();
    await w.consumer.reconcile();
    expect(w.live()).toEqual([]);
  });

  it("given up on stopping: the connections close first, then the lease is released", async () => {
    const w = world();
    w.setRows([row(5)]);
    w.consumer.start();
    await vi.waitFor(() => expect(w.live()).toHaveLength(1));
    await w.consumer.stop();
    expect(w.live()).toEqual([]);
    expect(w.consumer.status().holdsLease).toBe(false);
  });
});

describe("recording a message", () => {
  const payload = (o: unknown) => Buffer.from(JSON.stringify(o));

  async function handler(env?: NodeJS.ProcessEnv) {
    const w = world({ env });
    w.setRows([row(5, { name: "Plant broker" })]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    return { w, handle: w.adapters[0].spec.handle };
  }

  it("under the lease its connection started with, for the connector's workspace", async () => {
    const { handle } = await handler();
    expect(await handle({ topic: "ontos/twins/T1/telemetry", payload: payload({ temperature: 4 }) })).toEqual({ kind: "recorded" });
    expect(ingestBrokerMessage).toHaveBeenCalledWith(
      { lease: { name: "iot-consumer", owner: "worker-a", generation: 1 }, connectorId: 5, workspaceId: 1, source: "mqtt:Plant broker", deviceMappings: undefined },
      expect.objectContaining({ topic: "ontos/twins/T1/telemetry", points: [expect.objectContaining({ deviceId: "T1" })] }),
    );
  });

  it("recorded before, it is acknowledged; refused by the fence, it is left to the broker", async () => {
    const { handle } = await handler();
    vi.mocked(ingestBrokerMessage).mockResolvedValueOnce("duplicate").mockResolvedValueOnce("fenced");
    expect(await handle({ topic: "t", payload: payload({}) })).toEqual({ kind: "recorded" });
    expect(await handle({ topic: "t", payload: payload({}) })).toEqual({ kind: "fenced" });
  });

  it("not JSON, or refused for its data, it is dropped; the database away, it is delivered again, five times at most", async () => {
    const { handle } = await handler();
    expect(await handle({ topic: "t", payload: Buffer.from("{not json") })).toMatchObject({ kind: "rejected" });
    vi.mocked(ingestBrokerMessage).mockRejectedValueOnce(Object.assign(new Error("Data too long for column 'valueText'"), { sqlState: "22001" }));
    expect(await handle({ topic: "t", payload: payload({ a: 1 }) })).toMatchObject({ kind: "rejected", error: "Data too long for column 'valueText'" });

    const away = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    vi.mocked(ingestBrokerMessage).mockRejectedValue(away);
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push((await handle({ topic: "t", payload: payload({ b: 1 }) })).kind);
    expect(outcomes).toEqual(["retry", "retry", "retry", "retry", "rejected"]);
    vi.mocked(ingestBrokerMessage).mockReset();
    vi.mocked(ingestBrokerMessage).mockResolvedValue("recorded");
  });

  it("a process not sure it still holds the lease records nothing and acknowledges nothing, and gives up nothing either", async () => {
    const { w, handle } = await handler();
    w.takeover();
    await w.consumer.keepLease();
    expect(await handle({ topic: "t", payload: payload({}) })).toEqual({ kind: "retry", error: "this process is not sure it still holds the IoT lease" });
    expect(ingestBrokerMessage).not.toHaveBeenCalled();
  });

  it("only the database's fence marks the lease lost: unsure for a moment, then renewed, it records again", async () => {
    const clock = { now: 0 };
    const w = world({ now: () => clock.now });
    w.setRows([row(5)]);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    const handle = w.adapters[0].spec.handle;
    // The last renewal no longer covers the lease: unsure, it neither records nor acknowledges.
    clock.now = 10_000;
    expect((await handle({ topic: "t", payload: payload({}) })).kind).toBe("retry");
    // The renewal goes through: the lease was this process's all along.
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    expect(w.live().map((a) => a.spec.connectorId)).toEqual([5]);
    expect(await handle({ topic: "t", payload: payload({}) })).toEqual({ kind: "recorded" });
  });
});

describe("forgetting messages seen long ago", () => {
  it("in bounded batches, and again at the next pass while there is a backlog", async () => {
    const w = world();
    const prune = vi.mocked(w.store.pruneSeen);
    prune.mockResolvedValue(1000);
    await w.consumer.keepLease();
    await w.consumer.reconcile();
    expect(prune).toHaveBeenCalledTimes(10);
    expect(prune).toHaveBeenCalledWith(1000);

    prune.mockClear();
    prune.mockResolvedValueOnce(1000).mockResolvedValueOnce(12);
    await w.consumer.reconcile();
    expect(prune).toHaveBeenCalledTimes(2);

    prune.mockClear();
    await w.consumer.reconcile();
    expect(prune).not.toHaveBeenCalled();
  });

  it("only while holding the lease", async () => {
    const w = world();
    await w.consumer.reconcile();
    expect(w.store.pruneSeen).not.toHaveBeenCalled();
  });
});
