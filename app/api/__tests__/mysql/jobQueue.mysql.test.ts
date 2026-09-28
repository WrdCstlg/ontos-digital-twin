/**
 * The job queue on a real MySQL. jobQueue.test.ts checks the SQL the queue
 * writes; this checks what that SQL does. Workers claiming at once, on a table
 * that holds a deployment's history of finished jobs, neither deadlock nor
 * take the same job; a claim passes over a job another transaction holds;
 * leases run out on the database's clock; and a worker that lost its lease
 * cannot write over the one that took the job.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { eq, inArray, sql } from "drizzle-orm";
import { jobs, workers, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import {
  cancelQueuedJob,
  claimNextJob,
  completeJob,
  dueJob,
  enqueueJob,
  failJobAttempt,
  JOBS_BY_STATUS_INDEX,
  lapsedJob,
  registerWorker,
  renewLease,
  requeueFailedJob,
  workerHeartbeat,
} from "../../services/jobs/queue";
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

const enqueue = (opts: { workspaceId?: number; maxAttempts?: number } = {}) =>
  enqueueJob(getDb(), { workspaceId: opts.workspaceId ?? A, kind: "test", payload: {}, maxAttempts: opts.maxAttempts });
const row = async (id: number) => (await getDb().select().from(jobs).where(eq(jobs.id, id)))[0];
/** Seconds from the database's now() to a job's timestamp column. */
const secondsUntil = async (id: number, column: typeof jobs.leaseExpiresAt | typeof jobs.runAfter) =>
  Number((await getDb().select({ s: sql<number>`timestampdiff(second, now(), ${column})` }).from(jobs).where(eq(jobs.id, id)))[0].s);
/** Moves a job's lease into the past, as if its worker had stopped renewing it. */
const lapse = (id: number) => getDb().update(jobs).set({ leaseExpiresAt: sql`now() - interval 1 second` }).where(eq(jobs.id, id));

/** Finished jobs, as a deployment that has run a while holds: nothing deletes them. */
async function history(n: number) {
  const done = { workspaceId: A, kind: "test", status: "succeeded" as const, attempts: 1, finishedAt: new Date() };
  for (let i = 0; i < n; i += 1000) await getDb().insert(jobs).values(Array.from({ length: Math.min(1000, n - i) }, () => done));
  await getDb().execute(sql`analyze table jobs`);
}

/** How MySQL runs a query: its EXPLAIN row. */
async function planOf(query: { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql: text, params } = query.toSQL();
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [[plan]] = await conn.query<mysql.RowDataPacket[]>(`explain ${text}`, params);
    return plan;
  } finally {
    await conn.end();
  }
}

