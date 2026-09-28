/**
 * operations.listWorkers: workers serve every workspace, so an admin sees
 * which job one is running only when that job is their workspace's. The
 * query computes columns in SQL (timestampdiff), which the in-memory database
 * cannot, so the database here answers each query in turn from a script.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { appRouter } from "../router";
import { createMockContext, mockAdminUser, mockViewerUser, mockWorkspaceBeta } from "./testHarness";

const answers: unknown[][] = [];
const wheres: SQL[] = [];
vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (w: SQL) => (wheres.push(w), chain),
        orderBy: () => chain,
        limit: () => chain,
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(answers.shift() ?? []).then(ok, fail),
      };
      return chain;
    },
  }),
}));

const at = new Date("2026-01-01T00:00:00Z");
const B = mockWorkspaceBeta;
const as = (role: "viewer" | "admin") =>
  appRouter.createCaller(
    createMockContext({
      user: role === "admin" ? mockAdminUser : mockViewerUser,
      workspace: B,
      membership: { id: 900, workspaceId: B.id, userId: 1, role, moduleScope: null, createdAt: at },
    }),
  );
const worker = (id: string, currentJobId: number | null) => ({
  id, hostname: `host-${id}`, version: "1", status: "running", currentJobId, jobsSucceeded: 3, jobsFailed: 0,
  startedAt: at, lastSeenAt: at, secondsSinceSeen: 2,
});

afterEach(() => {
  answers.length = 0;
  wheres.length = 0;
});

describe("operations.listWorkers", () => {
  it("names the job a worker runs only when it is this workspace's", async () => {
    answers.push([worker("a", 41), worker("b", 99), worker("c", null)], [{ id: 41 }]);
    const seen = await as("admin").operations.listWorkers();
    expect(seen.map((w) => [w.id, w.currentJobId, w.busyElsewhere])).toEqual([
      ["a", 41, false],
      ["b", null, true],
      ["c", null, false],
    ]);
    // The jobs looked up were those being run, and only among this workspace's.
    const { sql, params } = new MySqlDialect().sqlToQuery(wheres[0]);
    expect(sql).toContain("`jobs`.`workspaceId` = ?");
    expect(params).toEqual([B.id, 41, 99]);
  });

  it("asks nothing more when no worker is running a job", async () => {
    answers.push([worker("c", null)]);
    expect((await as("admin").operations.listWorkers())[0]).toMatchObject({ currentJobId: null, busyElsewhere: false });
    expect(wheres).toEqual([]);
  });

  it("is for admins", async () => {
    await expect(as("viewer").operations.listWorkers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
