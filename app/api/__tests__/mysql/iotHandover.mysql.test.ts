/**
 * The IoT consumer handing over from one process to another through a real
 * MQTT broker, with the lease and the telemetry in a real MySQL.
 * ONTOS_TEST_MQTT_URL names the broker (e.g. mqtt://127.0.0.1:1883, a
 * mosquitto allowing anonymous clients). Unset, these tests are skipped; set
 * but unreachable, they fail.
 *
 * Consumer A connects under the connector's stable client id, in a persistent
 * session, subscribed at QoS 1. Stopped, it hands the lease over: what is
 * published meanwhile waits at the broker, and B, taking the lease, resumes the
 * session and records it. Losing the lease while a message is on its way, A
 * records none of it and leaves it unacknowledged, and the broker delivers it
 * to B. Either way every reading the broker accepted is recorded, none twice.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mqtt, { type MqttClient } from "mqtt";
import { count, eq, sql } from "drizzle-orm";
import { iotConnectors, iotMessageSeen, kgNodes, leases, twinStateLog, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { displayUrl } from "../../services/connectorView";
import { IOT_CONSUMER_LEASE, IotConsumer, type IotConsumerOptions } from "../../services/iot/iotConsumer";
import { emptyDatabase } from "./database";

const brokerUrl = process.env.ONTOS_TEST_MQTT_URL;
const run = `${process.pid}-${Date.now().toString(36)}`;
const TWIN = "dtwin:log/shipment-t1";
const WS = 1;

/** The broker, or a failure that says why: a URL that is set must answer. */
async function connectWhenReady(url: string): Promise<MqttClient> {
  let last: unknown;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      return await mqtt.connectAsync(url, { clientId: `ontos-test-publisher-${run}`, reconnectPeriod: 0, connectTimeout: 3_000 }, false);
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`the MQTT broker at ONTOS_TEST_MQTT_URL (${url}) did not answer within 30 s: ${last instanceof Error ? last.message : String(last)}`);
}

