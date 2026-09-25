import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  claimNextJob,
  completeJob,
  failJobAttempt,
  renewLease,
  retryDelaySeconds,
} from "../services/jobs/queue";

// Records every SELECT and UPDATE the queue issues, and answers them from `rec`.
const rec = vi.hoisted(() => ({
  selects: [] as { where?: unknown; forArgs?: unknown[] }[],
  updates: [] as { set?: Record<string, unknown>; where?: unknown }[],
  candidate: undefined as Record<string, unknown> | undefined,
  claimed: undefined as Record<string, unknown> | undefined,
  affectedRows: 1,
}));

vi.mock("../queries/connection", () => {
  function selectChain() {
    const q: { where?: unknown; forArgs?: unknown[] } = {};
    rec.selects.push(q);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (w: unknown) => {
        q.where = w;
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      for: (...args: unknown[]) => {
        q.forArgs = args;
        return Promise.resolve(rec.candidate ? [rec.candidate] : []);
      },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        Promise.resolve(rec.claimed ? [rec.claimed] : []).then(ok, bad),
    };
    return chain;
  }
  function updateChain() {
    const u: { set?: Record<string, unknown>; where?: unknown } = {};
    rec.updates.push(u);
    const chain = {
      set: (v: Record<string, unknown>) => {
        u.set = v;
        return chain;
      },
      where: (w: unknown) => {
        u.where = w;
        return Promise.resolve([{ affectedRows: rec.affectedRows }]);
      },
    };
    return chain;
  }
  const db: Record<string, unknown> = {
    select: () => selectChain(),
    update: () => updateChain(),
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  };
  return { getDb: () => db };
});

const dialect = new MySqlDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

afterEach(() => {
  rec.selects.length = 0;
  rec.updates.length = 0;
  rec.candidate = rec.claimed = undefined;
  rec.affectedRows = 1;
});

describe("claimNextJob", () => {
  it("takes a due queued job or a lapsed running one, skipping rows other workers have locked", async () => {
    rec.candidate = { id: 5, status: "queued", attempts: 0, maxAttempts: 3, leaseOwner: null, lastError: null };
    rec.claimed = { id: 5, status: "running", attempts: 1, leaseOwner: "w1" };

    const res = await claimNextJob("w1", 15);

    expect(rec.selects[0].forArgs).toEqual(["update", { skipLocked: true }]);
    const { sql, params } = render(rec.selects[0].where);
    expect(sql).toContain("`jobs`.`status` = ? and `jobs`.`runAfter` <= now()");
    expect(sql).toContain("`jobs`.`status` = ? and `jobs`.`leaseExpiresAt` < now()");
    expect(params).toEqual(["queued", "running"]);
    expect(rec.updates[0].set).toMatchObject({ status: "running", leaseOwner: "w1" });
    expect(res).toEqual({ kind: "claimed", job: rec.claimed });
  });

  it("records who lost a lapsed lease when it reclaims the job", async () => {
    rec.candidate = { id: 6, status: "running", attempts: 1, maxAttempts: 3, leaseOwner: "w-dead", lastError: null };
    rec.claimed = { id: 6, status: "running", attempts: 2, leaseOwner: "w2" };

    await claimNextJob("w2", 15);

    expect(rec.updates[0].set).toMatchObject({
      status: "running",
      leaseOwner: "w2",
      lastError: "lease held by w-dead expired; reclaimed by w2",
    });
  });

  it("fails a job whose lease lapsed on its last attempt instead of running it again", async () => {
    rec.candidate = { id: 7, status: "running", attempts: 3, maxAttempts: 3, leaseOwner: "w-dead", lastError: null };

    const res = await claimNextJob("w3", 15);

    expect(res?.kind).toBe("abandoned");
    expect(rec.updates[0].set).toMatchObject({ status: "failed", leaseOwner: null });
    expect(String(rec.updates[0].set?.lastError)).toContain("expired on attempt 3 of 3");
  });

  it("returns nothing when no job is runnable", async () => {
    expect(await claimNextJob("w1", 15)).toBeNull();
    expect(rec.updates).toEqual([]);
  });
});

describe("writes that finish or extend a job are fenced by the lease", () => {
  const fenced = "(`jobs`.`id` = ? and `jobs`.`leaseOwner` = ? and `jobs`.`status` = ?)";

  it("completeJob writes only while the caller holds the lease", async () => {
    expect(await completeJob(9, "w1", { n: 1 })).toBe(true);
    const { sql, params } = render(rec.updates[0].where);
    expect(sql).toBe(fenced);
    expect(params).toEqual([9, "w1", "running"]);
    expect(rec.updates[0].set).toMatchObject({ status: "succeeded", resultJson: { n: 1 }, leaseOwner: null });

    rec.affectedRows = 0;
    expect(await completeJob(9, "w1", {})).toBe(false);
  });

  it("renewLease reports a lost lease", async () => {
    rec.affectedRows = 0;
    expect(await renewLease(9, "w1", 15)).toBe(false);
    expect(render(rec.updates[0].where).sql).toBe(fenced);
  });
});

describe("failJobAttempt", () => {
  it("requeues a retryable failure while attempts remain", async () => {
    expect(await failJobAttempt({ id: 1, attempts: 1, maxAttempts: 3 }, "w1", "deadlock", true)).toBe("retry");
    expect(rec.updates[0].set).toMatchObject({ status: "queued", leaseOwner: null, lastError: "deadlock" });
  });

  it("fails the job on its last attempt, or when the failure is permanent", async () => {
    expect(await failJobAttempt({ id: 1, attempts: 3, maxAttempts: 3 }, "w1", "deadlock", true)).toBe("failed");
    expect(await failJobAttempt({ id: 2, attempts: 1, maxAttempts: 3 }, "w1", "mapping deleted", false)).toBe("failed");
    expect(rec.updates.map((u) => u.set?.status)).toEqual(["failed", "failed"]);
  });

  it("reports a failure recorded after the lease was lost as lost", async () => {
    rec.affectedRows = 0;
    expect(await failJobAttempt({ id: 1, attempts: 1, maxAttempts: 3 }, "w1", "x", true)).toBe("lost");
  });
});

describe("retryDelaySeconds", () => {
  it("doubles from 2 s and stops at a minute", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelaySeconds)).toEqual([2, 4, 8, 16, 32, 60, 60]);
  });
});
