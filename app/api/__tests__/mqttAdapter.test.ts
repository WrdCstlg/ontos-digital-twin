/**
 * The MQTT adapter against a fake mqtt.js client. It is what makes a handover
 * lose and double nothing, so each rule is pinned here: the client id and
 * session a new holder resumes, a QoS 1 subscription, one message at a time,
 * the acknowledgement only after the message is recorded (and none for one
 * that was not, nor for any after it), and reconnecting only under the lease.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";
import { HANDLE_TIMEOUT_MS, MqttBrokerAdapter, SESSION_EXPIRY_SECONDS, subscriptionFilter } from "../services/iot/mqttAdapter";
import type { IotBrokerConfig, MessageOutcome } from "../services/iot/types";

type FakeClient = EventEmitter & {
  url: string;
  options: Record<string, unknown>;
  subscribe: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  handleMessage: (packet: unknown, done: (err?: Error) => void) => void;
};
const clients = vi.hoisted(() => [] as unknown[]);

vi.mock("mqtt", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    default: {
      connect: vi.fn((url: string, options: Record<string, unknown>) => {
        const client = Object.assign(new Emitter(), {
          url,
          options,
          subscribe: vi.fn((_filter: string, _opts: unknown, cb?: (err: Error | null, granted?: unknown[]) => void) =>
            cb?.(null, [{ topic: _filter, qos: 1 }]),
          ),
          end: vi.fn((_force: boolean, _opts: unknown, cb?: () => void) => cb?.()),
          handleMessage: (_packet: unknown, done: () => void) => done(),
        });
        clients.push(client);
        return client;
      }),
    },
  };
});

const client = (i = -1) => clients.at(i) as FakeClient;
const config = (over: Partial<IotBrokerConfig> = {}): IotBrokerConfig => ({
  workspaceId: 1,
  name: "Plant broker",
  brokerType: "mqtt",
  endpointUrl: "mqtt://broker.test:1883",
  authType: "none",
  ...over,
});

/** Delivers a message as mqtt.js does, and says whether the adapter let it be acknowledged. */
function deliver(c: FakeClient, topic: string, payload = "{}", qos = 1): Promise<"acked" | "not acked"> {
  return new Promise((resolve) => c.handleMessage({ cmd: "publish", topic, payload: Buffer.from(payload), qos }, (err) => resolve(err ? "not acked" : "acked")));
}

let held = true;
let events: string[] = [];
let outcomes: MessageOutcome[] = [];
const handle = vi.fn(async ({ topic }: { topic: string }): Promise<MessageOutcome> => {
  events.push(`record ${topic}`);
  return outcomes.shift() ?? { kind: "recorded" };
});
const onFenced = vi.fn();

function adapter(over: Partial<IotBrokerConfig> = {}, connectorId = 5) {
  return new MqttBrokerAdapter({ config: config(over), connectorId, handle, canConnect: () => held, onFenced, log: () => undefined });
}
function connect(a: MqttBrokerAdapter, sessionPresent = false) {
  a.start();
  const c = client();
  c.emit("connect", { cmd: "connack", sessionPresent });
  return c;
}

