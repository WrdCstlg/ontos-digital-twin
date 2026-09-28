/**
 * MySQL named locks (lib/namedLock.ts), against a connection that answers
 * from a script. What MySQL itself does with GET_LOCK is left to a test on a
 * real server; here: the lock is asked for on one connection and released on
 * it, the task runs only while it is held, and a connection whose state is
 * unknown is closed rather than returned to the pool.
 */
import { describe, expect, it, vi } from "vitest";
import { lockName, LockUnavailable, withNamedLock, type LockConnection } from "../lib/namedLock";

function connection(answers: { get?: unknown; getFails?: boolean; releaseFails?: boolean } = {}) {
  const calls: string[] = [];
  const conn: LockConnection & { calls: string[] } = {
    calls,
    query: vi.fn(async (sql: string, values: unknown[]) => {
      calls.push(`${sql} ${JSON.stringify(values)}`);
      if (sql.startsWith("SELECT GET_LOCK")) {
        if (answers.getFails) throw new Error("connection lost");
        // MySQL answers 1 (granted), 0 (timed out) or NULL (an error).
        return [[{ granted: "get" in answers ? answers.get : 1 }], []];
      }
      if (answers.releaseFails) throw new Error("connection lost");
      return [[{ released: 1 }], []];
    }),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  return conn;
}

describe("withNamedLock", () => {
  it("runs the task while holding the lock, then releases it and returns the connection", async () => {
    const conn = connection();
    const order: string[] = [];
    const result = await withNamedLock(async () => conn, "ontos:engine:x", 60, async () => {
      order.push(`task after ${conn.calls.length} call(s)`);
      return 42;
    });
    expect(result).toBe(42);
    expect(conn.calls).toEqual(['SELECT GET_LOCK(?, ?) AS granted ["ontos:engine:x",60]', 'SELECT RELEASE_LOCK(?) ["ontos:engine:x"]']);
    expect(order).toEqual(["task after 1 call(s)"]);
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
  });

  it("does not run the task when the lock stays held elsewhere, and says so", async () => {
    for (const refused of [0, null]) {
      const conn = connection({ get: refused });
      const task = vi.fn(async () => 1);
      await expect(withNamedLock(async () => conn, "l", 5, task)).rejects.toThrow(new LockUnavailable("lock l stayed held elsewhere for 5 s"));
      expect(task).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalledTimes(1);
    }
  });

  it("releases the lock when the task fails, and passes the task's error on", async () => {
    const conn = connection();
    await expect(withNamedLock(async () => conn, "l", 5, async () => Promise.reject(new Error("engine answered 500")))).rejects.toThrow(
      "engine answered 500",
    );
    expect(conn.calls.at(-1)).toBe('SELECT RELEASE_LOCK(?) ["l"]');
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("closes a connection that failed mid-way instead of pooling it: MySQL has freed its lock with it", async () => {
    const lost = connection({ getFails: true });
    await expect(withNamedLock(async () => lost, "l", 5, async () => 1)).rejects.toBeInstanceOf(LockUnavailable);
    expect(lost.destroy).toHaveBeenCalledTimes(1);
    expect(lost.release).not.toHaveBeenCalled();

    const dropped = connection({ releaseFails: true });
    expect(await withNamedLock(async () => dropped, "l", 5, async () => "done")).toBe("done");
    expect(dropped.destroy).toHaveBeenCalledTimes(1);
    expect(dropped.release).not.toHaveBeenCalled();
  });

  it("says the database could not be reached when no connection could be had", async () => {
    await expect(withNamedLock(async () => Promise.reject(new Error("ECONNREFUSED")), "l", 5, async () => 1)).rejects.toThrow(
      /could not reach the database for lock l: ECONNREFUSED/,
    );
  });
});

describe("lockName", () => {
  it("fits MySQL's 64 characters whatever the key, and tells keys apart", () => {
    const a = lockName("engine", `http://${"x".repeat(500)}:8085`);
    const b = lockName("engine", "http://engine-worker:8085");
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
    expect(lockName("engine", "http://engine-worker:8085")).toBe(b);
  });
});