describe("claiming", () => {
  it("on a table with a history, workers claiming at once never deadlock or take the same job, and between them take every one", async () => {
    await history(3000);
    // The plans production runs once jobs pile up: each read goes through the
    // status index in its own order, so it locks the one row it returns.
    for (const query of [dueJob(getDb()), lapsedJob(getDb())]) expect(await planOf(query)).toMatchObject({ key: JOBS_BY_STATUS_INDEX });
    expect(String((await planOf(dueJob(getDb()))).Extra)).not.toMatch(/filesort/i);

    const names = ["w1", "w2", "w3", "w4", "w5"];
    const tookAny = new Set<string>();
    for (let round = 0; round < 5; round++) {
      const ids: number[] = [];
      for (let i = 0; i < 40; i++) ids.push(await enqueue());

      // No catch: a deadlock, or any error, fails the test.
      const taken = await Promise.all(
        names.map(async (w) => {
          const mine: number[] = [];
          for (let r = await claimNextJob(w, 60); r; r = await claimNextJob(w, 60)) mine.push(r.job.id);
          if (mine.length) tookAny.add(w);
          return mine;
        }),
      );

      expect(taken.flat().sort((a, b) => a - b), `round ${round}`).toEqual(ids);
      for (const [i, w] of names.entries()) {
        for (const id of taken[i]) expect(await row(id)).toMatchObject({ status: "running", leaseOwner: w, attempts: 1 });
      }
      await getDb().update(jobs).set({ status: "succeeded", leaseOwner: null, leaseExpiresAt: null }).where(inArray(jobs.id, ids));
    }
    // Claims pass each other rather than wait in line: every worker took jobs.
    expect([...tookAny].sort()).toEqual(names);
  });

  it("a claim passes over a job another transaction holds, at once, rather than waiting for it", async () => {
    const held = await enqueue();
    const next = await enqueue();
    const other = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      await other.query("start transaction");
      await other.query("select id from jobs where id = ? for update", [held]);
      const started = Date.now();
      expect((await claimNextJob("w1", 60))?.job.id).toBe(next);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await other.query("rollback");
      await other.end();
    }
  });

  it("takes a job whose lease lapsed before any queued one", async () => {
    const queued = await enqueue();
    const stranded = await enqueue();
    await getDb().update(jobs).set({ status: "running", leaseOwner: "w-dead", attempts: 1, leaseExpiresAt: sql`now() - interval 1 second` }).where(eq(jobs.id, stranded));

    expect((await claimNextJob("w1", 60))?.job.id).toBe(stranded);
    expect((await claimNextJob("w1", 60))?.job.id).toBe(queued);
  });

  it("a live lease keeps a job; set on the database's clock, it runs out as that clock moves, and another worker takes the job", async () => {
    const id = await enqueue();
    expect((await claimNextJob("w1", 60))?.job.id).toBe(id);
    // 60 s from the database's now(), whatever the app's clock or the session's time zone.
    expect(await secondsUntil(id, jobs.leaseExpiresAt)).toBeGreaterThanOrEqual(58);
    expect(await secondsUntil(id, jobs.leaseExpiresAt)).toBeLessThanOrEqual(60);
    expect(await claimNextJob("w2", 60)).toBeNull();

    await getDb().update(jobs).set({ leaseExpiresAt: sql`now() + interval 1 second` }).where(eq(jobs.id, id));
    await new Promise((r) => setTimeout(r, 2100));
    expect(await claimNextJob("w2", 60)).toMatchObject({
      kind: "claimed",
      job: { id, leaseOwner: "w2", attempts: 2, lastError: "lease held by w1 expired; reclaimed by w2" },
    });
  });

  it("a lease that runs out on the job's last attempt fails the job instead of running it again", async () => {
    const id = await enqueue({ maxAttempts: 1 });
    await claimNextJob("w1", 60);
    await lapse(id);

    expect(await claimNextJob("w2", 60)).toMatchObject({ kind: "abandoned", job: { id, status: "failed" } });
    const failed = await row(id);
    expect(failed).toMatchObject({
      status: "failed",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: "lease held by w1 expired on attempt 1 of 1; the worker stopped responding",
    });
    expect(failed.finishedAt).toBeInstanceOf(Date);
    expect(await claimNextJob("w2", 60)).toBeNull();
  });
});

describe("a worker that lost its lease writes nothing", () => {
  it("neither renewing, finishing nor failing the job the next worker holds", async () => {
    const id = await enqueue();
    await claimNextJob("w1", 60);
    await lapse(id);
    const taken = await claimNextJob("w2", 60);

    expect(await renewLease(id, "w1")).toBe(false);
    expect(await completeJob(id, "w1", { by: "w1" })).toBe(false);
    expect(await failJobAttempt(taken!.job, "w1", "late", true)).toBe("lost");
    expect(await row(id)).toMatchObject({ status: "running", leaseOwner: "w2" });

    expect(await completeJob(id, "w2", { by: "w2" })).toBe(true);
    expect(await row(id)).toMatchObject({ status: "succeeded", resultJson: { by: "w2" }, leaseOwner: null, leaseExpiresAt: null });
    expect(await completeJob(id, "w2", { by: "again" })).toBe(false);
  });

  it("while the holder's renewal counts even when it changes nothing", async () => {
    // Renewed within the second it was claimed, a lease's expiry is unchanged:
    // MySQL then counts the row as matched, not changed. The queue's writes are
    // fenced on the matched count, which the driver reports (its FOUND_ROWS flag).
    const id = await enqueue();
    await claimNextJob("w1", 60);
    const [same] = await getDb().update(jobs).set({ kind: "test" }).where(eq(jobs.id, id));
    expect(same.affectedRows).toBe(1);
    expect(await renewLease(id, "w1", 60)).toBe(true);
    expect(await renewLease(id, "w1", 60)).toBe(true);
  });
});

