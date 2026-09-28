/** Whether MySQL chose the statement's transaction as a deadlock's victim (ER_LOCK_DEADLOCK), anywhere in the cause chain. */
export function isDeadlock(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const x = e as { code?: string; errno?: number };
    if (x.code === "ER_LOCK_DEADLOCK" || x.errno === 1213) return true;
  }
  return false;
}

/**
 * Runs a transaction again when MySQL chose it as a deadlock's victim, as
 * MySQL asks: it rolled the transaction back, so running it again is safe.
 * `run` must start a transaction of its own and keep no state across tries.
 */
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
