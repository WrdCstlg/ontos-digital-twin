/**
 * How the web app treats a session the server could not check. "Not signed
 * in" (401) signs the user out at once. Any other failure to check the session
 * (the server answering 503 because its database is away, or not answering at
 * all) is an outage, not a sign-out: the user stays signed in. The user is
 * signed out only on evidence that the outage has lasted SESSION_GRACE_MS: a
 * check that still fails that long after the first failed one, measured on a
 * monotonic clock so a change to the system clock cannot shorten it (across a
 * reload, by at most one checking interval). A tab that stops checking
 * therefore never signs anyone out on its own.
 *
 * The outage clock is shared by every caller of useAuth, so the whole app
 * agrees on when the outage began.
 *
 * Invariants (each pinned by a test in sessionGrace.test.ts or
 * __tests__/useAuthOutage.test.tsx):
 *  I1  A 401 from the session check signs the user out at once.
 *  I2  No outage sign-out without a failed check SESSION_GRACE_MS or more,
 *      on the monotonic clock, after the first failed check of the outage.
 *      An outage is a run of failed checks, each counted once, when it
 *      settles, whether or not the page is showing the session; no two more
 *      than SESSION_MAX_CHECK_GAP_MS apart by either the monotonic or the
 *      wall clock; within one session epoch. A reload resumes the run the tab
 *      was in, crediting the span it recorded and the reload's own gap up to
 *      one checking interval. The remembered persona that opens a page is a
 *      guess, not an answer: it ends no run.
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
 *  B1  Session checks, no retries: one per 15 s while failing (5 s while no
 *      user is known yet), one per 60 s while healthy, one deadline check
 *      per outage, one when a part of the page that shows the session
 *      mounts on a stale check, and at most one re-check per 5 s per tab
 *      prompted by other requests' failures (none for their outages once
 *      the clock is running), and one when a sign-in in another tab has
 *      changed the session. Focus and reconnect add none of their own.
 *  B2  Server sign-outs: at most one per 15 s per tab, never overlapping.
 *  B3  Every session call (auth.me, sign-in, sign-out) gives up after
 *      SESSION_CALL_TIMEOUT_MS, body included.
 *  B4  The session lock is held at most SESSION_LOCK_MAX_HOLD_MS, and a
 *      sign-in or sign-out holds it only for its request.
 *  B5  No session call waits for the browser to come online: made offline,
 *      it fails at once, so none can run later outside the lock.
 * Degradation: the pending flag falls back from localStorage to a cookie to
 * memory; with none, the sign-out lasts until the page is reloaded. Without
 * sessionStorage a reload restarts the outage; without localStorage tabs
 * cannot tell sessions apart, and the other rules still hold. A hidden tab
 * whose checks hang may have its timeouts throttled past the gap: it then
 * starts a new outage at each failure, and signs no one out while hidden,
 * which errs the safe way; a visible tab, or this one once shown, does.
 */

export const SESSION_GRACE_MS = 3 * 60_000;
/** How often to check again while the session cannot be checked. */
export const SESSION_RECHECK_MS = 15_000;
/** How often to check a healthy session, so an outage on a quiet page is noticed. */
export const SESSION_HEALTHY_RECHECK_MS = 60_000;
/** The least time between session checks prompted by other requests' failures. */
export const SESSION_OUTAGE_RECHECK_MS = 5_000;
/** How often to check again when no user is known yet (a page loaded during an outage). */
export const SESSION_FIRST_RECHECK_MS = 5_000;
/**
 * The longest gap between two failed checks of one outage: past it, nothing
 * was checked in between (a laptop asleep, a tab frozen), so a new outage
 * begins. Above a background tab's throttled pace of one timer a minute.
 */
export const SESSION_MAX_CHECK_GAP_MS = 90_000;
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

/**
 * Which session the tabs are in: changed by every sign-in, in any tab. An
 * outage one session saw is no evidence against the next one.
 */
export const SESSION_EPOCH_KEY = "ontos:session-epoch";
/** The epoch this tab last acted on: its own sign-ins, and changes it has followed. */
let seenEpoch: string | null = null;
export const sessionEpoch = {
  get(): string {
    try {
      return window.localStorage.getItem(SESSION_EPOCH_KEY) ?? "";
    } catch {
      return "";
    }
  },
  bump(): void {
    try {
      const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(SESSION_EPOCH_KEY, next);
      // This tab's own sign-in: nothing for it to follow (no storage event
      // reaches the tab that wrote the value, so it must say so itself).
      seenEpoch = next;
    } catch {
      // storage refused: tabs cannot tell sessions apart, and the other rules still hold
    }
  },
  /**
   * Whether a sign-in in another tab has changed the session since this tab
   * last looked; the change is then counted as seen. The first call only
   * records where the tab starts.
   */
  takeChange(): boolean {
    const now = sessionEpoch.get();
    const changed = seenEpoch !== null && now !== seenEpoch;
    seenEpoch = now;
    return changed;
  },
};

/** Where a tab remembers its outage across a reload (sessionStorage: this tab only). */
export const SESSION_OUTAGE_KEY = "ontos:outage";
/**
 * `span`: how long the run had lasted at its latest failure, on the monotonic
 * clock. `wallLast`: when that failure was seen, on the wall clock, used only
 * to tell how long ago it was.
 */
