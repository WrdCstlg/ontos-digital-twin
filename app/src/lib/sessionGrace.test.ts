// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimOutageExpiry,
  createOutageClock,
  isOutageError,
  isSignedOutError,
  pendingCookie,
  pendingSignOut,
  resetOutageExpiry,
  SESSION_EPOCH_KEY,
  SESSION_MAX_CHECK_GAP_MS,
  SESSION_OUTAGE_KEY,
  sessionEpoch,
  SESSION_CALL_TIMEOUT_MS,
  SESSION_GRACE_MS,
  SESSION_RECHECK_MS,
  SESSION_LOCK_MAX_HOLD_MS,
  sessionState,
  subscribePending,
  withSessionLock,
} from "./sessionGrace";

const unavailable = { data: { code: "SERVICE_UNAVAILABLE" } };
const unauthorized = { data: { code: "UNAUTHORIZED" } };
const network = { message: "Failed to fetch", data: undefined };
const T0 = 1_000_000;
const base = { hasUser: false, error: null, outage: null, paused: false };

function clearCookies() {
  document.cookie = "ontos_pending_signout=; Path=/; Max-Age=0";
}

/**
 * Stands in for the cookie jar, on `document` itself, while `run` runs; the
 * writes are recorded, not applied. (Spying on both of Document.prototype's
 * cookie accessors leaves the getter's stub behind once both are restored.)
 */
function withCookieJar(jar: string, run: (written: string[]) => void) {
  const written: string[] = [];
  Object.defineProperty(document, "cookie", { configurable: true, get: () => jar, set: (v: string) => void written.push(v) });
  try {
    run(written);
  } finally {
    Reflect.deleteProperty(document, "cookie");
  }
}

describe("sessionState", () => {
  it("I1: signs out at once when the server says there is no session", () => {
    expect(sessionState({ ...base, status: "error", hasUser: true, error: unauthorized })).toEqual({ kind: "signed-out", reason: "no-session" });
  });

  it("keeps a signed-in user through failed checks less than three minutes apart", () => {
    const s = sessionState({ ...base, status: "error", hasUser: true, error: unavailable, outage: { since: T0, last: T0 + SESSION_GRACE_MS - 1 } });
    expect(s).toEqual({ kind: "signed-in", degraded: true });
  });

  it("I2: signs out on a failed check three minutes after the first, cached user or not", () => {
    for (const hasUser of [true, false]) {
      const s = sessionState({ ...base, status: "error", hasUser, error: unavailable, outage: { since: T0, last: T0 + SESSION_GRACE_MS } });
      expect(s).toEqual({ kind: "signed-out", reason: "outage" });
    }
  });

  it("I2: needs evidence: a first failure alone, however recent, never signs out", () => {
    expect(sessionState({ ...base, status: "error", hasUser: true, error: network, outage: null })).toEqual({ kind: "signed-in", degraded: true });
    expect(sessionState({ ...base, status: "error", error: network, outage: { since: T0, last: T0 } })).toEqual({ kind: "checking", unreachable: true });
  });

  it("waits, never signing out, while a first check runs or is paused", () => {
    expect(sessionState({ ...base, status: "pending" })).toEqual({ kind: "checking", unreachable: false });
    expect(sessionState({ ...base, status: "pending", paused: true })).toEqual({ kind: "checking", unreachable: true });
  });

  it("is signed in whenever the last check succeeded, even if the clock has not caught up", () => {
    expect(sessionState({ ...base, status: "success", hasUser: true, outage: { since: T0, last: T0 + 500_000 } })).toEqual({ kind: "signed-in", degraded: false });
  });
});

describe("error classes", () => {
  it("counts a 503 and no answer at all as an outage, and 401 as signed out", () => {
    expect(isOutageError(unavailable)).toBe(true);
    expect(isOutageError(network)).toBe(true);
    expect(isOutageError(unauthorized)).toBe(false);
    expect(isOutageError({ data: { code: "BAD_REQUEST" } })).toBe(false);
    expect(isOutageError(null)).toBe(false);
    expect(isSignedOutError(unauthorized)).toBe(true);
    expect(isSignedOutError(unavailable)).toBe(false);
  });
});

