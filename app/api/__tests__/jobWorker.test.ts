import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@db/schema";
import type { ClaimResult, FailOutcome } from "../services/jobs/queue";
import { JobWorker, PermanentJobError, type JobHandler, type QueueOps } from "../services/jobs/worker";

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: 1,
    workspaceId: 1,
    kind: "test.kind",
    payloadJson: {},
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    leaseOwner: "w-test",
    leaseExpiresAt: null,
    runAfter: new Date(),
    lastError: null,
    resultJson: null,
    createdBy: "tester",
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    ...over,
  };
}

/** An in-memory queue: hands out the given claims once each, then nothing. */
function fakeQueue(claims: ClaimResult[], opts: { renew?: boolean; failOutcome?: FailOutcome } = {}) {
  const pending = [...claims];
  const calls = {
    complete: [] as { id: number; result: unknown }[],
    fail: [] as { id: number; error: string; retryable: boolean }[],
    registered: 0,
  };
  const q: QueueOps = {
    claim: vi.fn(async () => pending.shift() ?? null),
    renew: vi.fn(async () => opts.renew ?? true),
    complete: vi.fn(async (id: number, _w: string, result: unknown) => {
      calls.complete.push({ id, result });
      return true;
    }),
    fail: vi.fn(async (job: Pick<Job, "id">, _w: string, error: string, retryable: boolean) => {
      calls.fail.push({ id: job.id, error, retryable });
      return opts.failOutcome ?? (retryable ? "retry" : "failed");
    }),
    register: vi.fn(async () => {
      calls.registered++;
    }),
    heartbeat: vi.fn(async () => undefined),
    sweep: vi.fn(async () => 0),
  };
  return { q, calls, drained: () => pending.length === 0 };
}

const workers: JobWorker[] = [];
function startWorker(handlers: Record<string, JobHandler>, q: QueueOps, leaseSeconds = 15) {
  const w = new JobWorker({ id: "w-test", handlers, queue: q, pollMs: 5, heartbeatMs: 1000, leaseSeconds, log: () => {} });
  workers.push(w);
  w.start();
  return w;
}

async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((w) => w.stop(50)));
});

