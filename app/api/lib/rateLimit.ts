import { createHash } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getPool } from "../queries/connection";

/**
 * Sliding-window rate limits, the login lockout among them, kept in MySQL.
 * Each process used to count in its own memory, so a limit of N let N requests
 * through per API replica. Now every replica counts against the same limit.
 *
 * A limiter keeps, per key, the times of the requests it let through within
 * its window, oldest first: an exact sliding log, as before, at most `max`
 * long. The log is one row of rate_limit_windows, under the limiter's bucket
 * and the key's SHA-256, so no email address or token id is stored.
 *
 * Each call is one short transaction at READ COMMITTED, on a connection of
 * its own. A check first takes the row's exclusive lock, in one statement: an
 * upsert whose update changes nothing, which also makes the row if it is
 * missing. Only then does it read the row, prune it and append. Checks of one
 * key therefore take turns across processes. Inserting the row with INSERT
 * IGNORE and then reading it FOR UPDATE would deadlock: the duplicate-key
 * check takes a shared lock on a row that is there, and two checks each
 * holding one wait for each other to upgrade it. The audit chain hit exactly
 * this (services/audit.ts, migration 0008).
 *
 * Times come from the database's clock, as UTC, so neither a replica's clock
 * nor a session's time zone moves a window.
 *
 * A limit that cannot be checked throws RateLimitUnavailable. That covers a
 * database that is unreachable, or slower than LIMIT_TIMEOUT_MS. Every caller
 * answers it with 503. The request was not counted, so refusing it (401, 429)
 * or letting it through would be a verdict the server did not reach.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * A limiter's whole call, including the waits for a connection and for the
 * row's lock, fails after this long.
 */
export const LIMIT_TIMEOUT_MS = 5_000;

/**
 * A row no request has touched for this long holds only expired times, and is
 * deleted. So no window may be longer.
 */
export const IDLE_HOURS = 24;

/** The largest max a limit may have: it keeps a row's log small. */
const MAX_LOG = 1_000;

/**
 * Now, in epoch milliseconds, on the database's clock. UTC_TIMESTAMP is the
 * same in every session, and TIMESTAMPDIFF from the epoch converts nothing,
 * so neither the session's time zone nor a daylight-saving change enters.
 * UNIX_TIMESTAMP(NOW(3)) would read local time back through the zone, which is
 * ambiguous for an hour each autumn.
 */
const DB_NOW_MS = "TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', UTC_TIMESTAMP(6)) DIV 1000";

/** Makes the row if it is missing, and holds its exclusive lock either way. */
const LOCK_ROW =
  "INSERT INTO rate_limit_windows (bucket, subject, hits) VALUES (?, ?, JSON_ARRAY()) ON DUPLICATE KEY UPDATE subject = subject";
const READ_ROW = `SELECT hits, ${DB_NOW_MS} AS now FROM rate_limit_windows WHERE bucket = ? AND subject = ? FOR UPDATE`;
const WRITE_ROW = "UPDATE rate_limit_windows SET hits = ? WHERE bucket = ? AND subject = ?";
const DELETE_ROW = "DELETE FROM rate_limit_windows WHERE bucket = ? AND subject = ?";

/**
 * One check of a key's log at `now`. The log holds the times, in epoch ms, of
 * the requests let through, oldest first. It returns the log to keep, and the
 * verdict. Times that have left the window drop out. If the window has room,
 * the request is let through and its time kept. Otherwise it is refused, and
 * `resetMs` says when the oldest time leaves the window.
 */
export function slideWindow(
  hits: readonly number[],
  now: number,
  { windowMs, max }: RateLimitOptions,
): { hits: number[]; status: RateLimitStatus } {
  const current = hits.filter((t) => t > now - windowMs);
  if (current.length >= max) {
    // A log longer than max (kept under a larger limit) keeps its newest times.
    const kept = current.slice(Math.max(0, current.length - max));
    const resetMs = kept.length ? Math.max(0, kept[0] + windowMs - now) : windowMs;
    return { hits: kept, status: { allowed: false, remaining: 0, resetMs } };
  }
  // Sorted, so the log stays in order even if the database's clock stepped back.
  const next = [...current, now].sort((a, b) => a - b);
  return { hits: next, status: { allowed: true, remaining: max - next.length, resetMs: windowMs } };
}