beforeEach(() => {
  clients.length = 0;
  held = true;
  events = [];
  outcomes = [];
  handle.mockClear();
  onFenced.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("connecting so that another consumer can take the session over", () => {
  it("under a stable client id, the connector's own or ontos-<id>, with a persistent 3.1.1 session", () => {
    connect(adapter());
    expect(client().options).toMatchObject({ clientId: "ontos-5", clean: false, protocolVersion: 4, reconnectPeriod: 0 });
    expect(client().options).not.toHaveProperty("properties");
    connect(adapter({ clientId: "plant-7" }));
    expect(client().options.clientId).toBe("plant-7");
  });

  it("in MQTT 5.0, with a session that outlives the connection by a day", () => {
    connect(adapter({ protocolVersion: 5 }));
    expect(client().options).toMatchObject({ clean: false, protocolVersion: 5, properties: { sessionExpiryInterval: SESSION_EXPIRY_SECONDS } });
    expect(SESSION_EXPIRY_SECONDS).toBe(86_400);
  });

  it("subscribing at QoS 1 on every connection, placeholders as wildcards", () => {
    const c = connect(adapter({ topicPattern: "devices/{deviceId}/messages/events" }));
    expect(c.subscribe).toHaveBeenCalledWith("devices/+/messages/events", { qos: 1 }, expect.any(Function));
    const c5 = connect(adapter({ protocolVersion: 5 }));
    // Retained messages only when the subscription is new.
    expect(c5.subscribe).toHaveBeenCalledWith("ontos/twins/+/telemetry", { qos: 1, rh: 1 }, expect.any(Function));
    expect(subscriptionFilter("a/{x}/b/+/c/{y}")).toBe("a/+/b/+/c/+");
  });

  it("and reports a subscription the broker refuses", () => {
    const a = adapter();
    a.start();
    client().subscribe.mockImplementationOnce((f: string, _o: unknown, cb: (e: null, g: unknown[]) => void) => cb(null, [{ topic: f, qos: 128 }]));
    client().emit("connect", { sessionPresent: true });
    expect(a.snapshot()).toMatchObject({ status: "connected", errors: 1, lastError: "The broker refused the subscription to 'ontos/twins/+/telemetry'" });
  });
});

describe("acknowledging a message only once it is recorded", () => {
  it("acknowledges after the message is recorded, not before", async () => {
    handle.mockImplementationOnce(async ({ topic }) => {
      events.push(`record ${topic}`);
      await Promise.resolve();
      events.push("commit");
      return { kind: "recorded" };
    });
    const a = adapter();
    const c = connect(a);
    await deliver(c, "t/1").then((r) => events.push(r));
    expect(events).toEqual(["record t/1", "commit", "acked"]);
    expect(a.snapshot()).toMatchObject({ messages: 1, errors: 0 });
  });

  it("takes messages one at a time, in order, even if handed two at once", async () => {
    let release = () => undefined as void;
    handle.mockImplementationOnce(async ({ topic }) => {
      events.push(`start ${topic}`);
      await new Promise<void>((r) => (release = r));
      events.push(`end ${topic}`);
      return { kind: "recorded" };
    });
    const c = connect(adapter());
    const first = deliver(c, "t/1");
    const second = deliver(c, "t/2");
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(["start t/1"]);
    release();
    expect(await first).toBe("acked");
    expect(await second).toBe("acked");
    expect(events).toEqual(["start t/1", "end t/1", "record t/2"]);
  });

  it("acknowledges a message that can never be recorded, and counts it as an error", async () => {
    const a = adapter();
    const c = connect(a);
    outcomes = [{ kind: "rejected", error: "Unexpected token n in JSON" }];
    expect(await deliver(c, "t/1", "{not json")).toBe("acked");
    expect(a.snapshot()).toMatchObject({ messages: 1, errors: 1, lastError: "Message processing error: Unexpected token n in JSON" });
  });

  it("leaves one not recorded unacknowledged, and every one after it, then reconnects so the broker delivers them again", async () => {
    const a = adapter();
    const c = connect(a);
    outcomes = [{ kind: "retry", error: "connect ECONNREFUSED" }];
    expect(await deliver(c, "t/1")).toBe("not acked");
    expect(await deliver(c, "t/2")).toBe("not acked");
    expect(handle).toHaveBeenCalledTimes(1);
    expect(c.end).toHaveBeenCalledWith(true, {}, expect.any(Function));
    expect(a.snapshot()).toMatchObject({ status: "disconnected", errors: 1 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(clients).toHaveLength(2);
    const again = client();
    again.emit("connect", { sessionPresent: true });
    expect(again.options.clientId).toBe("ontos-5");
    expect(await deliver(again, "t/1")).toBe("acked");
    expect(a.snapshot()).toMatchObject({ status: "connected", connections: 2 });
  });

  it("gives up waiting on a message after the time allowed, unacknowledged", async () => {
    handle.mockImplementationOnce(() => new Promise(() => undefined));
    const c = connect(adapter());
    const result = deliver(c, "t/1");
    await vi.advanceTimersByTimeAsync(HANDLE_TIMEOUT_MS);
    expect(await result).toBe("not acked");
    expect(c.end).toHaveBeenCalled();
  });

  it("when the lease is gone, acknowledges nothing, stops, and says so", async () => {
    const a = adapter();
    const c = connect(a);
    outcomes = [{ kind: "fenced" }];
    expect(await deliver(c, "t/1")).toBe("not acked");
    await vi.advanceTimersByTimeAsync(0);
    expect(c.end).toHaveBeenCalled();
    expect(onFenced).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients).toHaveLength(1);
  });
});

describe("reconnecting only under the lease", () => {
  it("reconnects after the broker closes the connection, backing off", async () => {
    const a = adapter();
    const c = connect(a);
    c.emit("close");
    expect(a.snapshot().status).toBe("disconnected");
    await vi.advanceTimersByTimeAsync(999);
    expect(clients).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(2);
    client().emit("error", new Error("connect ECONNREFUSED 10.0.0.1:1883"));
    client().emit("close");
    await vi.advanceTimersByTimeAsync(1999);
    expect(clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(3);
    expect(a.snapshot()).toMatchObject({ status: "connecting", errors: 1, lastError: "connect ECONNREFUSED 10.0.0.1:1883" });
  });

  it("does not connect while its consumer is unsure of the lease, and does once it is sure again", async () => {
    held = false;
    const a = adapter();
    a.start();
    expect(clients).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(clients).toHaveLength(0);
    held = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clients).toHaveLength(1);
  });

  it("keeps no login in what it reports", () => {
    const a = adapter({ endpointUrl: "mqtt://svc:SENTINEL@broker.test:1883" });
    a.start();
    client().emit("error", new Error("connect mqtt://svc:SENTINEL@broker.test:1883 refused"));
    expect(a.snapshot().lastError).toBe("connect mqtt://broker.test:1883 refused");
  });

  it("once stopped, closes the connection and never reconnects", async () => {
    const a = adapter();
    const c = connect(a);
    await a.stop();
    expect(c.end).toHaveBeenCalledWith(true, {}, expect.any(Function));
    c.emit("close");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clients).toHaveLength(1);
    expect(await deliver(c, "t/1")).toBe("not acked");
    expect(handle).not.toHaveBeenCalled();
  });
});
