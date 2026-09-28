/**
 * MySQL named locks (lib/namedLock.ts), against a session that answers from a
 * script; namedLock.mysql.test.ts runs them on a real server. The lock is
 * taken and released on a session of its own, whose idle time is bounded. The
 * task runs only while the lock is held, and is stopped the moment it is not:
 * a session that ends, a heartbeat MySQL does not answer as the holder's, the
 * caller's signal, a hold past its limit. Only a release MySQL confirms lets
 * the task's result through.
 */
import { describe, expect, it, vi } from "vitest";
import { lockName, LockLost, LockUnavailable, LOCK_SESSION_IDLE_SECONDS, withNamedLock } from "../lib/namedLock";
import { fakeLockConnection, untilStopped } from "./fakeLockConnection";

const opts = { waitSeconds: 60, holdMs: 5_000 };
const statements = (conn: ReturnType<typeof fakeLockConnection>) => conn.calls.map((c) => c.split(" ").slice(0, 2).join(" "));

describe("withNamedLock", () => {
  it("runs the task holding the lock, on a session of its own whose idle time is bounded, then releases and closes it", async () => {
    const conn = fakeLockConnection();
    const seen: string[] = [];
    const result = await withNamedLock(async () => conn, "ontos:engine:x", opts, async (signal) => {
      seen.push(`task after ${conn.calls.length} statements, signal ${signal.aborted ? "aborted" : "live"}`);
      return 42;
    });

    expect(result).toBe(42);
    expect(conn.calls).toEqual([
      `SET SESSION wait_timeout = ? [${LOCK_SESSION_IDLE_SECONDS}]`,
      'SELECT GET_LOCK(?, ?) AS granted ["ontos:engine:x",60]',
      'SELECT RELEASE_LOCK(?) AS released ["ontos:engine:x"]',
    ]);
    expect(seen).toEqual(["task after 2 statements, signal live"]);
    expect(conn.end).toHaveBeenCalledTimes(1);
    expect(conn.destroy).not.toHaveBeenCalled();
    expect(LOCK_SESSION_IDLE_SECONDS).toBeLessThanOrEqual(60);
  });

  it("does not run the task when the lock stays held elsewhere, and says so", async () => {
    for (const refused of [0, null]) {
      const conn = fakeLockConnection({ get: refused });
      const task = vi.fn(async () => 1);
      const run = withNamedLock(async () => conn, "l", { ...opts, waitSeconds: 5 }, task);
      await expect(run).rejects.toBeInstanceOf(LockUnavailable);
      await expect(run).rejects.toThrow("lock l stayed held elsewhere for 5 s");
      expect(task).not.toHaveBeenCalled();
      expect(conn.end).toHaveBeenCalledTimes(1);
    }
  });

  it("releases the lock when the task fails, and passes the task's error on", async () => {
    const conn = fakeLockConnection();
    await expect(withNamedLock(async () => conn, "l", opts, async () => Promise.reject(new Error("engine answered 500")))).rejects.toThrow(
      "engine answered 500",
    );
    expect(statements(conn).at(-1)).toBe("SELECT RELEASE_LOCK(?)");
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it("refuses the task's result when MySQL does not confirm the release: the lock was not held to the end", async () => {
    for (const script of [{ releaseFails: true }, { release: 0 }, { release: null }]) {
      const conn = fakeLockConnection(script);
      const run = withNamedLock(async () => conn, "l", opts, async () => "a result taken without the lock");
      await expect(run, JSON.stringify(script)).rejects.toBeInstanceOf(LockLost);
      await expect(run).rejects.toThrow(/^lost lock l while its task ran: /);
    }
  });

  it("stops the task the moment its session ends, and refuses its result even when the task carries on", async () => {
    for (const [end, why] of [
      [(c: ReturnType<typeof fakeLockConnection>) => c.emit("end"), "its connection closed"],
      [(c: ReturnType<typeof fakeLockConnection>) => c.emit("error", new Error("read ECONNRESET")), "its connection failed: read ECONNRESET"],
    ] as const) {
      const conn = fakeLockConnection();
      let told: unknown;
      const run = withNamedLock(async () => conn, "l", opts, async (signal) => {
        end(conn);
        told = signal.aborted && signal.reason;
        return "a result taken without the lock";
      });

      await expect(run).rejects.toThrow(`lost lock l while its task ran: ${why}`);
      expect(told).toBeInstanceOf(LockLost);
      expect((told as Error).message).toBe(`lost lock l: ${why}`);
      // A session gone has no lock to release: it is closed, never reused.
      expect(statements(conn)).not.toContain("SELECT RELEASE_LOCK(?)");
      expect(conn.destroy).toHaveBeenCalledTimes(1);
      expect(conn.end).not.toHaveBeenCalled();
    }
  });

  it("checks its session while the task runs, and stops the task once MySQL no longer answers it as the holder", async () => {
    for (const [script, why] of [
      [{ mine: 0 }, "MySQL no longer counts it as this session's"],
      [{ mine: null }, "MySQL no longer counts it as this session's"],
      [{ heartbeatFails: true }, "checking its session failed: read ECONNRESET"],
    ] as const) {
      const conn = fakeLockConnection(script);
      await expect(withNamedLock(async () => conn, "l", { ...opts, heartbeatMs: 5 }, untilStopped)).rejects.toThrow(
        `lost lock l while its task ran: ${why}`,
      );
      expect(statements(conn)).toContain("SELECT IS_USED_LOCK(?)");
      expect(conn.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("while the holder's heartbeats leave its task alone", async () => {
    const conn = fakeLockConnection();
    const result = await withNamedLock(async () => conn, "l", { ...opts, heartbeatMs: 5 }, async (signal) => {
      await new Promise((r) => setTimeout(r, 40));
      return signal.aborted ? "stopped" : "finished";
    });
    expect(result).toBe("finished");
    expect(statements(conn).filter((s) => s === "SELECT IS_USED_LOCK(?)").length).toBeGreaterThan(1);
  });

  it("does not run the task when the session ends as the lock is granted", async () => {
    const conn = fakeLockConnection({ endOnGrant: true });
    const task = vi.fn(async () => 1);
    await expect(withNamedLock(async () => conn, "l", opts, task)).rejects.toThrow(new LockLost("lost lock l as it was granted: its connection closed"));
    expect(task).not.toHaveBeenCalled();
    expect(conn.destroy).toHaveBeenCalledTimes(1);
  });

  it("calls the wait off when the caller's signal aborts: the task never runs, and the session is closed, not reused", async () => {
    const conn = fakeLockConnection({ getHangs: true });
    const controller = new AbortController();
    const task = vi.fn(async () => 1);
    const run = withNamedLock(async () => conn, "l", { ...opts, signal: controller.signal }, task);
    await vi.waitFor(() => expect(statements(conn)).toContain("SELECT GET_LOCK(?,"));

    controller.abort(new Error("worker stopping"));
    await expect(run).rejects.toThrow(new LockUnavailable("the wait for lock l was called off: worker stopping"));
    expect(task).not.toHaveBeenCalled();
    expect(conn.destroy).toHaveBeenCalledTimes(1);

    const connect = vi.fn(async () => fakeLockConnection());
    await expect(withNamedLock(connect, "l", { ...opts, signal: controller.signal }, task)).rejects.toBeInstanceOf(LockUnavailable);
    expect(connect).not.toHaveBeenCalled();
  });

  it("stops the task when the caller's signal aborts, and still releases the lock", async () => {
    const conn = fakeLockConnection();
    const controller = new AbortController();
    const run = withNamedLock(async () => conn, "l", { ...opts, signal: controller.signal }, (signal) => {
      const stopped = untilStopped(signal);
      controller.abort(new Error("lease lost"));
      return stopped;
    });
    await expect(run).rejects.toThrow("lease lost");
    expect(statements(conn).at(-1)).toBe("SELECT RELEASE_LOCK(?)");
    expect(conn.end).toHaveBeenCalledTimes(1);
  });

  it("tells a task that outstays its hold to stop", async () => {
    const conn = fakeLockConnection();
    await expect(withNamedLock(async () => conn, "l", { ...opts, holdMs: 10 }, untilStopped)).rejects.toThrow("held lock l for more than 10 ms");
    expect(statements(conn).at(-1)).toBe("SELECT RELEASE_LOCK(?)");
  });

  it("closes a session whose wait failed instead of reusing it", async () => {
    const conn = fakeLockConnection({ getFails: true });
    await expect(withNamedLock(async () => conn, "l", opts, async () => 1)).rejects.toThrow(
      new LockUnavailable("could not ask for lock l: Connection lost: The server closed the connection."),
    );
    expect(conn.destroy).toHaveBeenCalledTimes(1);
    expect(conn.end).not.toHaveBeenCalled();
  });

  it("listens for the session's errors from the start, so a stray one cannot bring the process down", async () => {
    const conn = fakeLockConnection();
    await withNamedLock(async () => conn, "l", opts, async () => {
      expect(conn.listening("error")).toBe(true);
    });
    expect(() => conn.emit("error", new Error("late"))).not.toThrow();
  });

  it("says the database could not be reached when no session could be had", async () => {
    await expect(withNamedLock(async () => Promise.reject(new Error("ECONNREFUSED")), "l", opts, async () => 1)).rejects.toThrow(
      new LockUnavailable("could not reach the database for lock l: ECONNREFUSED"),
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

  it("refuses a scope that could not fit", () => {
    expect(() => lockName("x".repeat(17), "k")).toThrow(/1 to 16 lower-case letters/);
    expect(() => lockName("Engine", "k")).toThrow();
    expect(lockName("a".repeat(16), "k").length).toBeLessThanOrEqual(64);
  });
});
