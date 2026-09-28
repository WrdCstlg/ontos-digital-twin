/**
 * An in-memory stand-in for the rate_limit_windows table, behind a pool shaped
 * like mysql2's, so that lib/rateLimit.ts runs its own transactions against
 * it. It is for tests that check how a caller uses a limit rather than how the
 * limit is kept. It answers the statements the limiter issues, with the app's
 * clock (or a test's) standing in for the database's. Writes in a transaction
 * take effect at COMMIT, and a connection given back with a transaction open
 * is an error. Any other statement throws, so a test never passes on SQL it
 * ignored. It has no locks and no time zones: mysql/rateLimits.mysql.test.ts
 * checks those on a real MySQL.
 *
 * Use it from vi.mock:
 *   const limits = vi.hoisted(() => ({ rows: new Map() }));
 *   vi.mock("../queries/connection", async () => ({
 *     getPool: (await import("./memoryRateLimits")).memoryPoolFor(limits),
 *   }));
 */
import type { Pool } from "mysql2/promise";

export type LimitRow = { hits: number[]; updatedAt: number };

export type LimitTable = {
  /** Each row, by `${bucket}/${subject}`. */
  rows: Map<string, LimitRow>;
  /** The database's clock, in epoch ms: the app's when unset. */
  now?: () => number;
  /** Set, no connection can be had, as with the database unreachable. */
  down?: Error;
  /** Set, the first statement matching `match` fails with `error`. */
  failing?: { match: RegExp; error: Error };
  /** Every statement run, in order. */
  log?: { sql: string; values: unknown[]; timeout?: number }[];
  /** Every connection handed out, and how it ended. */
  connections?: { released: boolean; destroyed: boolean }[];
};

const STATEMENTS = {
  lock: /^INSERT INTO rate_limit_windows \(bucket, subject, hits\) VALUES \(\?, \?, JSON_ARRAY\(\)\) ON DUPLICATE KEY UPDATE subject = subject$/,
  read: /^SELECT hits, TIMESTAMPDIFF\(MICROSECOND, '1970-01-01 00:00:00', UTC_TIMESTAMP\(6\)\) DIV 1000 AS now FROM rate_limit_windows WHERE bucket = \? AND subject = \? FOR UPDATE$/,
  write: /^UPDATE rate_limit_windows SET hits = \? WHERE bucket = \? AND subject = \?$/,
  delete: /^DELETE FROM rate_limit_windows WHERE bucket = \? AND subject = \?$/,
};

function connection(table: LimitTable) {
  const state = { released: false, destroyed: false };
  (table.connections ??= []).push(state);
  const now = () => (table.now ?? Date.now)();
  // Writes of the open transaction, by key: a row, or null for one deleted.
  let pending: Map<string, LimitRow | null> | null = null;
  const read = (key: string) => (pending?.has(key) ? (pending.get(key) ?? undefined) : table.rows.get(key));
  const write = (key: string, row: LimitRow | null) => {
    if (pending) pending.set(key, row);
    else if (row) table.rows.set(key, row);
    else table.rows.delete(key);
  };
  const ok = (affectedRows: number) => [{ affectedRows }];

  async function query(opts: { sql: string; values?: unknown[]; timeout?: number }): Promise<unknown[]> {
    if (state.released || state.destroyed) throw new Error("memoryRateLimits: a statement on a connection already given back");
    const sql = opts.sql.replace(/\s+/g, " ").trim();
    const v = opts.values ?? [];
    (table.log ??= []).push({ sql, values: v, timeout: opts.timeout });
    if (table.failing?.match.test(sql)) {
      const { error } = table.failing;
      table.failing = undefined;
      throw error;
    }
    if (sql === "SET TRANSACTION ISOLATION LEVEL READ COMMITTED") return ok(0);
    if (sql === "START TRANSACTION") {
      pending = new Map();
      return ok(0);
    }
    if (sql === "COMMIT") {
      const writes = pending ?? new Map<string, LimitRow | null>();
      pending = null;
      for (const [key, row] of writes) write(key, row);
      return ok(0);
    }
    if (STATEMENTS.lock.test(sql)) {
      const key = `${v[0]}/${v[1]}`;
      if (read(key)) return ok(0);
      write(key, { hits: [], updatedAt: now() });
      return ok(1);
    }
    if (STATEMENTS.read.test(sql)) {
      const row = read(`${v[0]}/${v[1]}`);
      return [row ? [{ hits: [...row.hits], now: now() }] : []];
    }
    if (STATEMENTS.write.test(sql)) {
      const key = `${v[1]}/${v[2]}`;
      if (!read(key)) return ok(0);
      write(key, { hits: JSON.parse(String(v[0])) as number[], updatedAt: now() });
      return ok(1);
    }
    if (STATEMENTS.delete.test(sql)) {
      const key = `${v[0]}/${v[1]}`;
      const had = read(key) ? 1 : 0;
      write(key, null);
      return ok(had);
    }
    throw new Error(`memoryRateLimits: unsupported statement: ${sql}`);
  }

  return {
    query,
    release() {
      if (pending) throw new Error("memoryRateLimits: a connection given back with its transaction open");
      state.released = true;
    },
    destroy() {
      pending = null;
      state.destroyed = true;
    },
  };
}

/** A pool over `table`, as the limiter uses one. */
export function memoryPool(table: LimitTable): Pool {
  return {
    async getConnection() {
      if (table.down) throw table.down;
      return connection(table);
    },
  } as unknown as Pool;
}

/** For vi.mock: a getPool that serves `table`. */
export const memoryPoolFor = (table: LimitTable) => () => memoryPool(table);