describe.skipIf(!brokerUrl)("a persistent-session handover through a real broker", () => {
  let publisher: MqttClient;
  let clientId = "";
  let logs: string[] = [];
  const consumers: IotConsumer[] = [];

  beforeAll(async () => {
    publisher = await connectWhenReady(brokerUrl!);
  });
  afterAll(async () => {
    await publisher?.endAsync();
    await closeDb();
  });

  beforeEach(async (ctx) => {
    logs = [];
    clientId = `ontos-test-${run}-${ctx.task.id}`;
    await emptyDatabase();
    const db = getDb();
    await db.insert(workspaces).values({ id: WS, name: "A", slug: "a" });
    await db.insert(kgNodes).values({ id: 1, workspaceId: WS, moduleKey: "twin", classIri: "dtwin:ShipmentTwin", iri: TWIN, label: "Twin · T1", propsJson: {} });
    await db.insert(iotConnectors).values({
      id: 5,
      workspaceId: WS,
      name: "Test broker",
      brokerType: "mqtt",
      endpointUrl: brokerUrl!,
      topicPattern: `ontos-test/${run}/+/telemetry`,
      clientId,
      enabled: true,
      configVersion: 1,
    });
  });
  afterEach(async () => {
    await Promise.all(consumers.splice(0).map((c) => c.stop()));
    // The session each test left at the broker, discarded.
    const cleaner = await mqtt.connectAsync(brokerUrl!, { clientId, clean: true, reconnectPeriod: 0 }, false);
    await cleaner.endAsync();
  });

  function consumer(owner: string, over: Partial<IotConsumerOptions> = {}) {
    const c = new IotConsumer({ owner, leaseMs: 1_500, renewMs: 400, reconcileMs: 200, env: {}, log: (line) => logs.push(`${owner}: ${line}`), ...over });
    consumers.push(c);
    c.start();
    return c;
  }

  async function until(check: () => Promise<boolean> | boolean, what: string, ms = 20_000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting until ${what}; the consumers said:\n${logs.slice(-30).join("\n")}`);
  }

  const base = Date.parse("2026-09-28T10:00:00.000Z");
  /** Publishes readings `from`..`from + n - 1` at QoS 1, each waiting for the broker's PUBACK. */
  async function publish(from: number, n: number) {
    for (let i = from; i < from + n; i++) {
      const reading = { twinIri: TWIN, timestamp: base + i * 1000, telemetry: { temperature: 4 + i / 100 } };
      await publisher.publishAsync(`ontos-test/${run}/T1/telemetry`, JSON.stringify(reading), { qos: 1 });
    }
  }
  /** How many times each reading was recorded, by its time. */
  async function recordings() {
    const rows = await getDb()
      .select({ at: twinStateLog.recordedAt, n: count() })
      .from(twinStateLog)
      .where(eq(twinStateLog.key, "temperature"))
      .groupBy(twinStateLog.recordedAt);
    return rows.map((r) => Number(r.n));
  }
  const recorded = async () => (await recordings()).length;
  const connectedByConsumer = async () => {
    const [row] = await getDb().select().from(iotConnectors).where(eq(iotConnectors.id, 5));
    return row.status === "connected" && row.observedVersion === 1;
  };

  it("stopped, the holder hands over: what was published meanwhile waits at the broker, and the next holder records it, each reading once", async () => {
    const a = consumer("consumer-a");
    await until(connectedByConsumer, "A reported the connector connected");
    await publish(0, 10);
    await until(async () => (await recorded()) === 10, "A recorded the first ten readings");

    await a.stop();
    await publish(10, 10);
    await new Promise((r) => setTimeout(r, 500));
    expect(await recorded()).toBe(10);

    consumer("consumer-b");
    await until(async () => (await recorded()) === 20, "B recorded what was published while no consumer ran");
    expect(await recordings()).toEqual(Array(20).fill(1));
    expect(logs).toContain(`consumer-b: connector 5: connected to ${displayUrl(brokerUrl!)} as ${clientId}, resuming its session`);
    expect((await getDb().select().from(leases))[0]).toMatchObject({ owner: "consumer-b", generation: 2 });
  }, 60_000);

  it("losing the lease with a message on its way, the holder records none of it, and the next is delivered it", async () => {
    // A renews seldom, so it learns of the loss from the message itself.
    const a = consumer("consumer-a", { leaseMs: 30_000, renewMs: 10_000 });
    await until(connectedByConsumer, "A reported the connector connected");
    await getDb()
      .update(leases)
      .set({ owner: "intruder", generation: sql`${leases.generation} + 1`, expiresAt: sql`now(3) + interval 60 second` })
      .where(eq(leases.name, IOT_CONSUMER_LEASE));

    await publish(0, 3);
    await until(() => a.status().connections === 0, "A stopped its connection");
    expect(logs).toContainEqual(expect.stringMatching(/^consumer-a: connector 5: message on .* left to the broker/));
    expect(await recorded()).toBe(0);
    expect(await getDb().select({ n: count() }).from(iotMessageSeen)).toEqual([{ n: 0 }]);

    await getDb().update(leases).set({ owner: null, expiresAt: null }).where(eq(leases.name, IOT_CONSUMER_LEASE));
    consumer("consumer-b");
    await until(async () => (await recorded()) === 3, "B recorded what A left unacknowledged");
    expect(await recordings()).toEqual([1, 1, 1]);
  }, 60_000);

  it("a reading published twice with the same message id is recorded once", async () => {
    consumer("consumer-a");
    await until(connectedByConsumer, "A reported the connector connected");
    const reading = JSON.stringify({ messageId: `m-${run}`, twinIri: TWIN, timestamp: base, telemetry: { temperature: 4.4 } });
    await publisher.publishAsync(`ontos-test/${run}/T1/telemetry`, reading, { qos: 1 });
    await publisher.publishAsync(`ontos-test/${run}/T1/telemetry`, reading, { qos: 1 });
    await publish(1, 1);
    await until(async () => (await recorded()) === 2, "both readings recorded");
    expect(await recordings()).toEqual([1, 1]);
    expect(await getDb().select({ n: count() }).from(iotMessageSeen)).toEqual([{ n: 2 }]);
  }, 60_000);
});
