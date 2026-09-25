import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { Job } from "@db/schema";
import { enqueueMappingSync, MAPPING_SYNC_KIND, mappingSyncHandler } from "../services/mappingSync";

// Each SELECT takes the next scripted result; INSERTs and UPDATEs are recorded.
const db = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selects: [] as { table?: string; forArgs?: unknown[] }[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  updates: [] as { table: string; set: Record<string, unknown>; where: unknown }[],
  nextIds: [] as number[],
}));

vi.mock("../queries/connection", () => {
  function selectChain() {
    const rows = db.selectResults.shift() ?? [];
    const q: { table?: string; forArgs?: unknown[] } = {};
    db.selects.push(q);
    const chain: Record<string, unknown> = {
      from: (t: Table) => {
        q.table = getTableName(t);
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      for: (...args: unknown[]) => {
        q.forArgs = args;
        return chain;
      },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, bad),
    };
    return chain;
  }
  const tx = {
    select: () => selectChain(),
    insert: (t: Table) => ({
      values: (values: Record<string, unknown>) => {
        db.inserts.push({ table: getTableName(t), values });
        return { $returningId: async () => [{ id: db.nextIds.shift() }] };
      },
    }),
    update: (t: Table) => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          db.updates.push({ table: getTableName(t), set, where });
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  };
  return { getDb: () => tx };
});

afterEach(() => {
  db.selectResults.length = 0;
  db.selects.length = 0;
  db.inserts.length = 0;
  db.updates.length = 0;
  db.nextIds.length = 0;
});

describe("enqueueMappingSync", () => {
  it("records a queued import and a job for it, linked both ways, under a lock on the mapping", async () => {
    db.nextIds.push(21, 31); // sync_jobs id, jobs id
    db.selectResults.push([], [], [{ id: 21, mappingId: 4, status: "queued", jobId: 31 }]);

    const res = await enqueueMappingSync(1, 4, "Amara Okafor");

    expect(db.selects[0]).toEqual({ table: "mappings", forArgs: ["update"] });
    expect(db.inserts).toEqual([
      { table: "sync_jobs", values: { mappingId: 4, status: "queued" } },
      {
        table: "jobs",
        values: {
          workspaceId: 1,
          kind: MAPPING_SYNC_KIND,
          payloadJson: { syncJobId: 21, mappingId: 4 },
          maxAttempts: 3,
          createdBy: "Amara Okafor",
        },
      },
    ]);
    expect(db.updates).toEqual([expect.objectContaining({ table: "sync_jobs", set: { jobId: 31 } })]);
    expect(res).toEqual({ syncJob: { id: 21, mappingId: 4, status: "queued", jobId: 31 }, jobId: 31, alreadyActive: false });
  });

  it("returns the import already queued or running for the mapping instead of queuing another", async () => {
    const active = { id: 20, mappingId: 4, status: "running", jobId: 30 };
    db.selectResults.push([], [active]);

    const res = await enqueueMappingSync(1, 4, "Amara Okafor");

    expect(res).toEqual({ syncJob: active, jobId: 30, alreadyActive: true });
    expect(db.inserts).toEqual([]);
  });
});

describe("mappingSyncHandler keeps the import's own record in step with its job", () => {
  const job = { id: 31, payloadJson: { syncJobId: 21, mappingId: 4 } } as unknown as Job;
  const target = (i: number) => new MySqlDialect().sqlToQuery(db.updates[i].where as SQL);

  it("puts the import back to queued, with the error, when a retry is scheduled", async () => {
    await mappingSyncHandler.onRetry?.(job, "Deadlock found");
    expect(db.updates[0]).toMatchObject({ table: "sync_jobs", set: { status: "queued", error: "Deadlock found" } });
    expect(target(0)).toMatchObject({ sql: "`sync_jobs`.`id` = ?", params: [21] });
  });

  it("fails the import with the reason when the job fails for good", async () => {
    await mappingSyncHandler.onFailed?.(job, "lease expired on attempt 3 of 3");
    expect(db.updates[0].set).toMatchObject({ status: "failed", error: "lease expired on attempt 3 of 3" });
    expect(db.updates[0].set.finishedAt).toBeInstanceOf(Date);
  });

  it("clears the import's error and finish time when an admin requeues the job", async () => {
    await mappingSyncHandler.onRequeued?.(job);
    expect(db.updates[0].set).toEqual({ status: "queued", error: null, finishedAt: null });
  });
});