describe("the outage clock", () => {
  it("keeps the first failure as the start, moves the last, and stops on success", () => {
    const clock = createOutageClock();
    const listener = vi.fn();
    clock.subscribe(listener);
    clock.observe({ ok: false, error: unavailable }, T0);
    clock.observe({ ok: false, error: unavailable }, T0 + 15_000);
    expect(clock.get()).toEqual({ since: T0, last: T0 + 15_000 });
    clock.observe({ ok: true }, T0 + 30_000);
    expect(clock.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("stops on 'not signed in', which is an answer, not an outage", () => {
    const clock = createOutageClock();
    clock.observe({ ok: false, error: unavailable }, T0);
    clock.observe({ ok: false, error: unauthorized }, T0 + 1);
    expect(clock.get()).toBeNull();
  });

  it("never moves backwards, and keeps the same snapshot while nothing changes", () => {
    const clock = createOutageClock();
    clock.observe({ ok: false, error: unavailable }, T0 + 10);
    const a = clock.get();
    clock.observe({ ok: false, error: unavailable }, T0);
    clock.observe({ ok: false, error: unavailable }, T0 + 10);
    expect(clock.get()).toBe(a);
  });
});

describe("the outage clock counts only evidence it saw at the checking pace", () => {
  const fail = { ok: false, error: unavailable } as const;
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.removeItem(SESSION_EPOCH_KEY);
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => void vi.useRealTimers());
  /** Both clocks move on by `ms`, as they do while the system is awake. */
  const pass = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it("a gap longer than any checking pace starts a new outage; a throttled tab's minute does not", () => {
    const clock = createOutageClock();
    clock.observe(fail, T0);
    pass(15_000);
    clock.observe(fail, T0 + 15_000);
    const gapped = T0 + 15_000 + SESSION_MAX_CHECK_GAP_MS + 1;
    pass(SESSION_MAX_CHECK_GAP_MS + 1);
    clock.observe(fail, gapped);
    expect(clock.get()).toEqual({ since: gapped, last: gapped });
    // A throttled background tab, checking once a minute, still gathers evidence.
    pass(60_000);
    clock.observe(fail, gapped + 60_000);
    expect(clock.get()).toEqual({ since: gapped, last: gapped + 60_000 });
  });

  it("a gap only the wall clock saw (a system asleep, where the monotonic clock stops) starts a new outage", () => {
    const clock = createOutageClock();
    clock.observe(fail, T0);
    pass(170_000);
    clock.observe(fail, T0 + 170_000);
    // Two hours asleep: the monotonic clock moved 15 s, the wall clock two hours.
    pass(2 * 3_600_000);
    clock.observe(fail, T0 + 185_000);
    expect(clock.get()).toEqual({ since: T0 + 185_000, last: T0 + 185_000 });
  });

  it("a wall clock set back neither hides a gap nor breaks a run", () => {
    const clock = createOutageClock();
    clock.observe(fail, T0);
    vi.setSystemTime(Date.now() - 10 * 60_000);
    clock.observe(fail, T0 + 15_000);
    expect(clock.get()).toEqual({ since: T0, last: T0 + 15_000 });
    clock.observe(fail, T0 + 15_000 + SESSION_MAX_CHECK_GAP_MS + 1);
    expect(clock.get()?.since).toBe(T0 + 15_000 + SESSION_MAX_CHECK_GAP_MS + 1);
  });

  it("U6: a sign-in since the outage began, in any tab, starts a new one", () => {
    const clock = createOutageClock();
    clock.observe(fail, T0);
    sessionEpoch.bump();
    pass(15_000);
    clock.observe(fail, T0 + 15_000);
    expect(clock.get()).toEqual({ since: T0 + 15_000, last: T0 + 15_000 });
  });

  it("U3: a reload resumes the run the tab was in, crediting its span and the reload's own gap", () => {
    const before = createOutageClock();
    before.observe(fail, T0);
    pass(30_000);
    before.observe(fail, T0 + 30_000);
    pass(5_000);
    // The page reloads: a new clock, a new monotonic origin.
    const after = createOutageClock();
    after.observe(fail, 50);
    expect(after.get()).toEqual({ since: 50 - 30_000 - 5_000, last: 50 });
    // A success ends it, and a later reload starts afresh.
    after.observe({ ok: true }, 60);
    const again = createOutageClock();
    again.observe(fail, 5);
    expect(again.get()).toEqual({ since: 5, last: 5 });
  });

  it("U3: a clock stepped forward across a reload shortens the grace period by at most one checking interval", () => {
    const before = createOutageClock();
    for (let t = 0; t <= 105_000; t += 15_000) {
      if (t > 0) pass(15_000);
      before.observe(fail, t);
    }
    // The system clock steps 80 s forward, and the page reloads a moment later:
    // the run had lasted 105 s, and the step adds at most one checking interval.
    pass(80_000 + 1_000);
    const after = createOutageClock();
    after.observe(fail, 50);
    expect(after.get()).toEqual({ since: 50 - 105_000 - SESSION_RECHECK_MS, last: 50 });
  });

  it("U3: a reload just after a new run began resumes that run, not the one before it", () => {
    const before = createOutageClock();
    for (let t = 0; t <= 150_000; t += 30_000) {
      if (t > 0) pass(30_000);
      before.observe(fail, t);
    }
    // 100 s pass with no check, but the wall clock, set back meanwhile, shows
    // only 70 s: the monotonic clock breaks the run, and a new one begins.
    pass(70_000);
    before.observe(fail, 250_000);
    expect(before.get()).toEqual({ since: 250_000, last: 250_000 });
    pass(1_000);
    const after = createOutageClock();
    after.observe(fail, 50);
    expect(after.get()).toEqual({ since: 50 - 1_000, last: 50 });
  });

  it("U3: a user reloading faster than the checks still gathers evidence, one reload's gap at a time", () => {
    let spanReached = 0;
    for (let reload = 0; reload < 30 && spanReached < SESSION_GRACE_MS; reload++) {
      const page = createOutageClock();
      page.observe(fail, 1_000);
      spanReached = page.get()!.last - page.get()!.since;
      pass(10_000);
    }
    expect(spanReached).toBeGreaterThanOrEqual(SESSION_GRACE_MS);
  });

  it("U3: a run remembered from too long ago, or from the future, is not resumed", () => {    createOutageClock().observe(fail, T0);
    pass(SESSION_GRACE_MS + SESSION_MAX_CHECK_GAP_MS + 1);
    const stale = createOutageClock();
    stale.observe(fail, 7);
    expect(stale.get()).toEqual({ since: 7, last: 7 });
    vi.setSystemTime(Date.now() - 10 * 60_000);
    const future = createOutageClock();
    future.observe(fail, 9);
    expect(future.get()).toEqual({ since: 9, last: 9 });
  });

  describe("U3: each bound on resuming holds by itself", () => {
    const reloaded = () => {
      const clock = createOutageClock();
      clock.observe(fail, 11);
      return clock.get();
    };

    it("not when its latest check was longer ago than any checking pace", () => {
      const before = createOutageClock();
      before.observe(fail, 0);
      pass(30_000);
      before.observe(fail, 30_000);
      pass(SESSION_MAX_CHECK_GAP_MS + 10_000);
      expect(reloaded()).toEqual({ since: 11, last: 11 });
    });

    it("not when the run had lasted longer than the grace period and a gap, though it was checked just now", () => {
      const before = createOutageClock();
      for (let t = 0; t <= SESSION_GRACE_MS + SESSION_MAX_CHECK_GAP_MS + 30_000; t += 60_000) {
        if (t > 0) pass(60_000);
        before.observe(fail, t);
      }
      pass(5_000);
      expect(reloaded()).toEqual({ since: 11, last: 11 });
    });

    it("not when the clock was set back past its latest check", () => {
      const before = createOutageClock();
      before.observe(fail, 0);
      pass(60_000);
      before.observe(fail, 60_000);
      vi.setSystemTime(Date.now() - 10_000);
      expect(reloaded()).toEqual({ since: 11, last: 11 });
    });

    it("not after a sign-in since, in any tab (U6)", () => {
      const before = createOutageClock();
      before.observe(fail, 0);
      pass(30_000);
      before.observe(fail, 30_000);
      sessionEpoch.bump();
      expect(reloaded()).toEqual({ since: 11, last: 11 });
    });

    it("not from a record that is malformed, or claims a negative span", () => {
      const epoch = sessionEpoch.get();
      const now = Date.now();
      for (const raw of [
        "not json",
        "null",
        JSON.stringify({ epoch }),
        JSON.stringify({ epoch, span: "30000", wallLast: now }),
        JSON.stringify({ epoch, span: 30_000, wallLast: String(now) }),
        JSON.stringify({ epoch, span: -1_000, wallLast: now }),
        JSON.stringify({ epoch, wallSince: now - 30_000, wallLast: now }),
      ]) {
        window.sessionStorage.setItem(SESSION_OUTAGE_KEY, raw);
        expect(reloaded(), raw).toEqual({ since: 11, last: 11 });
      }
    });

    it("but when every bound is met, it resumes", () => {
      const before = createOutageClock();
      before.observe(fail, 0);
      pass(30_000);
      before.observe(fail, 30_000);
      pass(10_000);
      expect(reloaded()).toEqual({ since: 11 - 30_000 - 10_000, last: 11 });
    });
  });
});

describe("the session epoch", () => {
  it("tells a tab of a sign-in in another tab once, and never of its own", () => {
    window.localStorage.removeItem(SESSION_EPOCH_KEY);
    sessionEpoch.takeChange(); // where the tab starts
    expect(sessionEpoch.takeChange()).toBe(false);
    sessionEpoch.bump(); // this tab signs in
    expect(sessionEpoch.takeChange()).toBe(false);
    window.localStorage.setItem(SESSION_EPOCH_KEY, "another-tab-signed-in");
    expect(sessionEpoch.takeChange()).toBe(true);
    expect(sessionEpoch.takeChange()).toBe(false);
  });
});

describe("the flag cookie", () => {
  afterEach(() => vi.restoreAllMocks());

  it("on https is a __Host- cookie, and a same-named cookie a sibling subdomain set is ignored", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    withCookieJar("ontos_pending_signout=1", (written) => {
      expect(pendingCookie.read("https:")).toBe(false);
      pendingCookie.write(true, "https:");
      expect(written[0]).toMatch(/^__Host-ontos_pending_signout=1; Path=\/; SameSite=Strict; Max-Age=\d+; Secure$/);
      expect(written[0]).not.toMatch(/Domain=/i);
    });
    withCookieJar("a=b; __Host-ontos_pending_signout=1", () => {
      expect(pendingCookie.read("https:")).toBe(true);
    });
  });

  it("on plain http, where __Host- cookies cannot be set, keeps its plain name", () => {
    withCookieJar("a=b; ontos_pending_signout=1", (written) => {
      expect(pendingCookie.read("http:")).toBe(true);
      pendingCookie.write(false, "http:");
      expect(written[0]).toMatch(/^ontos_pending_signout=; Path=\/; SameSite=Strict; Max-Age=0$/);
    });
  });

  it("leaves the real jar as it found it", () => {
    withCookieJar("ontos_pending_signout=1", () => undefined);
    expect(document.cookie).not.toContain("ontos_pending_signout=1");
  });
});

describe("claimOutageExpiry", () => {
  beforeEach(() => resetOutageExpiry());
  it("I3: lets an outage sign the user out once", () => {
    expect(claimOutageExpiry(T0)).toBe(true);
    expect(claimOutageExpiry(T0)).toBe(false);
    expect(claimOutageExpiry(T0 + 1)).toBe(true);
  });
});

describe("pendingSignOut", () => {
  beforeEach(() => {
    pendingSignOut.clear();
    clearCookies();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    pendingSignOut.clear();
    clearCookies();
  });

  it("lives in localStorage and a flag cookie, and clears from both", () => {
    expect(pendingSignOut.get()).toBe(false);
    pendingSignOut.set();
    expect(window.localStorage.getItem("ontos:pending-sign-out")).toBe("1");
    expect(document.cookie).toContain("ontos_pending_signout=1");
    pendingSignOut.clear();
    expect(pendingSignOut.get()).toBe(false);
    expect(document.cookie).not.toContain("ontos_pending_signout=1");
  });

  it("follows another tab: a sign-in there clears the localStorage flag and the cookie", () => {
    pendingSignOut.set();
    window.localStorage.removeItem("ontos:pending-sign-out");
    clearCookies();
    expect(pendingSignOut.get()).toBe(false);
  });

  it("survives a reload through the cookie when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    pendingSignOut.set();
    // A reload keeps cookies; the flag is still read from there.
    expect(document.cookie).toContain("ontos_pending_signout=1");
    expect(pendingSignOut.get()).toBe(true);
  });

  it("falls back to memory only when storage and cookies are both refused", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    withCookieJar("", () => {
      pendingSignOut.set();
      expect(pendingSignOut.get()).toBe(true);
    });
  });
});