type Remembered = { epoch: string; span: number; wallLast: number };

function remember(v: Remembered | null): void {
  try {
    if (v) window.sessionStorage.setItem(SESSION_OUTAGE_KEY, JSON.stringify(v));
    else window.sessionStorage.removeItem(SESSION_OUTAGE_KEY);
  } catch {
    // storage refused: a reload restarts the outage, the documented degradation
  }
}

/**
 * How long the run this tab remembers had lasted, if it may be resumed: one
 * checked recently, by a wall clock that has not gone backwards, and no longer
 * than the grace period and a gap. Credited: the span it recorded, and the
 * reload's own gap, which only the wall clock measures, up to one checking
 * interval. So reloading faster than the checks still gathers evidence, and a
 * clock stepped forward across a reload shortens the grace period by at most
 * that one interval.
 */
function resumable(epoch: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_OUTAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Remembered>;
    if (v.epoch !== epoch || typeof v.span !== "number" || typeof v.wallLast !== "number") return null;
    const sinceLast = Date.now() - v.wallLast;
    if (sinceLast < 0 || sinceLast > SESSION_MAX_CHECK_GAP_MS) return null;
    if (v.span < 0 || v.span > SESSION_GRACE_MS + SESSION_MAX_CHECK_GAP_MS) return null;
    return v.span + Math.min(sinceLast, SESSION_RECHECK_MS);
  } catch {
    return null;
  }
}

/**
 * The shared outage clock. Each settled session check is observed once, when
 * it settles (the query cache reports it: providers/trpc.tsx), whether or not
 * any part of the page is showing the session: a failure extends the run,
 * anything else ends it. Evidence counts only as the checks made it:
 * - a gap longer than SESSION_MAX_CHECK_GAP_MS since the last failure starts a
 *   new outage, since nothing was checked in between. The gap is the larger of
 *   the monotonic and wall-clock gaps: the monotonic clock stops during system
 *   sleep on some systems, and the wall clock can be set back, so either alone
 *   can hide one. A clock change can therefore only start a new outage;
 * - a sign-in since the outage began (sessionEpoch) starts a new one;
 * - a reload resumes the run the tab was in (see `resumable`). Only the page's
 *   first outage may: within a page the clocks above decide.
 */
export function createOutageClock() {
  let current: Outage | null = null;
  /** When the latest failure was seen, on the wall clock (for the gap rule). */
  let lastWall = 0;
  let epoch = "";
  let firstOutage = true;
  const listeners = new Set<() => void>();
  const set = (v: Outage | null) => {
    current = v;
    for (const l of listeners) l();
  };
  const end = () => {
    remember(null);
    if (current !== null) set(null);
  };
  return {
    get: (): Outage | null => current,
    observe(result: { ok: true } | { ok: false; error: unknown }, at = monotonicNow()) {
      // Success, or "not signed in", is an answer: the outage, if any, is over.
      if (result.ok || isSignedOutError(result.error)) return end();
      const now = sessionEpoch.get();
      const wall = Date.now();
      if (current !== null && now === epoch && Math.max(at - current.last, wall - lastWall) <= SESSION_MAX_CHECK_GAP_MS) {
        if (at > current.last) {
          lastWall = wall;
          set({ since: current.since, last: at });
          remember({ epoch, span: at - current.since, wallLast: wall });
        }
        return;
      }
      epoch = now;
      const span = firstOutage ? resumable(epoch) : null;
      firstOutage = false;
      const since = span !== null ? at - span : at;
      lastWall = wall;
      set({ since, last: at });
      remember({ epoch, span: at - since, wallLast: wall });
    },
    /** Forgets the outage, the tab's stored copy too: the clock is as on a page just loaded. */
    reset() {
      firstOutage = true;
      end();
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

function currentProtocol(): string {
  try {
    return window.location.protocol;
  } catch {
    return "http:";
  }
}

/**
 * The flag's cookie. Over https it is a __Host- cookie: Secure, for this host
 * only, with no Domain, so a sibling subdomain cannot set one this app would
 * read (a sign-out loop). Plain http cannot carry __Host- cookies, so there it
 * keeps a plain name; that is localhost development.
 */
export const pendingCookie = {
  name: (protocol: string): string => (protocol === "https:" ? `__Host-${PENDING_COOKIE}` : PENDING_COOKIE),
  read(protocol: string = currentProtocol()): boolean {
    try {
      const name = pendingCookie.name(protocol);
      return document.cookie.split(";").some((c) => c.trim() === `${name}=1`);
    } catch {
      return false;
    }
  },
  write(on: boolean, protocol: string = currentProtocol()): void {
    try {
      const name = pendingCookie.name(protocol);
      const secure = protocol === "https:" ? "; Secure" : "";
      document.cookie = on
        ? `${name}=1; Path=/; SameSite=Strict; Max-Age=604800${secure}`
        : `${name}=; Path=/; SameSite=Strict; Max-Age=0${secure}`;
    } catch {
      // cookies refused: localStorage or memory still carry it
    }
  },
};

const cookieFlag = () => pendingCookie.read();
const setCookieFlag = (on: boolean) => pendingCookie.write(on);

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