describe("JobWorker", () => {
  it("runs a claimed job's handler and records its result against the job", async () => {
    const { q, calls } = fakeQueue([{ kind: "claimed", job: makeJob({ id: 7 }) }]);
    const run = vi.fn(async () => ({ imported: 12 }));
    const w = startWorker({ "test.kind": { run } }, q);

    await until(() => calls.complete.length === 1);
    expect(calls.complete[0]).toEqual({ id: 7, result: { imported: 12 } });
    expect(run).toHaveBeenCalledOnce();
    expect(calls.registered).toBe(1);
    expect(w.status().succeeded).toBe(1);
  });

  it("sends a retryable failure back to the queue and resets the domain record", async () => {
    const { q, calls } = fakeQueue([{ kind: "claimed", job: makeJob({ id: 8 }) }]);
    const onRetry = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});
    startWorker({ "test.kind": { run: async () => Promise.reject(new Error("deadlock")), onRetry, onFailed } }, q);

    await until(() => onRetry.mock.calls.length === 1);
    expect(calls.fail).toEqual([{ id: 8, error: "deadlock", retryable: true }]);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }), "deadlock");
    expect(onFailed).not.toHaveBeenCalled();
    expect(calls.complete).toEqual([]);
  });

  it("fails for good on a PermanentJobError and closes the domain record", async () => {
    const { q, calls } = fakeQueue([{ kind: "claimed", job: makeJob({ id: 9 }) }]);
    const onFailed = vi.fn(async () => {});
    const w = startWorker(
      { "test.kind": { run: async () => Promise.reject(new PermanentJobError("mapping deleted")), onFailed } },
      q,
    );

    await until(() => onFailed.mock.calls.length === 1);
    expect(calls.fail).toEqual([{ id: 9, error: "mapping deleted", retryable: false }]);
    expect(w.status().failed).toBe(1);
  });

  it("closes the domain record of a job abandoned on its last attempt, without running it", async () => {
    const abandoned = makeJob({ id: 10, status: "failed", lastError: "lease held by w-old expired on attempt 3 of 3" });
    const { q } = fakeQueue([{ kind: "abandoned", job: abandoned }]);
    const run = vi.fn(async () => ({}));
    const onFailed = vi.fn(async () => {});
    startWorker({ "test.kind": { run, onFailed } }, q);

    await until(() => onFailed.mock.calls.length === 1);
    expect(onFailed).toHaveBeenCalledWith(abandoned, "lease held by w-old expired on attempt 3 of 3");
    expect(run).not.toHaveBeenCalled();
  });

  it("aborts the handler when the lease is lost, and never records a result", async () => {
    // A 0.3 s lease renews every 100 ms; the fake says the lease is gone.
    const { q, calls } = fakeQueue([{ kind: "claimed", job: makeJob({ id: 11 }) }], { renew: false, failOutcome: "lost" });
    let sawAbort = false;
    const run = ({ signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          sawAbort = true;
          reject(new Error("stopped"));
        });
      });
    startWorker({ "test.kind": { run } }, q, 0.3);

    await until(() => calls.fail.length === 1);
    expect(sawAbort).toBe(true);
    expect(calls.fail[0].error).toBe("interrupted: lease lost");
    expect(calls.complete).toEqual([]);
  });

  it("logs when it takes over a job whose lease another worker let lapse", async () => {
    const reclaimed = makeJob({ id: 15, attempts: 2, lastError: "lease held by w-old expired; reclaimed by w-test" });
    const { q, calls } = fakeQueue([{ kind: "claimed", job: reclaimed }]);
    const lines: string[] = [];
    const w = new JobWorker({
      id: "w-test",
      handlers: { "test.kind": { run: async () => ({}) } },
      queue: q,
      pollMs: 5,
      log: (line) => lines.push(line),
    });
    workers.push(w);
    w.start();

    await until(() => calls.complete.length === 1);
    expect(lines).toContain(
      "job 15 (test.kind) attempt 2 of 3: lease held by w-old expired; reclaimed by w-test",
    );
  });

  it("fails a job of a kind it has no handler for, permanently", async () => {
    const { q, calls } = fakeQueue([{ kind: "claimed", job: makeJob({ id: 12, kind: "unknown.kind" }) }]);
    startWorker({}, q);

    await until(() => calls.fail.length === 1);
    expect(calls.fail[0]).toEqual({ id: 12, error: 'no handler for job kind "unknown.kind" in this worker', retryable: false });
  });

  it("on stop, lets a job that finishes within the grace period complete", async () => {
    const { q, calls } = fakeQueue([{ kind: "claimed", job: makeJob({ id: 13 }) }]);
    let started = false;
    const run = async () => {
      started = true;
      await new Promise((r) => setTimeout(r, 60));
      return { ok: true };
    };
    const w = startWorker({ "test.kind": { run } }, q);
    await until(() => started);

    await w.stop(1000);
    expect(calls.complete).toEqual([{ id: 13, result: { ok: true } }]);
    expect(w.status().state).toBe("stopped");
  });

  it("sweeps idle rate-limit rows on its heartbeat, at most once per sweepMs and one sweep at a time", async () => {
    const { q } = fakeQueue([]);
    const starts: number[] = [];
    let inFlight = 0;
    let most = 0;
    q.sweep = vi.fn(async () => {
      starts.push(Date.now());
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight--;
      return 3;
    });
    const lines: string[] = [];
    const w = new JobWorker({ id: "w-test", handlers: {}, queue: q, pollMs: 5, heartbeatMs: 10, sweepMs: 60, log: (l) => lines.push(l) });
    workers.push(w);
    w.start();

    await until(() => starts.length >= 3);
    expect(most).toBe(1);
    // Heartbeats every 10 ms; sweeps start no sooner than 60 ms apart.
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(59);
    expect(lines).toContain("deleted 3 rate-limit rows idle for a day");
  });

  it("logs a failed sweep, goes on running jobs, and sweeps again later", async () => {
    const { q, calls } = fakeQueue([]);
    q.sweep = vi.fn(async () => Promise.reject(new Error("connect ECONNREFUSED")));
    const lines: string[] = [];
    const w = new JobWorker({ id: "w-test", handlers: { "test.kind": { run: async () => ({}) } }, queue: q, pollMs: 5, heartbeatMs: 10, sweepMs: 20, log: (l) => lines.push(l) });
    workers.push(w);
    w.start();

    await until(() => vi.mocked(q.sweep).mock.calls.length >= 2);
    expect(lines).toContain("sweep failed: connect ECONNREFUSED");
    vi.mocked(q.claim).mockResolvedValueOnce({ kind: "claimed", job: makeJob({ id: 16 }) });
    await until(() => calls.complete.length === 1);
    expect(w.status().state).toBe("running");
  });

  it("on stop, lets a sweep under way finish, and starts no other", async () => {
    const { q } = fakeQueue([]);
    let finish: () => void = () => undefined;
    q.sweep = vi.fn(() => new Promise<number>((resolve) => (finish = () => resolve(0))));
    const w = new JobWorker({ id: "w-test", handlers: {}, queue: q, pollMs: 5, heartbeatMs: 10, sweepMs: 10, log: () => {} });
    workers.push(w);
    w.start();
    await until(() => vi.mocked(q.sweep).mock.calls.length === 1);

    let stopped = false;
    const stopping = w.stop(50).then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(stopped).toBe(false);
    finish();
    await stopping;
    expect(w.status().state).toBe("stopped");
    await new Promise((r) => setTimeout(r, 30));
    expect(q.sweep).toHaveBeenCalledOnce();
  });

  it("on stop, aborts a job still running after the grace period and sends it back to the queue", async () => {
    const { q, calls } = fakeQueue([{ kind: "claimed", job: makeJob({ id: 14 }) }]);
    const onRetry = vi.fn(async () => {});
    let started = false;
    const run = ({ signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => {
        started = true;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const w = startWorker({ "test.kind": { run, onRetry } }, q);
    await until(() => started);

    await w.stop(50);
    expect(calls.fail).toEqual([{ id: 14, error: "interrupted: worker stopping", retryable: true }]);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(calls.complete).toEqual([]);
    expect(w.status().state).toBe("stopped");
  });
});
