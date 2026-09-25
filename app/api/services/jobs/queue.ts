import { and, desc, eq, lt, lte, or, sql } from "drizzle-orm";
import { jobs, workers, type Job } from "@db/schema";
import { getDb } from "../../queries/connection";

/**
 * A durable job queue in MySQL.
 *
 * The web app enqueues. A worker claims one job at a time with
 * `SELECT … FOR UPDATE SKIP LOCKED`, so any number of workers can poll the same
 * table without taking the same job, and holds it under a lease it renews while
 * it works. If the worker dies, the lease lapses and the job becomes claimable
 * again. Every write that finishes a job is conditional on the caller still
 * holding the lease, so a worker that lost it (paused past the lease, then woke)
 * cannot overwrite the result of the worker that took over.
 *
 * All times are the database's `now()`, so workers on different hosts never
 * disagree about when a lease ran out.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/** How long a claim lasts without renewal. Workers renew at a third of this. */
export const DEFAULT_LEASE_SECONDS = 15;

export type EnqueueOptions = {
  workspaceId: number;
  kind: string;
  payload: unknown;
  maxAttempts?: number;
  createdBy?: string;
};

export async function enqueueJob(db: DbOrTx, opts: EnqueueOptions): Promise<number> {
  const [{ id }] = await db
    .insert(jobs)
    .values({
      workspaceId: opts.workspaceId,
      kind: opts.kind,
      payloadJson: opts.payload,
      maxAttempts: opts.maxAttempts ?? 3,
      createdBy: opts.createdBy ?? null,
    })
    .$returningId();
  return id;
}

export type ClaimResult =
  | { kind: "claimed"; job: Job }
  // The job's lease lapsed on its last allowed attempt: it is now failed, and
  // whatever it was doing needs its domain state closed too.
  | { kind: "abandoned"; job: Job };

/**
 * Takes the next runnable job: a queued job whose time has come, or a running
 * job whose worker stopped renewing its lease.
 */
export async function claimNextJob(
  workerId: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<ClaimResult | null> {
  return getDb().transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, "queued"), lte(jobs.runAfter, sql`now()`)),
          and(eq(jobs.status, "running"), lt(jobs.leaseExpiresAt, sql`now()`)),
        ),
      )
      .orderBy(jobs.id)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;

    if (candidate.status === "running" && candidate.attempts >= candidate.maxAttempts) {
      const reason =
        `lease held by ${candidate.leaseOwner ?? "a worker"} expired on attempt ` +
        `${candidate.attempts} of ${candidate.maxAttempts}; the worker stopped responding`;
      await tx
        .update(jobs)
        .set({
          status: "failed",
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: sql`now()`,
          lastError: reason,
        })
        .where(eq(jobs.id, candidate.id));
      return { kind: "abandoned", job: { ...candidate, status: "failed", lastError: reason } };
    }

    const reclaimed = candidate.status === "running";
    await tx
      .update(jobs)
      .set({
        status: "running",
        leaseOwner: workerId,
        leaseExpiresAt: sql`now() + interval ${leaseSeconds} second`,
        attempts: sql`${jobs.attempts} + 1`,
        startedAt: sql`coalesce(${jobs.startedAt}, now())`,
        lastError: reclaimed
          ? `lease held by ${candidate.leaseOwner ?? "a worker"} expired; reclaimed by ${workerId}`
          : candidate.lastError,
      })
      .where(eq(jobs.id, candidate.id));
    const [claimed] = await tx.select().from(jobs).where(eq(jobs.id, candidate.id));
    return { kind: "claimed", job: claimed };
  });
}

/** Extends the lease. False means this worker no longer holds the job. */
export async function renewLease(
  jobId: number,
  workerId: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<boolean> {
  const [res] = await getDb()
    .update(jobs)
    .set({ leaseExpiresAt: sql`now() + interval ${leaseSeconds} second` })
    .where(and(eq(jobs.id, jobId), eq(jobs.leaseOwner, workerId), eq(jobs.status, "running")));
  return res.affectedRows === 1;
}

/** Records success. False means the lease was lost and the result is not ours to write. */
export async function completeJob(jobId: number, workerId: string, result: unknown): Promise<boolean> {
  const [res] = await getDb()
    .update(jobs)
    .set({
      status: "succeeded",
      resultJson: result ?? null,
      finishedAt: sql`now()`,
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.leaseOwner, workerId), eq(jobs.status, "running")));
  return res.affectedRows === 1;
}

