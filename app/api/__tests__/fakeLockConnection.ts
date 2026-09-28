import { vi } from "vitest";
import type { LockConnection } from "../lib/namedLock";

/**
 * A MySQL session for a named lock that answers from a script and records
 * each statement with its values. MySQL answers GET_LOCK with 1 (granted),
 * 0 (the wait ran out) or NULL (an error), and RELEASE_LOCK with 1 (released),
 * 0 (another session's) or NULL (no such lock).
 */
export type LockScript = {
  get?: unknown;
  getFails?: boolean;
  /** GET_LOCK never answers, as a wait still running. */
  getHangs?: boolean;
  /** The session ends as the lock is granted. */
  endOnGrant?: boolean;
  /** The heartbeat's answer: 1 while the session holds the lock. */
  mine?: unknown;
  heartbeatFails?: boolean;
  /** The heartbeat's check never answers. */
  heartbeatHangs?: boolean;
  release?: unknown;
  releaseFails?: boolean;
  /** RELEASE_LOCK never answers. */
  releaseHangs?: boolean;
  /** Closing the session never finishes. */
  endHangs?: boolean;
  /** The server has no max_execution_time, as MariaDB has none. */
  noMaxExecutionTime?: boolean;
};

export function fakeLockConnection(script: LockScript = {}) {
  const calls: string[] = [];
  const listeners: Record<string, ((err?: unknown) => void)[]> = {};
  const emit = (event: "error" | "end", err?: unknown) => {
    for (const l of listeners[event] ?? []) l(err);
  };
  const answer = (column: string, value: unknown) => [[{ [column]: value }], []];
  const conn = {
    calls,
    emit,
    listening: (event: "error" | "end") => (listeners[event] ?? []).length > 0,
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push(`${sql} ${JSON.stringify(values)}`);
      if (sql.startsWith("SET SESSION max_execution_time") && script.noMaxExecutionTime) {
        throw Object.assign(new Error("Unknown system variable 'max_execution_time'"), { errno: 1193 });
      }
      if (sql.startsWith("SET SESSION")) return [{}, []];
      if (sql.startsWith("SELECT GET_LOCK")) {
        if (script.getFails) throw new Error("Connection lost: The server closed the connection.");
        if (script.getHangs) return new Promise(() => undefined);
        if (script.endOnGrant) emit("end");
        return answer("granted", "get" in script ? script.get : 1);
      }
      if (sql.startsWith("SELECT IS_USED_LOCK")) {
        if (script.heartbeatFails) throw new Error("read ECONNRESET");
        if (script.heartbeatHangs) return new Promise(() => undefined);
        return answer("mine", "mine" in script ? script.mine : 1);
      }
      if (sql.startsWith("SELECT RELEASE_LOCK")) {
        if (script.releaseFails) throw new Error("Connection lost: The server closed the connection.");
        if (script.releaseHangs) return new Promise(() => undefined);
        return answer("released", "release" in script ? script.release : 1);
      }
      throw new Error(`unexpected statement: ${sql}`);
    }),
    end: vi.fn(async () => (script.endHangs ? new Promise<void>(() => undefined) : emit("end"))),
    destroy: vi.fn(),
    on: vi.fn((event: "error" | "end", listener: (err?: unknown) => void) => {
      (listeners[event] ??= []).push(listener);
    }),
  } satisfies LockConnection & Record<string, unknown>;
  return conn;
}

/** A task that runs until its signal aborts, then fails with the reason. */
export const untilStopped = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
