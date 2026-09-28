/** What `within` rejects with when the wait runs out. */
export class TimedOut extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not finish within ${ms} ms`);
    this.name = "TimedOut";
  }
}

/**
 * `work`, or a TimedOut rejection once `ms` have passed, whichever comes
 * first. The work itself goes on (nothing here can cancel it), so a caller
 * that gives up on it must be safe if it later succeeds; its late failure is
 * swallowed rather than left unhandled.
 */
export function within<T>(work: PromiseLike<T>, ms: number, what: string): Promise<T> {
  // Adopted once: a drizzle query runs again each time its then() is called.
  const promise = Promise.resolve(work);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut(what, ms)), ms);
  });
  promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
