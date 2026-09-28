/**
 * The job queue on a real MySQL. jobQueue.test.ts checks the SQL the queue
 * writes; this checks what that SQL does. Row locks keep workers claiming at
 * once off each other's jobs, leases run out on the database's clock, and a
 * worker that lost its lease cannot write over the one that took the job.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { jobs, workers, workspaces } from "@db/schema";
import { closeDb, getDb } from "../../queries/connection";
import {
  cancelQueuedJob,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJobAttempt,
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
/** Moves a job's lease into the past, as if its worker had stopped renewing it. */
const lapse = (id: number) => getDb().update(jobs).set({ leaseExpiresAt: sql`now() - interval 1 second` }).where(eq(jobs.id, id));

describe("claiming", () => {
  it("workers claiming at once never take the same job, and between them take every one", async () => {
    const ids = [];
    for (let i = 0; i < 40; i++) ids.push(await enqueue());
    const names = ["w1", "w2", "w3", "w4", "w5"];

    const taken = await Promise.all(
      names.map(async (w) => {
        const mine: number[] = [];
        for (let r = await claimNextJob(w, 60); r; r = await claimNextJob(w, 60)) mine.push(r.job.id);
        return mine;
      }),
    );

    expect(taken.flat().sort((a, b) => a - b)).toEqual(ids);
    for (const [i, w] of names.entries()) {
      for (const id of taken[i]) expect(await row(id)).toMatchObject({ status: "running", leaseOwner: w, attempts: 1 });
    }
  });

  it("a live lease keeps a job; once it runs out on the database's clock, another worker takes it", async () => {
    const id = await enqueue();
    expect((await claimNextJob("w1", 1))?.job.id).toBe(id);
    expect(await claimNextJob("w2", 60)).toBeNull();

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
    const id = await enqueue();
    const first = await claimNextJob("w1", 60);
    expect(await failJobAttempt(first!.job, "w1", "deadlock", true)).toBe("retry");
    expect(await row(id)).toMatchObject({ status: "queued", leaseOwner: null, lastError: "deadlock" });

    expect(await claimNextJob("w2", 60)).toBeNull();
    const [{ wait }] = await getDb()
      .select({ wait: sql<number>`timestampdiff(second, now(), ${jobs.runAfter})` })
      .from(jobs)
      .where(eq(jobs.id, id));
    expect(Number(wait)).toBeGreaterThanOrEqual(1);
    expect(Number(wait)).toBeLessThanOrEqual(2);

    await getDb().update(jobs).set({ runAfter: sql`now()` }).where(eq(jobs.id, id));
    expect(await claimNextJob("w2", 60)).toMatchObject({ kind: "claimed", job: { id, attempts: 2, leaseOwner: "w2" } });
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
  it("a restart under the same id re-registers it, and a heartbeat forgets workers gone for a day", async () => {
    await registerWorker("w-old", "host-1", "1.0.0");
    await registerWorker("w-new", "host-2", null);
    await registerWorker("w-new", "host-2", null);
    await getDb().update(workers).set({ lastSeenAt: sql`now() - interval 25 hour` }).where(eq(workers.id, "w-old"));

    await workerHeartbeat("w-new", { status: "running", currentJobId: null, succeeded: 3, failed: 1 });

    const left = await getDb().select().from(workers);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: "w-new", status: "running", jobsSucceeded: 3, jobsFailed: 1 });
  });
});
