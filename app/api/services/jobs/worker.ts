import os from "node:os";
import { randomUUID } from "node:crypto";
import type { Job } from "@db/schema";
import * as queue from "./queue";

/** A failure that retrying cannot fix, such as a job whose target was deleted. */
export class PermanentJobError extends Error {}

export type JobContext = {
  job: Job;
  workerId: string;
  /** Aborted when the worker loses the lease or is shutting down. */
  signal: AbortSignal;
};

export type JobHandler = {
  run(ctx: JobContext): Promise<unknown>;
  /** A retry was scheduled: put the domain record back into its waiting state. */
  onRetry?(job: Job, error: string): Promise<void>;
  /** The job failed for good, including a lease that lapsed on its last attempt. */
  onFailed?(job: Job, error: string): Promise<void>;
  /** An admin put the failed job back in the queue. */
  onRequeued?(job: Job): Promise<void>;
};

/** The queue operations a worker needs, swappable so the loop can be tested without MySQL. */
export type QueueOps = {
  claim: typeof queue.claimNextJob;
  renew: typeof queue.renewLease;
  complete: typeof queue.completeJob;
  fail: typeof queue.failJobAttempt;
  register: typeof queue.registerWorker;
  heartbeat: typeof queue.workerHeartbeat;
};

const mysqlQueue: QueueOps = {
  claim: queue.claimNextJob,
  renew: queue.renewLease,
  complete: queue.completeJob,
  fail: queue.failJobAttempt,
  register: queue.registerWorker,
  heartbeat: queue.workerHeartbeat,
};

export type WorkerOptions = {
  handlers: Record<string, JobHandler>;
  id?: string;
  version?: string | null;
  leaseSeconds?: number;
  /** Pause between polls when the queue is empty. */
  pollMs?: number;
  /** How often the worker's row in `workers` is refreshed. */
  heartbeatMs?: number;
  queue?: Partial<QueueOps>;
  log?: (line: string) => void;
};

