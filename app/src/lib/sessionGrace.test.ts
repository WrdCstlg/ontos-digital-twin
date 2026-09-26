// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimOutageExpiry,
  createOutageClock,
  isOutageError,
  isSignedOutError,
  pendingSignOut,
  resetOutageExpiry,
  SESSION_CALL_TIMEOUT_MS,
  SESSION_GRACE_MS,
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
    const cookie = vi.spyOn(Document.prototype, "cookie", "get").mockReturnValue("");
    vi.spyOn(Document.prototype, "cookie", "set").mockImplementation(() => undefined);
    pendingSignOut.set();
    expect(pendingSignOut.get()).toBe(true);
    cookie.mockRestore();
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
