/**
 * How the web app treats a session the server could not check. "Not signed
 * in" (401) signs the user out at once. Any other failure to check the session
 * (the server answering 503 because its database is away, or not answering at
 * all) is an outage, not a sign-out: the user stays signed in. The user is
 * signed out only on evidence that the outage has lasted SESSION_GRACE_MS: a
 * check that still fails that long after the first failed one, measured on a
 * monotonic clock so a change to the system clock cannot shorten it. A tab
 * that stops checking therefore never signs anyone out on its own.
 *
 * The outage clock is shared by every caller of useAuth, so the whole app
 * agrees on when the outage began.
 *
 * Invariants (each pinned by a test in sessionGrace.test.ts or
 * __tests__/useAuthOutage.test.tsx):
 *  I1  A 401 from the session check signs the user out at once.
 *  I2  No outage sign-out without a failed check SESSION_GRACE_MS or more,
 *      on the monotonic clock, after the first failed check of the outage.
 *  I3  An outage signs the user out at most once, in any tab.
 *  I4  Once an outage sign-out is pending, no user is shown as signed in
 *      until the server has ended the session or the user signs in again;
 *      the remembered persona is forgotten when it is set, and the cached
 *      check is dropped when it stops being pending.
 *  I5  A server sign-out never overlaps a sign-in (withSessionLock), a
 *      sign-in clears the old session's pending sign-out only once the server
 *      has accepted it, and a re-check prompted by "not signed in" waits for
 *      any sign-in or sign-out in flight.
 * Bounds:
 *  B1  Session checks: one per 15 s while failing (plus two retries in a
 *      visible tab), one per 60 s while healthy, one deadline check per
 *      outage, and at most one re-check per 5 s per tab prompted by other
 *      requests' failures; none for their outages once the clock is running.
 *  B2  Server sign-outs: at most one per 15 s per tab, never overlapping.
 *  B3  Every session call (auth.me, sign-in, sign-out) gives up after
 *      SESSION_CALL_TIMEOUT_MS.
 *  B4  The session lock is held at most SESSION_LOCK_MAX_HOLD_MS.
 * Degradation: the pending flag falls back from localStorage to a cookie to
 * memory; with none, the sign-out lasts until the page is reloaded.
 */

export const SESSION_GRACE_MS = 3 * 60_000;
/** How often to check again while the session cannot be checked. */
export const SESSION_RECHECK_MS = 15_000;
/** How often to check a healthy session, so an outage on a quiet page is noticed. */
export const SESSION_HEALTHY_RECHECK_MS = 60_000;
/** The least time between session checks prompted by other requests' failures. */
export const SESSION_OUTAGE_RECHECK_MS = 5_000;
/** How long a session call (check, sign-in or sign-out) may take before it counts as unanswered. */
export const SESSION_CALL_TIMEOUT_MS = 10_000;
/** The longest the session lock is held, well past one session call's timeout. */
export const SESSION_LOCK_MAX_HOLD_MS = 2 * SESSION_CALL_TIMEOUT_MS + 5_000;

/** A sign-out the server has not confirmed yet (see pendingSignOut). */
export const PENDING_SIGN_OUT_KEY = "ontos:pending-sign-out";
const PENDING_COOKIE = "ontos_pending_signout";

export type AuthErrorLike = { data?: { code?: string } | null } | null | undefined;

/** The server said there is no session. */
export function isSignedOutError(err: unknown): boolean {
  return (err as AuthErrorLike)?.data?.code === "UNAUTHORIZED";
}

/**
 * The server could not be asked, or said it could not answer: a 503, or no
 * tRPC answer at all (network failure, timeout, a proxy's 502). Any other code
 * is an answer about the request, not an outage.
 */
export function isOutageError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as AuthErrorLike)?.data?.code;
  return code === undefined || code === null || code === "SERVICE_UNAVAILABLE";
}

/** Milliseconds on a clock that only moves forward. */
export function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** The current run of failed checks, on the monotonic clock: when it began and when the latest one failed. */
export type Outage = { since: number; last: number };

export type SessionState =
  /** The last check succeeded, or it failed within the grace period and a user is cached. */
  | { kind: "signed-in"; degraded: boolean }
  /** The server said there is no session, or the outage outlasted the grace period. */
  | { kind: "signed-out"; reason: "no-session" | "outage" }
  /** No answer yet and no user cached: the first check is running, paused or failing within the grace period. */
  | { kind: "checking"; unreachable: boolean };

