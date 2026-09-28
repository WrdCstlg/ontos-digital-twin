import { createHash } from "node:crypto";

/** The part of a pooled mysql2 connection a named lock needs. */
export type LockConnection = {
  query(sql: string, values: unknown[]): Promise<unknown>;
  release(): void;
  destroy(): void;
};

/** The lock was not granted in time, or the database could not be asked for it. A later try may get it. */
export class LockUnavailable extends Error {}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A MySQL lock name for `key`: MySQL allows 64 characters, so a key of any
 * length is hashed.
 */
export function lockName(scope: string, key: string): string {
  return `ontos:${scope}:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

/**
 * Runs `task` holding MySQL's named lock `name` (GET_LOCK), which every
 * process on the same database shares. The lock belongs to one connection,
 * taken from the pool for the task alone. If that connection dies, MySQL
 * frees the lock, so a holder that crashed cannot block the others; a
 * connection whose lock could not be released cleanly is closed rather than
 * returned to the pool.
 */
export async function withNamedLock<T>(
  connect: () => Promise<LockConnection>,
  name: string,
  waitSeconds: number,
  task: () => Promise<T>,
): Promise<T> {
  let conn: LockConnection;
  try {
    conn = await connect();
  } catch (err) {
    throw new LockUnavailable(`could not reach the database for lock ${name}: ${message(err)}`);
  }
  let reusable = true;
  try {
    let granted: unknown;
    try {
      const [rows] = (await conn.query("SELECT GET_LOCK(?, ?) AS granted", [name, waitSeconds])) as [{ granted?: unknown }[]];
      granted = rows?.[0]?.granted;
    } catch (err) {
      reusable = false;
      throw new LockUnavailable(`could not ask for lock ${name}: ${message(err)}`);
    }
    if (Number(granted) !== 1) throw new LockUnavailable(`lock ${name} stayed held elsewhere for ${waitSeconds} s`);
    try {
      return await task();
    } finally {
      try {
        await conn.query("SELECT RELEASE_LOCK(?)", [name]);
      } catch {
        reusable = false;
      }
    }
  } finally {
    if (reusable) conn.release();
    else conn.destroy();
  }
}