/** A key's log without its newest time, and without the times that have left the window. */
export function dropNewest(hits: readonly number[], now: number, windowMs: number): number[] {
  return hits.filter((t) => t > now - windowMs).slice(0, -1);
}

/**
 * The subject a key is kept under: its SHA-256, so the key itself (an email
 * address, a token id) is never stored.
 */
export function limitSubject(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * A limit that could not be checked: its database unreachable, or too slow to
 * answer. The request was not counted.
 */
export class RateLimitUnavailable extends Error {
  constructor(bucket: string, cause: unknown) {
    super(`the ${bucket} rate limit could not be checked: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "RateLimitUnavailable";
  }
}

/**
 * A stored log as the limiter reads it: numbers only, oldest first. Anything
 * else in the column reads as an empty log, which the next write replaces.
 */
function readLog(value: unknown): number[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is number => typeof t === "number" && Number.isFinite(t)).sort((a, b) => a - b);
}

function readNow(value: unknown): number {
  const now = Number(value);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error(`the database's clock read ${String(value)}`);
  return now;
}

const sameLog = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((t, i) => t === b[i]);

type Statement = (sql: string, values?: unknown[]) => Promise<unknown>;

function timedOut(waitingFor: string): Error {
  return Object.assign(new Error(`timed out waiting for ${waitingFor} (${LIMIT_TIMEOUT_MS} ms)`), { code: "ETIMEDOUT" });
}

/** A connection from the pool before `deadline`. One that comes later goes straight back. */
function acquire(pool: Pool, deadline: number): Promise<PoolConnection> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(timedOut("a database connection"));
    }, Math.max(0, deadline - Date.now()));
    pool.getConnection().then(
      (conn) => {
        clearTimeout(timer);
        if (settled) {
          conn.release();
          return;
        }
        settled = true;
        resolve(conn);
      },
      (err: unknown) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(err);
      },
    );
  });
}

/**
 * Runs `work` on a connection of its own, each statement bounded by
 * `deadline`. The connection goes back to the pool only when `work` succeeds.
 * After a failure its state is unknown: a statement may still be running, or a
 * transaction still open. So it is closed instead, and MySQL rolls back
 * whatever it held.
 */
async function withConnection<T>(pool: Pool, deadline: number, work: (run: Statement) => Promise<T>): Promise<T> {
  const conn = await acquire(pool, deadline);
  let succeeded = false;
  try {
    const result = await work(async (sql, values = []) => {
      const timeout = deadline - Date.now();
      if (timeout <= 0) throw timedOut("the database");
      const [rows] = await conn.query<RowDataPacket[] | ResultSetHeader>({ sql, values, timeout });
      return rows;
    });
    succeeded = true;
    return result;
  } finally {
    if (succeeded) conn.release();
    else conn.destroy();
  }
}