/** Seconds before retry attempt n (1-based): 2, 4, 8 … capped at a minute. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(60, 2 ** Math.max(1, attempt));
}

export type FailOutcome = "retry" | "failed" | "lost";

/**
 * Records a failed attempt. A retryable failure with attempts left goes back to
 * the queue after a backoff; anything else fails the job for good.
 */
export async function failJobAttempt(
  job: Pick<Job, "id" | "attempts" | "maxAttempts">,
  workerId: string,
  error: string,
  retryable: boolean,
): Promise<FailOutcome> {
  const retry = retryable && job.attempts < job.maxAttempts;
  const [res] = await getDb()
    .update(jobs)
    .set(
      retry
        ? {
            status: "queued",
            runAfter: sql`now() + interval ${retryDelaySeconds(job.attempts)} second`,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: error,
          }
        : {
            status: "failed",
            finishedAt: sql`now()`,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: error,
          },
    )
    .where(and(eq(jobs.id, job.id), eq(jobs.leaseOwner, workerId), eq(jobs.status, "running")));
  if (res.affectedRows !== 1) return "lost";
  return retry ? "retry" : "failed";
}

/** Puts a failed job back in the queue with a fresh set of attempts. */
export async function requeueFailedJob(workspaceId: number, jobId: number, by: string): Promise<Job | null> {
  const db = getDb();
  const [res] = await db
    .update(jobs)
    .set({
      status: "queued",
      attempts: 0,
      runAfter: sql`now()`,
      finishedAt: null,
      lastError: sql`concat(coalesce(${jobs.lastError}, ''), ${`\nretried by ${by}`})`,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId), eq(jobs.status, "failed")));
  if (res.affectedRows !== 1) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  return job ?? null;
}

/**
 * Cancels a job that has not started. A running job cannot be cancelled here:
 * stopping it safely needs the handler's cooperation, which this queue does
 * not ask for yet.
 */
export async function cancelQueuedJob(workspaceId: number, jobId: number, by: string): Promise<Job | null> {
  const db = getDb();
  const [res] = await db
    .update(jobs)
    .set({ status: "failed", finishedAt: sql`now()`, lastError: `cancelled by ${by}` })
    .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId), eq(jobs.status, "queued")));
  if (res.affectedRows !== 1) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  return job ?? null;
}

export async function getJob(workspaceId: number, jobId: number): Promise<Job | null> {
  const [job] = await getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId)))
    .limit(1);
  return job ?? null;
}

/* ── worker registry ─────────────────────────────────────────── */

export async function registerWorker(id: string, hostname: string, version: string | null): Promise<void> {
  await getDb()
    .insert(workers)
    .values({ id, hostname, version, status: "running" })
    .onDuplicateKeyUpdate({ set: { status: "running", lastSeenAt: sql`now()` } });
}

export async function workerHeartbeat(
  id: string,
  state: { status: "running" | "stopping" | "stopped"; currentJobId: number | null; succeeded: number; failed: number },
): Promise<void> {
  const db = getDb();
  await db
    .update(workers)
    .set({
      status: state.status,
      currentJobId: state.currentJobId,
      jobsSucceeded: state.succeeded,
      jobsFailed: state.failed,
      lastSeenAt: sql`now()`,
    })
    .where(eq(workers.id, id));
  // Every restart registers a new id; forget the ones gone for a day.
  await db.delete(workers).where(lt(workers.lastSeenAt, sql`now() - interval 1 day`));
}

export async function listRecentJobs(workspaceId: number, limit: number): Promise<Job[]> {
  return getDb()
    .select()
    .from(jobs)
    .where(eq(jobs.workspaceId, workspaceId))
    .orderBy(desc(jobs.id))
    .limit(limit);
}
