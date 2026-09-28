/**
 * Insights and IoT connectors on a real MySQL, around migration 0009.
 * Reconciliations that run at once (a scan beside telemetry) keep one insight
 * per rule, in place; the migration first removes the duplicates concurrent
 * reconciliations made before, keeping the newest, so its unique key can hold
 * on a database that has them; and it switches on the connectors that were
 * meant to run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { eq, sql } from "drizzle-orm";
import { insights, iotConnectors, kgNodes, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import { reconcileInsights } from "../../insightsRouter";
import { isDuplicateKey } from "../../lib/mysqlErrors";
import { emptyDatabase } from "./database";

const A = 1;
const B = 2;

beforeEach(async () => {
  await emptyDatabase();
  await getDb().insert(workspaces).values([
    { id: A, name: "A", slug: "a" },
    { id: B, name: "B", slug: "b" },
  ]);
});
afterAll(() => closeDb());

const migration = readFileSync(path.resolve(import.meta.dirname, "../../../db/migrations/0009_iot_leased_consumer.sql"), "utf8").split("--> statement-breakpoint");
const statement = (pattern: RegExp) => {
  const found = migration.find((s) => pattern.test(s));
  if (!found) throw new Error(`migration 0009 has no statement matching ${pattern}`);
  return found;
};

/** Twins out of the cold-chain band: rule twin-cold-chain-excursion fires. */
async function coldChainBreach(workspaceId: number, temperature = 9) {
  await getDb().insert(kgNodes).values({ workspaceId, moduleKey: "twin", classIri: "dtwin:ShipmentTwin", iri: `dtwin:s-${workspaceId}-${temperature}`, label: "Twin", propsJson: { temperature } });
}

describe("reconciling insights", () => {
  it("at once, many times over, keeps one insight per rule, and every run names the same one", async () => {
    await coldChainBreach(A);
    // No retry here: a deadlock or a duplicate key fails the test.
    const runs = await Promise.all(Array.from({ length: 8 }, () => reconcileInsights(A)));
    const rows = await getDb().select().from(insights).where(eq(insights.ruleId, "twin-cold-chain-excursion"));
    expect(rows).toHaveLength(1);
    for (const run of runs) expect(run.results.find((r) => r.ruleId === "twin-cold-chain-excursion")?.insightId).toBe(rows[0].id);
  });

  it("again, updates it in place: its id, and an acknowledgement, kept", async () => {
    const coldChain = async () => (await reconcileInsights(A)).results.find((r) => r.ruleId === "twin-cold-chain-excursion")!;
    await coldChainBreach(A, 9);
    const first = await coldChain();
    expect(first.status).toBe("created");
    await getDb().update(insights).set({ status: "acknowledged" }).where(eq(insights.id, first.insightId));
    await coldChainBreach(A, 11);

    expect(await coldChain()).toEqual({ ruleId: first.ruleId, status: "updated", insightId: first.insightId });
    const [row] = await getDb().select().from(insights).where(eq(insights.id, first.insightId));
    expect(row).toMatchObject({ status: "acknowledged", title: "2 digital twins report temperature excursion" });
  });

  it("each workspace's to itself: the same rule in two workspaces is two insights", async () => {
    await coldChainBreach(A);
    await coldChainBreach(B);
    await Promise.all([reconcileInsights(A), reconcileInsights(B)]);
    const rows = await getDb().select().from(insights).where(eq(insights.ruleId, "twin-cold-chain-excursion"));
    expect(rows.map((i) => i.workspaceId).sort()).toEqual([A, B]);
  });
});

describe("migration 0009", () => {
  it("removes the duplicates earlier reconciliations made, keeping the newest of each, before the key goes on", async () => {
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const has = async (index: string) => (await conn.query<mysql.RowDataPacket[]>("SHOW INDEX FROM `insights` WHERE Key_name = ?", [index]))[0].length > 0;
    try {
      // The table as it was before: no key. MySQL let the key serve the
      // workspace's foreign key too, so another index stands in for it meanwhile.
      await conn.query("CREATE INDEX `insights_ws_tmp` ON `insights` (`workspaceId`)");
      await conn.query("ALTER TABLE `insights` DROP INDEX `insights_ws_rule`");
      const insight = (id: number, workspaceId: number, ruleId: string | null, status: "open" | "acknowledged" = "open") => ({
        id, workspaceId, ruleId, status, type: "anomaly" as const, severity: "risk" as const, title: `insight ${id}`,
      });
      await getDb().insert(insights).values([
        insight(1, A, "r1", "acknowledged"),
        insight(2, A, "r1"),
        insight(3, A, "r1"),
        insight(4, B, "r1"),
        insight(5, A, null),
        insight(6, A, null),
        // The key compares as the column's collation does: case aside, the same rule.
        insight(7, A, "R2"),
        insight(8, A, "r2"),
        insight(9, A, "r3"),
      ]);

      await conn.query(statement(/DELETE `older`/));
      await conn.query(statement(/ADD CONSTRAINT `insights_ws_rule`/));

      expect((await getDb().select({ id: insights.id }).from(insights).orderBy(insights.id)).map((r) => r.id)).toEqual([3, 4, 5, 6, 8, 9]);
      await expect(getDb().insert(insights).values(insight(10, A, "r1"))).rejects.toSatisfy(isDuplicateKey);
      await getDb().insert(insights).values(insight(11, A, null));
    } finally {
      // Whatever happened, the indexes are as the migrations made them.
      if (!(await has("insights_ws_rule"))) {
        await conn.query("DELETE FROM `insights`");
        await conn.query(statement(/ADD CONSTRAINT `insights_ws_rule`/));
      }
      if (await has("insights_ws_tmp")) await conn.query("DROP INDEX `insights_ws_tmp` ON `insights`");
      await conn.end();
    }
  });

  it("switches on the connectors that were running or failing to run, and off the rest", async () => {
    const broker = (id: number, status: "connected" | "error" | "disconnected" | "disabled") => ({
      id, workspaceId: A, name: `Broker ${id}`, brokerType: "mqtt" as const, endpointUrl: "mqtt://broker.test:1883", status, enabled: true,
    });
    await getDb().insert(iotConnectors).values([broker(1, "connected"), broker(2, "error"), broker(3, "disconnected"), broker(4, "disabled")]);
    await getDb().execute(sql.raw(statement(/UPDATE `iot_connectors` SET `enabled`/)));
    const rows = await getDb().select({ id: iotConnectors.id, enabled: iotConnectors.enabled, configVersion: iotConnectors.configVersion }).from(iotConnectors).orderBy(iotConnectors.id);
    expect(rows).toEqual([
      { id: 1, enabled: true, configVersion: 1 },
      { id: 2, enabled: true, configVersion: 1 },
      { id: 3, enabled: false, configVersion: 1 },
      { id: 4, enabled: false, configVersion: 1 },
    ]);
  });
});
