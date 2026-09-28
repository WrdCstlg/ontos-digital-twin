/**
 * Telemetry on a real MySQL. iotIngestion.test.ts checks the statements; this
 * checks what the locks make of them when writers meet: telemetry, and the
 * simulation's tick, writing one twin at once lose none of each other's
 * updates.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { kgNodes, workspaces } from "@db/schema";
import { appRouter } from "../../router";
import { closeDb, getDb } from "../../queries/connection";
import { ingestTelemetry } from "../../services/iot/iotIngestion";
import { createMockContext, mockViewerUser, mockWorkspace } from "../testHarness";
import { emptyDatabase } from "./database";

const WS = mockWorkspace.id;
const TWIN = "dtwin:log/shipment-001";
const WAREHOUSE = "dtwin:log/warehouse-01";
const at = new Date("2026-01-01T00:00:00Z");

beforeEach(async () => {
  await emptyDatabase();
  const db = getDb();
  await db.insert(workspaces).values({ id: WS, name: mockWorkspace.name, slug: mockWorkspace.slug });
  await db.insert(kgNodes).values([
    { id: 1, workspaceId: WS, moduleKey: "twin", classIri: "dtwin:ShipmentTwin", iri: TWIN, label: "Twin · SHP-001", propsJson: { status: "in_transit" } },
    { id: 2, workspaceId: WS, moduleKey: "twin", classIri: "dtwin:WarehouseTwin", iri: WAREHOUSE, label: "Twin · WH-01", propsJson: { temperature: 20, humidity: 48, utilization: 50 } },
  ]);
});
afterAll(() => closeDb());

const twin = async (id: number) => (await getDb().select().from(kgNodes).where(eq(kgNodes.id, id)))[0].propsJson as Record<string, unknown>;

describe("writers of one twin at once lose none of each other's updates", () => {
  it("telemetry through the HTTP webhook's path", async () => {
    // No retry: a deadlock fails the test.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => ingestTelemetry([{ twinIri: TWIN, telemetry: { [`probe${i}`]: i } }], { workspaceId: WS, source: "http_webhook" })),
    );
    const props = await twin(1);
    for (let i = 0; i < 20; i++) expect(props[`probe${i}`], `probe${i}`).toBe(i);
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