describe("retrying", () => {
  it("a retryable failure goes back to the queue, and no worker takes it before its backoff is up", async () => {
    const id = await enqueue({ maxAttempts: 5 });
    await claimNextJob("w1", 60);
    // Its third attempt, two having failed before it: the backoff is 8 s.
    await getDb().update(jobs).set({ attempts: 3 }).where(eq(jobs.id, id));
    expect(await failJobAttempt({ id, attempts: 3, maxAttempts: 5 }, "w1", "deadlock", true)).toBe("retry");
    expect(await row(id)).toMatchObject({ status: "queued", leaseOwner: null, lastError: "deadlock" });

    expect(await claimNextJob("w2", 60)).toBeNull();
    expect(await secondsUntil(id, jobs.runAfter)).toBeGreaterThanOrEqual(7);
    expect(await secondsUntil(id, jobs.runAfter)).toBeLessThanOrEqual(8);

    await getDb().update(jobs).set({ runAfter: sql`now()` }).where(eq(jobs.id, id));
    expect(await claimNextJob("w2", 60)).toMatchObject({ kind: "claimed", job: { id, attempts: 4, leaseOwner: "w2" } });
  });

  it("an admin retries or cancels only their own workspace's jobs", async () => {
    const [{ id: failedA }] = await getDb()
      .insert(jobs)
      .values({ workspaceId: A, kind: "test", status: "failed", attempts: 3, lastError: "boom", finishedAt: new Date() })
      .$returningId();
    const queuedA = await enqueue();

    expect(await requeueFailedJob(B, failedA, "B's admin")).toBeNull();
    expect(await cancelQueuedJob(B, queuedA, "B's admin")).toBeNull();
    expect(await row(failedA)).toMatchObject({ status: "failed", attempts: 3, lastError: "boom" });
    expect(await row(queuedA)).toMatchObject({ status: "queued", lastError: null });

    expect(await requeueFailedJob(A, failedA, "A's admin")).toMatchObject({
      status: "queued",
      attempts: 0,
      finishedAt: null,
      lastError: "boom\nretried by A's admin",
    });
    expect(await cancelQueuedJob(A, queuedA, "A's admin")).toMatchObject({ status: "failed", lastError: "cancelled by A's admin" });
  });

  it("a running job cannot be cancelled", async () => {
    const id = await enqueue();
    await claimNextJob("w1", 60);
    expect(await cancelQueuedJob(A, id, "A's admin")).toBeNull();
    expect(await row(id)).toMatchObject({ status: "running", leaseOwner: "w1" });
  });
});

describe("workers", () => {
  const seen = () =>
    getDb()
      .select({ id: workers.id, status: workers.status, jobsSucceeded: workers.jobsSucceeded, jobsFailed: workers.jobsFailed, ago: sql<number>`timestampdiff(second, ${workers.lastSeenAt}, now())` })
      .from(workers)
      .orderBy(workers.id);

  it("a restart under the same id registers it afresh", async () => {
    await registerWorker("w-1", "host-1", null);
    await getDb().update(workers).set({ status: "stopped", lastSeenAt: sql`now() - interval 1 hour` }).where(eq(workers.id, "w-1"));

    await registerWorker("w-1", "host-1", null);

    const [again] = await seen();
    expect(again).toMatchObject({ id: "w-1", status: "running" });
    expect(Number(again.ago)).toBeLessThanOrEqual(2);
  });

  it("a heartbeat records the worker's state, and forgets workers gone for a day", async () => {
    await registerWorker("w-old", "host-1", "1.0.0");
    await registerWorker("w-new", "host-2", null);
    await getDb().update(workers).set({ lastSeenAt: sql`now() - interval 25 hour` }).where(eq(workers.id, "w-old"));

    await workerHeartbeat("w-new", { status: "running", currentJobId: null, succeeded: 3, failed: 1 });

    const left = await seen();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: "w-new", status: "running", jobsSucceeded: 3, jobsFailed: 1 });
  });
});
