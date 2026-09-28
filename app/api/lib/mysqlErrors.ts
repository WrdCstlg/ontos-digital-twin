/**
 * What MySQL said went wrong, anywhere in an error's cause chain: mysql2 sets
 * `code` (ER_LOCK_DEADLOCK), `errno` (1213) and `sqlState` (40001) on the
 * errors it raises, and drizzle may wrap one as the cause of its own.
 */
function causes(err: unknown): { code?: string; errno?: number; sqlState?: string }[] {
  const out: { code?: string; errno?: number; sqlState?: string }[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    out.push(e as { code?: string; errno?: number; sqlState?: string });
  }
  return out;
}

/** MySQL chose this transaction as a deadlock's victim and rolled it back. */
export function isDeadlock(err: unknown): boolean {
  return causes(err).some((x) => x.code === "ER_LOCK_DEADLOCK" || x.errno === 1213);
}

/** A row with the same unique key is already there. */
export function isDuplicateKey(err: unknown): boolean {
  return causes(err).some((x) => x.code === "ER_DUP_ENTRY" || x.errno === 1062);
}

/**
 * MySQL refused a statement for its data (SQLSTATE class 22: a value too long
 * or out of range) or for a constraint (class 23). The same data would be
 * refused again, so retrying cannot help.
 */
export function isDataError(err: unknown): boolean {
  return causes(err).some((x) => typeof x.sqlState === "string" && /^2[23]/.test(x.sqlState));
}

/** Runs a transaction again when MySQL chose it as a deadlock's victim, as MySQL asks. */
export async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= attempts || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}
