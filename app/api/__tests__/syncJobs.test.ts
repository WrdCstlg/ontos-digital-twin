import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { failAbandonedSyncJobs } from "../services/syncJobs";

// Records the one UPDATE the reconciler issues.
const db = vi.hoisted(() => ({
  table: undefined as unknown,
  set: undefined as unknown,
  where: undefined as unknown,
  affectedRows: 0,
}));

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    update: (table: unknown) => {
      db.table = table;
      return {
        set: (values: unknown) => {
          db.set = values;
          return {
            where: async (cond: unknown) => {
              db.where = cond;
              return [{ affectedRows: db.affectedRows }];
            },
          };
        },
      };
    },
  }),
}));

afterEach(() => {
  db.table = db.set = db.where = undefined;
  db.affectedRows = 0;
});

describe("failAbandonedSyncJobs", () => {
  it("marks every running sync job failed, with a finish time, and nothing else", async () => {
    db.affectedRows = 3;
    const before = Date.now();

    const count = await failAbandonedSyncJobs();

    expect(count).toBe(3);
    expect(getTableName(db.table as Table)).toBe("sync_jobs");
    const set = db.set as { status: string; finishedAt: Date };
    expect(set.status).toBe("failed");
    expect(set.finishedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(Object.keys(set).sort()).toEqual(["finishedAt", "status"]);
    const { sql, params } = new MySqlDialect().sqlToQuery(db.where as SQL);
    expect(sql).toBe("`sync_jobs`.`status` = ?");
    expect(params).toEqual(["running"]);
  });

  it("reports zero when no job was left running", async () => {
    await expect(failAbandonedSyncJobs()).resolves.toBe(0);
  });
});
