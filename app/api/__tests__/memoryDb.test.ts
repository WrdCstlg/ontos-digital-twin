/**
 * The in-memory database that router tests run on (memoryDb.ts). A test is
 * only as good as this stand-in's fidelity, so what it does where SQL is
 * unforgiving is pinned here: writes without a WHERE, ordering, and refusing
 * what it cannot evaluate.
 */
import { describe, expect, it } from "vitest";
import { asc, desc, eq, getTableName, gt, sql, type Table } from "drizzle-orm";
import { connectors, iotConnectors, jobs, mappings } from "@db/schema";
import type { getDb } from "../queries/connection";
import { memoryDb, type Row } from "./memoryDb";

/** The stand-in, typed as the app sees it (through getDb), over the given rows. */
function dbWith(...tables: [Table, Row[]][]) {
  const store = new Map<string, Row[]>(tables.map(([t, rows]) => [getTableName(t), rows.map((r) => ({ ...r }))]));
  const db = memoryDb(store) as unknown as ReturnType<typeof getDb>;
  return { db, rows: (t: Table) => store.get(getTableName(t)) ?? [] };
}

describe("memoryDb writes", () => {
  const twoWorkspaces: Row[] = [
    { id: 5, workspaceId: 1, status: "connected" },
    { id: 6, workspaceId: 2, status: "connected" },
  ];

  it("an update without a WHERE touches every row, as SQL does", async () => {
    const { db, rows } = dbWith([iotConnectors, twoWorkspaces]);
    const [res] = await db.update(iotConnectors).set({ status: "error" });
    expect(res.affectedRows).toBe(2);
    expect(rows(iotConnectors).map((r) => r.status)).toEqual(["error", "error"]);
  });

  it("a delete without a WHERE removes every row, as SQL does", async () => {
    const { db, rows } = dbWith([iotConnectors, twoWorkspaces]);
    const [res] = await db.delete(iotConnectors);
    expect(res.affectedRows).toBe(2);
    expect(rows(iotConnectors)).toEqual([]);
  });

  it("a scoped update or delete touches only the rows it names", async () => {
    const { db, rows } = dbWith([iotConnectors, twoWorkspaces]);
    await db.update(iotConnectors).set({ status: "error" }).where(eq(iotConnectors.workspaceId, 1));
    expect(rows(iotConnectors).map((r) => r.status)).toEqual(["error", "connected"]);
    await db.delete(iotConnectors).where(eq(iotConnectors.id, 5));
    expect(rows(iotConnectors).map((r) => r.id)).toEqual([6]);
  });
});

describe("memoryDb ordering", () => {
  const jobRows: Row[] = [
    { id: 2, workspaceId: 1, leaseOwner: "w-b" },
    { id: 3, workspaceId: 1, leaseOwner: null },
    { id: 1, workspaceId: 1, leaseOwner: "w-a" },
  ];

  it("orders by a bare column or asc() ascending, and by desc() descending", async () => {
    const { db } = dbWith([jobs, jobRows]);
    const ids = (rs: Row[]) => rs.map((r) => r.id);
    expect(ids(await db.select().from(jobs).orderBy(jobs.id))).toEqual([1, 2, 3]);
    expect(ids(await db.select().from(jobs).orderBy(asc(jobs.id)))).toEqual([1, 2, 3]);
    expect(ids(await db.select().from(jobs).orderBy(desc(jobs.id)))).toEqual([3, 2, 1]);
  });

  it("applies limit and offset after ordering: the newest row is the newest", async () => {
    const { db } = dbWith([jobs, jobRows]);
    const [newest] = await db.select().from(jobs).where(eq(jobs.workspaceId, 1)).orderBy(desc(jobs.id)).limit(1);
    expect(newest.id).toBe(3);
    const page = await db.select().from(jobs).orderBy(desc(jobs.id)).limit(1).offset(1);
    expect(page.map((r) => r.id)).toEqual([2]);
  });

  it("sorts NULL lowest, as MySQL does: first ascending, last descending", async () => {
    const { db } = dbWith([jobs, jobRows]);
    const owners = (rs: Row[]) => rs.map((r) => r.leaseOwner);
    expect(owners(await db.select().from(jobs).orderBy(asc(jobs.leaseOwner)))).toEqual([null, "w-a", "w-b"]);
    expect(owners(await db.select().from(jobs).orderBy(desc(jobs.leaseOwner)))).toEqual(["w-b", "w-a", null]);
  });

  it("orders a join by a joined table's column, with later terms breaking ties", async () => {
    const { db } = dbWith(
      [connectors, [{ id: 1, workspaceId: 1 }, { id: 2, workspaceId: 1 }]],
      [mappings, [{ id: 10, connectorId: 2 }, { id: 11, connectorId: 1 }, { id: 12, connectorId: 2 }]],
    );
    const rows = await db
      .select({ id: mappings.id })
      .from(mappings)
      .innerJoin(connectors, eq(mappings.connectorId, connectors.id))
      .orderBy(asc(connectors.id), desc(mappings.id));
    expect(rows.map((r) => r.id)).toEqual([11, 12, 10]);
  });
});