describe("subscribePending", () => {
  it("hears other tabs' storage changes and re-reads on focus, but ignores other keys", () => {
    const listener = vi.fn();
    const off = subscribePending(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "ontos:pending-sign-out" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    window.dispatchEvent(new Event("focus"));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new StorageEvent("storage", { key: "ontos:pending-sign-out" }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("withSessionLock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("I5: runs one holder at a time within the tab when Web Locks are missing, and survives a failing holder", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = withSessionLock(
      () =>
        new Promise<void>((resolve) => {
          order.push("sign-in starts");
          release = () => {
            order.push("sign-in ends");
            resolve();
          };
        }),
    );
    const failing = withSessionLock(async () => {
      order.push("sign-out");
      throw new Error("503");
    });
    const third = withSessionLock(async () => void order.push("after"));
    try {
      await new Promise((r) => setTimeout(r, 10));
      expect(order).toEqual(["sign-in starts"]);
    } finally {
      release();
    }
    await first;
    await expect(failing).rejects.toThrow("503");
    await third;
    expect(order).toEqual(["sign-in starts", "sign-in ends", "sign-out", "after"]);
  });

  it("B4: lets go of a holder that never finishes, so the next one still runs", async () => {
    vi.useFakeTimers();
    try {
      const stuck = withSessionLock(() => new Promise<void>(() => undefined));
      const stuckSettled = expect(stuck).rejects.toThrow("held too long");
      let ran = false;
      const next = withSessionLock(async () => void (ran = true));
      await vi.advanceTimersByTimeAsync(SESSION_LOCK_MAX_HOLD_MS - 1);
      expect(ran).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stuckSettled;
      await next;
      expect(ran).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("B4: the bound is longer than a session call's timeout, so a timed-out call is never cut short", () => {
    expect(SESSION_LOCK_MAX_HOLD_MS).toBeGreaterThan(SESSION_CALL_TIMEOUT_MS);
  });

  it("a holder that throws at once still releases the lock", async () => {
    await expect(
      withSessionLock(() => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    await expect(withSessionLock(async () => "after")).resolves.toBe("after");
  });

  it("uses the browser's cross-tab lock when there is one", async () => {
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    await expect(withSessionLock(async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith("ontos-session", expect.any(Function));
  });
});