export type WorkerStatus = {
  id: string;
  state: "idle" | "running" | "stopping" | "stopped";
  currentJobId: number | null;
  succeeded: number;
  failed: number;
  lastLoopAt: number;
  lastError: string | null;
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs jobs one at a time: claim, run the kind's handler while renewing the
 * lease, then record the outcome. Several workers can run against one database.
 */
export class JobWorker {
  readonly id: string;
  private readonly handlers: Record<string, JobHandler>;
  private readonly q: QueueOps;
  private readonly leaseSeconds: number;
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  private readonly version: string | null;
  private readonly log: (line: string) => void;

  private state: WorkerStatus["state"] = "idle";
  private current: { job: Job; controller: AbortController } | null = null;
  private loopDone: Promise<void> = Promise.resolve();
  private wake: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private succeeded = 0;
  private failed = 0;
  private lastLoopAt = 0;
  private lastError: string | null = null;

  constructor(opts: WorkerOptions) {
    this.id = opts.id ?? `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.handlers = opts.handlers;
    this.q = { ...mysqlQueue, ...opts.queue };
    this.leaseSeconds = opts.leaseSeconds ?? queue.DEFAULT_LEASE_SECONDS;
    this.pollMs = opts.pollMs ?? 1000;
    this.heartbeatMs = opts.heartbeatMs ?? 5000;
    this.version = opts.version ?? null;
    this.log = opts.log ?? ((line) => console.log(`[worker ${this.id}] ${line}`));
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "running";
    this.heartbeatTimer = setInterval(() => void this.beat(), this.heartbeatMs);
    this.loopDone = this.loop();
  }

  /**
   * Stops claiming work and lets the current job finish within `graceMs`. A job
   * still running after that is aborted and goes back to the queue.
   */
  async stop(graceMs = 5000): Promise<void> {
    if (this.state !== "running") return;
    this.state = "stopping";
    this.wake?.();
    await this.beat();
    if (this.current) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        this.loopDone.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), graceMs);
        }),
      ]);
      clearTimeout(timer);
      if (timedOut) this.current?.controller.abort(new Error("worker stopping"));
    }
    await this.loopDone;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.state = "stopped";
    await this.beat();
  }

  status(): WorkerStatus {
    return {
      id: this.id,
      state: this.state,
      currentJobId: this.current?.job.id ?? null,
      succeeded: this.succeeded,
      failed: this.failed,
      lastLoopAt: this.lastLoopAt,
      lastError: this.lastError,
    };
  }

  private async beat(): Promise<void> {
    try {
      await this.q.heartbeat(this.id, {
        status: this.state === "stopped" ? "stopped" : this.state === "stopping" ? "stopping" : "running",
        currentJobId: this.current?.job.id ?? null,
        succeeded: this.succeeded,
        failed: this.failed,
      });
    } catch (err) {
      this.lastError = message(err);
    }
  }

  private idle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  private async loop(): Promise<void> {
    try {
      await this.q.register(this.id, os.hostname(), this.version);
    } catch (err) {
      this.lastError = message(err);
      this.log(`could not register: ${this.lastError}`);
    }
    while (this.state === "running") {
      this.lastLoopAt = Date.now();
      let claim: queue.ClaimResult | null = null;
      try {
        claim = await this.q.claim(this.id, this.leaseSeconds);
      } catch (err) {
        this.lastError = message(err);
        this.log(`claim failed: ${this.lastError}`);
      }
      if (!claim) {
        await this.idle(this.pollMs);
        continue;
      }
      if (claim.kind === "abandoned") {
        const reason = claim.job.lastError ?? "abandoned";
        this.log(`job ${claim.job.id} (${claim.job.kind}) abandoned: ${reason}`);
        await this.handlers[claim.job.kind]?.onFailed?.(claim.job, reason).catch((err) =>
          this.log(`onFailed for job ${claim.job.id} failed: ${message(err)}`),
        );
        continue;
      }
      await this.runJob(claim.job);
    }
  }

  private async runJob(job: Job): Promise<void> {
    const handler = this.handlers[job.kind];
    if (!handler) {
      const outcome = await this.q
        .fail(job, this.id, `no handler for job kind "${job.kind}" in this worker`, false)
        .catch(() => "lost" as const);
      if (outcome === "failed") this.failed++;
      return;
    }

    const controller = new AbortController();
    this.current = { job, controller };
    const renewEvery = Math.max(50, (this.leaseSeconds * 1000) / 3);
    const renewTimer = setInterval(() => {
      this.q
        .renew(job.id, this.id, this.leaseSeconds)
        .then((held) => {
          if (!held && !controller.signal.aborted) {
            this.log(`lost the lease on job ${job.id}; abandoning it`);
            controller.abort(new Error("lease lost"));
          }
        })
        // A failed renewal is not a lost lease: keep trying until it lapses.
        .catch((err) => this.log(`lease renewal for job ${job.id} failed: ${message(err)}`));
    }, renewEvery);

    try {
      const result = await handler.run({ job, workerId: this.id, signal: controller.signal });
      if (await this.q.complete(job.id, this.id, result)) {
        this.succeeded++;
      } else {
        this.log(`job ${job.id} finished after its lease was lost; its result was not recorded`);
      }
    } catch (err) {
      const why = controller.signal.aborted
        ? `interrupted: ${message(controller.signal.reason)}`
        : message(err);
      const retryable = !(err instanceof PermanentJobError);
      const outcome = await this.q.fail(job, this.id, why, retryable).catch((e) => {
        this.log(`recording the failure of job ${job.id} failed: ${message(e)}`);
        return "lost" as const;
      });
      if (outcome === "retry") {
        await handler.onRetry?.(job, why).catch((e) => this.log(`onRetry for job ${job.id} failed: ${message(e)}`));
      } else if (outcome === "failed") {
        this.failed++;
        await handler.onFailed?.(job, why).catch((e) => this.log(`onFailed for job ${job.id} failed: ${message(e)}`));
      }
    } finally {
      clearInterval(renewTimer);
      this.current = null;
    }
  }
}