export function sessionState(input: {
  status: "pending" | "error" | "success";
  hasUser: boolean;
  error: unknown;
  /** The shared clock. */
  outage: Outage | null;
  /** The check is paused (a hidden tab's retry, or offline). */
  paused: boolean;
}): SessionState {
  const { status, hasUser, error, outage, paused } = input;
  if (status === "success") return { kind: "signed-in", degraded: false };
  if (status === "error") {
    if (isSignedOutError(error)) return { kind: "signed-out", reason: "no-session" };
    if (outage && outage.last - outage.since >= SESSION_GRACE_MS) return { kind: "signed-out", reason: "outage" };
    return hasUser ? { kind: "signed-in", degraded: true } : { kind: "checking", unreachable: true };
  }
  return { kind: "checking", unreachable: outage !== null || paused };
}

/** The shared outage clock. Each settled check is observed: a failure extends the run, anything else ends it. */
export function createOutageClock() {
  let current: Outage | null = null;
  const listeners = new Set<() => void>();
  const set = (v: Outage | null) => {
    current = v;
    for (const l of listeners) l();
  };
  return {
    get: (): Outage | null => current,
    observe(result: { ok: true } | { ok: false; error: unknown }, at = monotonicNow()) {
      // Success, or "not signed in", is an answer: the outage, if any, is over.
      if (result.ok || isSignedOutError(result.error)) {
        if (current !== null) set(null);
      } else if (current === null) set({ since: at, last: at });
      else if (at > current.last) set({ since: current.since, last: at });
    },
    reset() {
      if (current !== null) set(null);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const outageClock = createOutageClock();

/** Each outage signs the user out once: a tab never re-signs-out for an outage it already acted on. */
let expiredOutage: number | null = null;
export function claimOutageExpiry(since: number): boolean {
  if (expiredOutage === since) return false;
  expiredOutage = since;
  return true;
}
/** For tests: forget which outage last signed the user out. */
export function resetOutageExpiry(): void {
  expiredOutage = null;
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    // Some browsers expose storage that throws on use, or none at all.
    if (!s) return null;
    s.getItem(PENDING_SIGN_OUT_KEY);
    return s;
  } catch {
    return null;
  }
}

function cookieFlag(): boolean {
  try {
    return document.cookie.split(";").some((c) => c.trim() === `${PENDING_COOKIE}=1`);
  } catch {
    return false;
  }
}

function setCookieFlag(on: boolean): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = on
      ? `${PENDING_COOKIE}=1; Path=/; SameSite=Strict; Max-Age=604800${secure}`
      : `${PENDING_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0${secure}`;
  } catch {
    // cookies refused: localStorage or memory still carry it
  }
}

/**
 * A sign-out the server has not confirmed yet. Set when an outage outlasts the
 * grace period: only the server can clear the session cookie, so until it has,
 * or until the user signs in again, the app treats the session as ended even
 * if the server starts answering again. It is kept in localStorage (whose
 * change events tell other tabs at once) and in a flag cookie, which survives
 * a reload when storage is unavailable; in memory only if both are refused.
 */
let pendingInMemory = false;
export const pendingSignOut = {
  get(): boolean {
    const s = storage();
    return (s ? s.getItem(PENDING_SIGN_OUT_KEY) !== null : false) || cookieFlag() || pendingInMemory;
  },
  set(): void {
    let kept = false;
    const s = storage();
    if (s) {
      try {
        s.setItem(PENDING_SIGN_OUT_KEY, "1");
        kept = true;
      } catch {
        // full or refused
      }
    }
    setCookieFlag(true);
    kept = kept || cookieFlag();
    if (!kept) pendingInMemory = true;
  },
  clear(): void {
    pendingInMemory = false;
    setCookieFlag(false);
    storage()?.removeItem(PENDING_SIGN_OUT_KEY);
  },
};

/** Tell this tab's subscribers the flag changed; the storage event reaches only other tabs. */
export function announcePendingChange(): void {
  window.dispatchEvent(new StorageEvent("storage", { key: PENDING_SIGN_OUT_KEY }));
}

/** Subscribe to the flag: storage events from other tabs, and a re-read on focus for the cookie fallback. */
export function subscribePending(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PENDING_SIGN_OUT_KEY) listener();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

let localChain: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` with the session to itself: no other sign-in or server sign-out
 * runs at the same time, in this tab or any other. Where the browser has Web
 * Locks the lock spans tabs; otherwise it serialises within the tab.
 *
 * Every holder makes one session call, which gives up after
 * SESSION_CALL_TIMEOUT_MS, so the lock is always released. Should a holder
 * hang regardless, the lock is let go after `maxHoldMs` (B4) and its promise
 * rejects: a stuck holder must not stop every later sign-in and sign-out.
 */
export function withSessionLock<T>(fn: () => Promise<T>, maxHoldMs = SESSION_LOCK_MAX_HOLD_MS): Promise<T> {
  const bounded = () =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The session lock was held too long")), maxHoldMs);
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks?.request) return locks.request("ontos-session", bounded) as Promise<T>;
  const run = localChain.then(bounded, bounded);
  localChain = run.catch(() => undefined);
  return run;
}