/** Runs `work` in one transaction at READ COMMITTED, where locking reads take no gap locks. */
function inTransaction<T>(pool: Pool, deadline: number, work: (run: Statement) => Promise<T>): Promise<T> {
  return withConnection(pool, deadline, async (run) => {
    await run("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await run("START TRANSACTION");
    const result = await work(run);
    await run("COMMIT");
    return result;
  });
}

/**
 * An exact sliding-window limit, kept in MySQL: at most `max` requests per key
 * within any `windowMs`. Limiters with the same bucket share their counts,
 * whichever process holds them.
 */
export class RateLimiter {
  readonly bucket: string;
  readonly options: RateLimitOptions;
  private readonly pool: () => Pool;

  /** `pool` is the app's unless given: a test gives each simulated replica its own. */
  constructor(bucket: string, options: RateLimitOptions, pool: () => Pool = () => getPool()) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(bucket)) {
      throw new Error(`A rate limit's bucket is 1 to 32 lowercase letters, digits, - or _, starting with a letter, not "${bucket}"`);
    }
    const { windowMs, max } = options;
    if (!Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > IDLE_HOURS * 3_600_000) {
      throw new Error(`The ${bucket} limit's window must be from 1 ms to ${IDLE_HOURS} hours: rows idle that long are deleted`);
    }
    if (!Number.isSafeInteger(max) || max < 1 || max > MAX_LOG) {
      throw new Error(`The ${bucket} limit's max must be from 1 to ${MAX_LOG}`);
    }
    this.bucket = bucket;
    this.options = { windowMs, max };
    this.pool = pool;
  }

  /** Counts a request under `key` if its window has room for it, and says whether it did. */
  async check(key: string): Promise<RateLimitStatus> {
    const status = await this.onLog(key, true, (hits, now) => {
      const next = slideWindow(hits, now, this.options);
      return { hits: next.hits, result: next.status };
    });
    // The row was made or locked a statement earlier, in this transaction.
    if (!status) throw new RateLimitUnavailable(this.bucket, new Error("its row was missing after it was locked"));
    return status;
  }

  /**
   * Takes back the newest request counted under `key`. An attempt the server
   * could not decide (its database unreachable, say) is no attempt against the
   * limit, and the person is told to try again. A key with nothing counted is
   * left as it is.
   */
  async release(key: string): Promise<void> {
    await this.onLog(key, false, (hits, now) => ({ hits: dropNewest(hits, now, this.options.windowMs), result: true }));
  }

  /** Forgets every request counted under `key`. */
  async reset(key: string): Promise<void> {
    await this.transaction((run) => run(DELETE_ROW, [this.bucket, limitSubject(key)]));
  }

  /**
   * Runs `step` on the key's log under the row's exclusive lock, with the
   * database's time, and writes back the log it returns if that changed.
   * `create` makes the row first if it is missing; without it, a missing row
   * is left missing and the result is undefined.
   */
  private onLog<T>(
    key: string,
    create: boolean,
    step: (hits: number[], now: number) => { hits: number[]; result: T },
  ): Promise<T | undefined> {
    const subject = limitSubject(key);
    return this.transaction(async (run) => {
      if (create) await run(LOCK_ROW, [this.bucket, subject]);
      const [row] = (await run(READ_ROW, [this.bucket, subject])) as RowDataPacket[];
      if (!row) return undefined;
      const hits = readLog(row.hits);
      const next = step(hits, readNow(row.now));
      if (!sameLog(hits, next.hits)) await run(WRITE_ROW, [JSON.stringify(next.hits), this.bucket, subject]);
      return next.result;
    });
  }

  private async transaction<T>(work: (run: Statement) => Promise<T>): Promise<T> {
    try {
      return await inTransaction(this.pool(), Date.now() + LIMIT_TIMEOUT_MS, work);
    } catch (err) {
      throw new RateLimitUnavailable(this.bucket, err);
    }
  }
}

/**
 * Counts a request in a tRPC procedure. Over the limit it is refused with
 * TOO_MANY_REQUESTS and `refusal`, given the seconds until there is room. A
 * request the limit could not count is answered SERVICE_UNAVAILABLE.
 */
export async function enforceLimit(limiter: RateLimiter, key: string, refusal: (seconds: number) => string): Promise<void> {
  let status: RateLimitStatus;
  try {
    status = await limiter.check(key);
  } catch (err) {
    console.warn(`[limits] ${err instanceof Error ? err.message : String(err)}`);
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "The rate limit could not be checked just now. Try again in a moment.",
      cause: err,
    });
  }
  if (!status.allowed) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: refusal(Math.ceil(status.resetMs / 1000)) });
  }
}

/** Sign-in attempts: 10 per 15 minutes per email address. */
export const authRateLimiter = new RateLimiter("auth", { windowMs: 15 * 60 * 1000, max: 10 });

/** Natural-language queries: 30 per minute per user. */
export const nlqRateLimiter = new RateLimiter("nlq", { windowMs: 60 * 1000, max: 30 });

/** The SPARQL endpoint: 30 queries per minute per user. */
export const sparqlRateLimiter = new RateLimiter("sparql", { windowMs: 60 * 1000, max: 30 });

/** Heavy scans (the insight engine's): 10 runs per minute per user. */
export const scanRateLimiter = new RateLimiter("scan", { windowMs: 60 * 1000, max: 10 });
