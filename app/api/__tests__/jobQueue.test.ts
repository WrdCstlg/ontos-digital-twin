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

// Records every SELECT and UPDATE the queue issues, and answers them from `rec`:
// a claim's first locking read from `lapsed`, its second from `due`.
const rec = vi.hoisted(() => ({
  selects: [] as { from?: unknown[]; where?: unknown; orderBy?: unknown[]; forArgs?: unknown[] }[],
  updates: [] as { set?: Record<string, unknown>; where?: unknown }[],
  lapsed: undefined as Record<string, unknown> | undefined,
  due: undefined as Record<string, unknown> | undefined,
  claimed: undefined as Record<string, unknown> | undefined,
  affectedRows: 1,
  txConfig: undefined as unknown,
}));

vi.mock("../queries/connection", () => {
  function selectChain() {
    const q: { from?: unknown[]; where?: unknown; orderBy?: unknown[]; forArgs?: unknown[] } = {};
    rec.selects.push(q);
    const chain: Record<string, unknown> = {
      from: (...args: unknown[]) => {
        q.from = args;
        return chain;
      },
      where: (w: unknown) => {
        q.where = w;
        return chain;
      },
      orderBy: (...args: unknown[]) => {
        q.orderBy = args;
        return chain;
      },
      limit: () => chain,
      for: (...args: unknown[]) => {
        q.forArgs = args;
        const answer = rec.selects.filter((s) => s.forArgs).length === 1 ? rec.lapsed : rec.due;
        return Promise.resolve(answer ? [answer] : []);
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
    transaction: async (cb: (tx: unknown) => unknown, config?: unknown) => {
      rec.txConfig = config;
      return cb(db);
    },
  };
  return { getDb: () => db };
});

const dialect = new MySqlDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);
const locking = () => rec.selects.filter((s) => s.forArgs);
const columns = (orderBy: unknown[] | undefined) => (orderBy as { name: string }[]).map((c) => c.name);

afterEach(() => {
  rec.selects.length = 0;
  rec.updates.length = 0;
  rec.lapsed = rec.due = rec.claimed = undefined;
  rec.affectedRows = 1;
  rec.txConfig = undefined;
});

describe("claimNextJob", () => {
  it("takes a job whose lease lapsed before any queued one, locking that row alone, under read committed", async () => {
    rec.lapsed = { id: 6, status: "running", attempts: 1, maxAttempts: 3, leaseOwner: "w-dead", lastError: null };
    rec.due = { id: 2, status: "queued", attempts: 0, maxAttempts: 3, leaseOwner: null, lastError: null };
    rec.claimed = { id: 6, status: "running", attempts: 2, leaseOwner: "w1" };

    const res = await claimNextJob("w1", 15);

    expect(rec.txConfig).toEqual({ isolationLevel: "read committed" });
    // The due job was never read, so never locked: one claim holds one row.
    expect(locking()).toHaveLength(1);
    const [lapsed] = locking();
    expect(lapsed.forArgs).toEqual(["update", { skipLocked: true }]);
    expect(lapsed.from?.[1]).toEqual({ forceIndex: "jobs_status_run_after" });
    expect(render(lapsed.where)).toMatchObject({ sql: "(`jobs`.`status` = ? and `jobs`.`leaseExpiresAt` < now())", params: ["running"] });
    expect(columns(lapsed.orderBy)).toEqual(["id"]);
    expect(res).toEqual({ kind: "claimed", job: rec.claimed });
  });

  it("else takes the next due queued job, in the order jobs fell due, read through the index in its order", async () => {
    rec.due = { id: 5, status: "queued", attempts: 0, maxAttempts: 3, leaseOwner: null, lastError: null };
    rec.claimed = { id: 5, status: "running", attempts: 1, leaseOwner: "w1" };

    const res = await claimNextJob("w1", 15);

    expect(locking()).toHaveLength(2);
    const due = locking()[1];
    expect(due.forArgs).toEqual(["update", { skipLocked: true }]);
    expect(due.from?.[1]).toEqual({ forceIndex: "jobs_status_run_after" });
    expect(render(due.where)).toMatchObject({ sql: "(`jobs`.`status` = ? and `jobs`.`runAfter` <= now())", params: ["queued"] });
    expect(columns(due.orderBy)).toEqual(["runAfter", "id"]);
    expect(rec.updates[0].set).toMatchObject({ status: "running", leaseOwner: "w1" });
    expect(res).toEqual({ kind: "claimed", job: rec.claimed });
  });

  it("records who lost a lapsed lease when it reclaims the job", async () => {
    rec.lapsed = { id: 6, status: "running", attempts: 1, maxAttempts: 3, leaseOwner: "w-dead", lastError: null };
    rec.claimed = { id: 6, status: "running", attempts: 2, leaseOwner: "w2" };

    await claimNextJob("w2", 15);

    expect(rec.updates[0].set).toMatchObject({
      status: "running",
      leaseOwner: "w2",
      lastError: "lease held by w-dead expired; reclaimed by w2",
    });
  });

  it("fails a job whose lease lapsed on its last attempt instead of running it again", async () => {
    rec.lapsed = { id: 7, status: "running", attempts: 3, maxAttempts: 3, leaseOwner: "w-dead", lastError: null };

    const res = await claimNextJob("w3", 15);

    expect(res?.kind).toBe("abandoned");
    expect(rec.updates[0].set).toMatchObject({ status: "failed", leaseOwner: null });
    expect(String(rec.updates[0].set?.lastError)).toContain("expired on attempt 3 of 3");
  });

  it("returns nothing when no job is runnable", async () => {
    expect(await claimNextJob("w1", 15)).toBeNull();
    expect(locking()).toHaveLength(2);
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