describe("memoryDb refuses what it cannot evaluate", () => {
  it("throws on a predicate, ordering or grouping it does not model, rather than ignore it", async () => {
    const { db } = dbWith([jobs, [{ id: 1, workspaceId: 1 }]]);
    await expect(db.select().from(jobs).where(gt(jobs.id, 0))).rejects.toThrow(/unsupported predicate/);
    await expect(db.select().from(jobs).orderBy(sql`rand()`)).rejects.toThrow(/unsupported ORDER BY/);
    expect(() => db.select().from(jobs).groupBy(jobs.workspaceId)).toThrow(/GROUP BY is unsupported/);
  });

});

describe("memoryDb updates to SQL values", () => {
  it("evaluate a column of the row's own plus a number, and keep any other as given", async () => {
    const { db, rows } = dbWith([iotConnectors, [{ id: 5, workspaceId: 1, configVersion: 3, messageCount: 10 }]]);
    await db.update(iotConnectors).set({ configVersion: sql`${iotConnectors.configVersion} + 1`, messageCount: sql`${iotConnectors.messageCount} + ${4}` });
    expect(rows(iotConnectors)[0]).toMatchObject({ configVersion: 4, messageCount: 14 });
    const now = sql`now(3)`;
    await db.update(iotConnectors).set({ observedAt: now });
    expect(rows(iotConnectors)[0].observedAt).toBe(now);
  });
});

describe("memoryDb transactions", () => {
  it("keep what the body wrote when it returns, and put the tables back when it throws", async () => {
    const { db, rows } = dbWith([iotConnectors, [{ id: 5, workspaceId: 1, status: "connected" }]]);
    await db.transaction(async (tx) => {
      await tx.update(iotConnectors).set({ status: "error" }).where(eq(iotConnectors.id, 5));
    });
    expect(rows(iotConnectors)[0].status).toBe("error");

    await expect(
      db.transaction(async (tx) => {
        await tx.update(iotConnectors).set({ status: "disconnected" }).where(eq(iotConnectors.id, 5));
        await tx.insert(iotConnectors).values({ workspaceId: 1, name: "B", brokerType: "mqtt", endpointUrl: "mqtt://b" });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(rows(iotConnectors)).toEqual([{ id: 5, workspaceId: 1, status: "error" }]);
  });

  it("read under a lock as they read without one: there are no locks in memory", async () => {
    const { db } = dbWith([jobs, [{ id: 1, workspaceId: 1 }, { id: 2, workspaceId: 2 }]]);
    const locked = await db.transaction((tx) => tx.select().from(jobs).where(eq(jobs.workspaceId, 2)).for("update"));
    expect(locked.map((r) => r.id)).toEqual([2]);
  });
});
