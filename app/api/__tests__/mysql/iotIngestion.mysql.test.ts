/**
 * Telemetry on a real MySQL. iotIngestion.test.ts checks the statements; this
 * checks what the locks and keys make of them when writers meet: a broker
 * message delivered twice at once is recorded once; a consumer that lost the
 * IoT lease records nothing; telemetry, and the simulation's tick, writing one
 * twin at once lose none of each other's updates; what a consumer observes is
 * written only under its lease; and seen messages are forgotten after a week,
 * a bounded batch at a time.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { auditLog, iotConnectors, iotMessageSeen, kgNodes, leases, twinStateLog, workspaces } from "@db/schema";
import { appRouter } from "../../router";
import { closeDb, getDb } from "../../queries/connection";
import { ingestBrokerMessage, ingestTelemetry, readBrokerMessage } from "../../services/iot/iotIngestion";
import { IOT_CONSUMER_LEASE, mysqlConnectorStore } from "../../services/iot/iotConsumer";
import { mysqlLeases, type Lease } from "../../services/leases";
import { createMockContext, mockViewerUser, mockWorkspace } from "../testHarness";
import { emptyDatabase } from "./database";

const WS = mockWorkspace.id;
const TWIN = "dtwin:log/shipment-001";
const WAREHOUSE = "dtwin:log/warehouse-01";
const at = new Date("2026-01-01T00:00:00Z");
let lease: Lease;

beforeEach(async () => {
  await emptyDatabase();
  const db = getDb();
  await db.insert(workspaces).values({ id: WS, name: mockWorkspace.name, slug: mockWorkspace.slug });
  await db.insert(kgNodes).values([
    { id: 1, workspaceId: WS, moduleKey: "twin", classIri: "dtwin:ShipmentTwin", iri: TWIN, label: "Twin · SHP-001", propsJson: { status: "in_transit" } },
    { id: 2, workspaceId: WS, moduleKey: "twin", classIri: "dtwin:WarehouseTwin", iri: WAREHOUSE, label: "Twin · WH-01", propsJson: { temperature: 20, humidity: 48, utilization: 50 } },
  ]);
  lease = (await mysqlLeases().acquire(IOT_CONSUMER_LEASE, "worker-a", 60_000))!;
});
afterAll(() => closeDb());

const from = () => ({ lease, connectorId: 5, workspaceId: WS, source: "mqtt:Plant broker" });
const message = (payload: unknown, topic = "ontos/twins/SHP-001/telemetry") =>
  readBrokerMessage(topic, Buffer.from(JSON.stringify(payload)), "ontos/twins/+/telemetry");
const twin = async (id: number) => (await getDb().select().from(kgNodes).where(eq(kgNodes.id, id)))[0].propsJson as Record<string, unknown>;
const countOf = async (table: typeof twinStateLog | typeof iotMessageSeen | typeof auditLog) => Number((await getDb().select({ n: count() }).from(table))[0].n);

describe("a broker message", () => {
  it("delivered again while its first delivery is still being recorded is recorded once", async () => {
    const reading = message({ twinIri: TWIN, timestamp: "2026-09-28T10:00:00.000Z", telemetry: { temperature: 4.2, humidity: 51 } });
    // No retry: a deadlock fails the test.
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => ingestBrokerMessage(from(), reading)));

    expect(outcomes.filter((o) => o === "recorded")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(7);
    expect(await countOf(twinStateLog)).toBe(2);
    expect(await countOf(iotMessageSeen)).toBe(1);
    expect(await getDb().select({ n: count() }).from(auditLog).where(eq(auditLog.entityType, "iot_telemetry"))).toEqual([{ n: 1 }]);
  });

  it("and later, from another connection, is still recorded once", async () => {
    const reading = message({ messageId: "m-1", twinIri: TWIN, telemetry: { temperature: 4.2 } });
    expect(await ingestBrokerMessage(from(), reading)).toBe("recorded");
    const resent = message({ messageId: "m-1", twinIri: TWIN, telemetry: { temperature: 4.2 }, resentAt: "10:05" });
    expect(await ingestBrokerMessage(from(), resent)).toBe("duplicate");
    expect(await countOf(twinStateLog)).toBe(1);
  });

  it("is recorded under the lease it arrived under, or not at all: a consumer that lost the lease writes nothing", async () => {
    await getDb().update(leases).set({ owner: "worker-b", generation: sql`${leases.generation} + 1` }).where(eq(leases.name, IOT_CONSUMER_LEASE));
    const reading = message({ twinIri: TWIN, telemetry: { temperature: 9.9 } });
    expect(await ingestBrokerMessage(from(), reading)).toBe("fenced");
    expect(await countOf(iotMessageSeen)).toBe(0);
    expect(await countOf(twinStateLog)).toBe(0);
    expect(await twin(1)).toEqual({ status: "in_transit" });
  });
});

describe("writers of one twin at once lose none of each other's updates", () => {
  it("telemetry through the HTTP webhook's path", async () => {
    // No retry: a deadlock fails the test.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => ingestTelemetry([{ twinIri: TWIN, telemetry: { [`probe${i}`]: i } }], { workspaceId: WS, source: "http_webhook" })),
    );
    const props = await twin(1);
    for (let i = 0; i < 20; i++) expect(props[`probe${i}`], `probe${i}`).toBe(i);
  });

  it("broker messages, each recorded once", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ingestBrokerMessage(from(), message({ twinIri: TWIN, telemetry: { [`probe${i}`]: i, temperature: 4 + i / 10 } }))),
    );
    expect(outcomes.every((o) => o === "recorded")).toBe(true);
    const props = await twin(1);
    for (let i = 0; i < 20; i++) expect(props[`probe${i}`], `probe${i}`).toBe(i);
    expect(await countOf(twinStateLog)).toBe(20);
  });

  it("the simulation's tick beside telemetry: each keeps the other's changes", async () => {
    const editor = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        workspace: mockWorkspace,
        membership: { id: 901, workspaceId: WS, userId: mockViewerUser.id, role: "editor", moduleScope: null, createdAt: at },
      }),
    );
    let utilization = (await twin(2)).utilization;
    for (let round = 0; round < 10; round++) {
      const [ticked] = await Promise.all([
        editor.twin.tick({ iri: WAREHOUSE }),
        ingestTelemetry([{ twinIri: WAREHOUSE, telemetry: { [`probe${round}`]: round } }], { workspaceId: WS }),
      ]);
      const change = ticked.twins[0]?.changes.find((c) => c.key === "utilization");
      if (change) utilization = change.new;
    }
    const props = await twin(2);
    // The tick never touches the probes, nor telemetry the utilization.
    for (let round = 0; round < 10; round++) expect(props[`probe${round}`], `probe${round}`).toBe(round);
    expect(props.utilization).toBe(utilization);
  });
});

describe("what the consumer writes back", () => {
  const connector = { id: 5, workspaceId: WS, name: "Plant broker", brokerType: "mqtt" as const, endpointUrl: "mqtt://broker.test:1883", configVersion: 3, messageCount: 10, errorCount: 1, updatedAt: at };
  const observation = { connectorId: 5, version: 3, status: "connected" as const, lastError: null, connected: true, messages: 4, errors: 2 };

  it("is written under its lease: counters added, the version it observed, who and when, and the last edit's time kept", async () => {
    await getDb().insert(iotConnectors).values(connector);
    expect(await mysqlConnectorStore().observe(lease, [observation])).toBe(true);
    const [row] = await getDb()
      .select({ r: iotConnectors, ago: sql<number>`timestampdiff(second, ${iotConnectors.observedAt}, now())`, connectedAgo: sql<number>`timestampdiff(second, ${iotConnectors.lastConnectedAt}, now())` })
      .from(iotConnectors);
    expect(row.r).toMatchObject({ status: "connected", messageCount: 14, errorCount: 3, observedVersion: 3, consumerOwner: "worker-a", updatedAt: at });
    expect(Number(row.ago)).toBeLessThanOrEqual(2);
    expect(Number(row.connectedAgo)).toBeLessThanOrEqual(2);
  });

  it("and refused, writing nothing, under a lease that has changed hands", async () => {
    await getDb().insert(iotConnectors).values(connector);
    await getDb().update(leases).set({ owner: "worker-b", generation: sql`${leases.generation} + 1` }).where(eq(leases.name, IOT_CONSUMER_LEASE));
    expect(await mysqlConnectorStore().observe(lease, [observation])).toBe(false);
    expect((await getDb().select().from(iotConnectors))[0]).toMatchObject({ status: "disconnected", messageCount: 10, observedVersion: null });
  });
});

describe("messages seen more than a week ago", () => {
  it("are forgotten a bounded batch at a time, oldest first, and recent ones kept", async () => {
    const rows = (n: number, daysAgo: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({ connectorId: 5, fingerprint: (offset + i).toString(16).padStart(64, "0"), seenAt: sql`now() - interval ${daysAgo} day` }));
    for (let i = 0; i < 2300; i += 500) await getDb().insert(iotMessageSeen).values(rows(Math.min(500, 2300 - i), 8, i));
    await getDb().insert(iotMessageSeen).values(rows(200, 6, 10_000));

    const store = mysqlConnectorStore();
    expect(await store.pruneSeen(1000)).toBe(1000);
    expect(await store.pruneSeen(1000)).toBe(1000);
    expect(await store.pruneSeen(1000)).toBe(300);
    expect(await store.pruneSeen(1000)).toBe(0);
    expect(await countOf(iotMessageSeen)).toBe(200);
    const [{ oldest }] = await getDb().select({ oldest: sql<number>`min(timestampdiff(day, ${iotMessageSeen.seenAt}, now()))` }).from(iotMessageSeen).where(and(eq(iotMessageSeen.connectorId, 5)));
    expect(Number(oldest)).toBeLessThan(7);
  });
});
