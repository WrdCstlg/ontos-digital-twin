import { createHash } from "node:crypto";

/**
 * The session a named lock lives on: a MySQL connection of its own, opened for
 * the lock and closed after it. A pooled connection would take the session
 * setting the lock needs (below) back into the pool.
 */
export type LockConnection = {
  query(sql: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
  destroy(): void;
  /** mysql2 emits `error` when the connection fails and `end` when it closes. */
  on(event: "error" | "end", listener: (err?: unknown) => void): unknown;
};

/** The lock was not had: not granted in time, the wait called off, or the database not reached. A later try may get it. */
export class LockUnavailable extends Error {}

/**
 * The lock was lost while its task ran. Its session ended (the database
 * restarted, the connection failed or was killed), MySQL freed the lock with
 * it, and another process may have taken it since: what the task did or saw
 * after that is not known to have been exclusive.
 */
export class LockLost extends Error {}

export type NamedLockOptions = {
  /** How long to wait for the lock, in whole seconds (MySQL's unit). */
  waitSeconds: number;
  /** How long the task may hold it. Past this the task's signal is aborted. */
  holdMs: number;
  /** Calls off the wait, or stops the task: its job aborted, its process stopping. */
  signal?: AbortSignal;
  /** How often the session is checked while the task holds the lock. */
  heartbeatMs?: number;
};

/**
 * The lock session's idle limit. MySQL ends a session idle this long, and the
 * lock with it: a holder cut off without its socket closing (a frozen process,
 * a host gone, a network partition) keeps the others out for this long, not
 * for the server's default eight hours. The heartbeat keeps a live holder's
 * session busy.
 */
export const LOCK_SESSION_IDLE_SECONDS = 30;
const DEFAULT_HEARTBEAT_MS = 5_000;
/** How long a statement other than the wait may take before the session is given up. */
const STATEMENT_MS = 10_000;
/**
 * How long the heartbeat's check may go unanswered before the task is told to
 * stop. Kept short: until the task is stopped it may still send the engine
 * requests, and a session lost without a sound (the database gone and back,
 * its connection not yet noticed) may already have freed the lock.
 */
const HEARTBEAT_ANSWER_MS = 5_000;
/** How long opening the lock's session may take. */
const CONNECT_MS = 10_000;
/** MySQL's longest lock name. A longer one is an error GET_LOCK answers every time. */
const MAX_LOCK_NAME = 64;
/** MySQL's answer to a SET of a variable the server does not have. */
const ER_UNKNOWN_SYSTEM_VARIABLE = 1193;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const reasonOf = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
const firstValue = (result: unknown, column: string) => (result as [Record<string, unknown>[]] | undefined)?.[0]?.[0]?.[column];

/**
 * A MySQL lock name for `key`. MySQL allows 64 characters, so the key is
 * hashed; the scope stays readable and is kept short.
 */
export function lockName(scope: string, key: string): string {
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(scope)) throw new Error(`lock scope '${scope}' must be 1 to 16 lower-case letters, digits or hyphens`);
  return `ontos:${scope}:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

/**
 * Settles as `p` does, or rejects when `ms` pass or `signal` aborts (at once,
 * if it already has). A peer that has gone quiet never answers, and a
 * statement on a connection closed from this side settles only when the
 * server notices, so no wait is left to the statement alone.
 */
function bounded<T>(p: Promise<T>, ms: number, timedOut: () => Error, signal?: AbortSignal): Promise<T> {
  p.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timedOut()), ms);
    const onAbort = () => reject(reasonOf(signal!));
    // A listener added to a signal that has already aborted never fires.
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * Runs `task` holding MySQL's named lock `name` (GET_LOCK), which every
 * process on the same MySQL server shares: lock names are the server's, not
 * a database's, so `name` must say which database it is for.
 *
 * The lock belongs to a session opened for it. When that session ends, MySQL
 * frees the lock, so a holder that crashed cannot keep the others out, and a
 * holder cut off without its socket closing keeps them out for at most
 * LOCK_SESSION_IDLE_SECONDS. The task is handed a signal that aborts the
 * moment the session ends (or the caller's signal aborts, or the task outstays
 * `holdMs`), and must pass it to whatever it does under the lock. Only a
 * release MySQL confirms shows the lock was held throughout: otherwise the
 * task's result, whatever it is, is refused with LockLost.
 */
export async function withNamedLock<T>(
  connect: () => Promise<LockConnection>,
  name: string,
  opts: NamedLockOptions,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const { signal } = opts;
  // Mistakes in the call, not a lock to wait for: never worth a retry.
  if (name.length === 0 || name.length > MAX_LOCK_NAME) throw new Error(`a lock name has 1 to ${MAX_LOCK_NAME} characters (lockName makes one): '${name}'`);
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  if (!(heartbeatMs > 0 && heartbeatMs + HEARTBEAT_ANSWER_MS < (LOCK_SESSION_IDLE_SECONDS * 1000) / 2)) {
    throw new Error(`a heartbeat every ${heartbeatMs} ms would let the session idle out (${LOCK_SESSION_IDLE_SECONDS} s)`);
  }
  const calledOff = () => new LockUnavailable(`the wait for lock ${name} was called off: ${message(signal?.reason)}`);
  if (signal?.aborted) throw calledOff();

  let conn: LockConnection;
  let connecting: Promise<LockConnection> | undefined;
  try {
    connecting = connect();
    conn = await bounded(connecting, CONNECT_MS, () => new Error(`no connection in ${CONNECT_MS} ms`), signal);
  } catch (err) {
    // A connection that opens after all is closed at once: its session would hold nothing.
    connecting?.then((late) => late.destroy(), () => undefined);
    if (signal?.aborted) throw calledOff();
    throw new LockUnavailable(`could not reach the database for lock ${name}: ${message(err)}`);
  }

  let phase: "waiting" | "holding" | "done" = "waiting";
  let ended: string | null = null; // why the session ended, once it has
  let sound = true; // the session is in a known state, so it may be closed cleanly
  const stop = new AbortController(); // the task's signal
  const stopTask = (reason: Error) => {
    if (!stop.signal.aborted) stop.abort(reason);
  };
  const sessionEnded = (why: string) => {
    ended ??= why;
    if (phase === "holding") stopTask(new LockLost(`lost lock ${name}: ${why}`));
  };
  // Always listened for: an `error` mysql2 cannot hand to a statement is
  // emitted, and unheard it would bring the process down.
  conn.on("error", (err) => sessionEnded(`its connection failed: ${message(err)}`));
  conn.on("end", () => sessionEnded("its connection closed"));
  const onAbort = () => {
    if (phase === "holding") stopTask(reasonOf(signal!));
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let granted: unknown;
    try {
      await bounded(
        conn.query("SET SESSION wait_timeout = ?", [LOCK_SESSION_IDLE_SECONDS]),
        STATEMENT_MS,
        () => new Error(`no answer in ${STATEMENT_MS} ms`),
        signal,
      );
      // A server-wide max_execution_time would cut the wait short: it applies
      // to SELECT, and GET_LOCK is asked for in one. A server without it
      // (MariaDB) has nothing to cut the wait short with.
      await bounded(
        conn.query("SET SESSION max_execution_time = 0").catch((err: unknown) => {
          if ((err as { errno?: number }).errno !== ER_UNKNOWN_SYSTEM_VARIABLE) throw err;
        }),
        STATEMENT_MS,
        () => new Error(`no answer in ${STATEMENT_MS} ms`),
        signal,
      );
      granted = firstValue(
        await bounded(
          conn.query("SELECT GET_LOCK(?, ?) AS granted", [name, opts.waitSeconds]),
          opts.waitSeconds * 1000 + STATEMENT_MS,
          () => new Error(`no answer in ${opts.waitSeconds} s and ${STATEMENT_MS} ms`),
          signal,
        ),
        "granted",
      );
    } catch (err) {
      // A wait called off, cut short or failed leaves a statement running on
      // the session, or a session already gone: it is closed, not reused.
      sound = false;
      if (signal?.aborted) throw calledOff();
      throw new LockUnavailable(`could not ask for lock ${name}: ${message(err)}`);
    }
    // 1 granted; 0 the wait ran out; NULL an error.
    if (granted === null || granted === undefined) throw new LockUnavailable(`MySQL could not take lock ${name}: GET_LOCK answered NULL, an error`);
    if (Number(granted) !== 1) throw new LockUnavailable(`lock ${name} stayed held elsewhere for ${opts.waitSeconds} s`);
    // The session can end between the grant and here, taking the lock with it.
    if (ended !== null) throw new LockLost(`lost lock ${name} as it was granted: ${ended}`);

    phase = "holding";
    if (signal?.aborted) stopTask(reasonOf(signal));
    const holdTimer = setTimeout(() => stopTask(new Error(`held lock ${name} for more than ${opts.holdMs} ms`)), opts.holdMs);
    let beating = false;
    const heartbeat = setInterval(() => {
      if (beating || ended !== null) return;
      beating = true;
      bounded(conn.query("SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS mine", [name]), HEARTBEAT_ANSWER_MS, () => new Error(`no answer in ${HEARTBEAT_ANSWER_MS} ms`))
        .then((r) => {
          if (Number(firstValue(r, "mine")) !== 1) sessionEnded("MySQL no longer counts it as this session's");
        })
        // Unanswered is not proof the lock is gone (a slow network, a busy
        // server): the task is stopped to be safe, and the release decides.
        // A session that did end says so by its `end` or `error`.
        .catch((err) => stopTask(new Error(`could not confirm lock ${name} is still held: checking its session failed: ${message(err)}`)))
        .finally(() => (beating = false));
    }, heartbeatMs);

    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await task(stop.signal) };
    } catch (error) {
      outcome = { ok: false, error };
    } finally {
      clearTimeout(holdTimer);
      clearInterval(heartbeat);
    }

    // Only a release MySQL confirms shows the lock was held throughout: then
    // the task's outcome stands, whatever a heartbeat left unanswered.
    phase = "done";
    let released: unknown = null;
    if (ended === null) {
      try {
        released = firstValue(
          await bounded(conn.query("SELECT RELEASE_LOCK(?) AS released", [name]), STATEMENT_MS, () => new Error(`no answer in ${STATEMENT_MS} ms`)),
          "released",
        );
      } catch (err) {
        ended = `releasing it failed: ${message(err)}`;
      }
    }
    if (ended !== null || Number(released) !== 1) {
      throw new LockLost(`lost lock ${name} while its task ran: ${ended ?? "MySQL no longer counted it as this session's"}`, {
        cause: outcome.ok ? undefined : outcome.error,
      });
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } finally {
    phase = "done";
    signal?.removeEventListener("abort", onAbort);
    if (sound && ended === null) {
      await bounded(conn.end(), STATEMENT_MS, () => new Error("no answer")).catch(() => conn.destroy());
    } else {
      conn.destroy();
    }
  }
}
