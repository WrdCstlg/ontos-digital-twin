// @vitest-environment jsdom
/**
 * The three-minute session grace period, tested as a system: the real query
 * client, tRPC client, sign-out completer, AuthGuard, useAuth and login page,
 * against a fake Ontos that can go down, answer slowly, or not answer at all.
 * Each test names the invariant (I1–I5) or bound (B1–B3) of lib/sessionGrace.ts
 * it pins, or the defect it guards against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router";
import type { AppRouter } from "../../api/router";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/hooks/useAuth";
import {
  outageClock,
  pendingSignOut,
  resetOutageExpiry,
  SESSION_GRACE_MS,
  SESSION_HEALTHY_RECHECK_MS,
  SESSION_LOCK_MAX_HOLD_MS,
  SESSION_RECHECK_MS,
  withSessionLock,
} from "@/lib/sessionGrace";
import Login from "@/pages/Login";
import { createAppQueryClient, createAppTrpcClient, SessionSignOutCompleter, trpc } from "@/providers/trpc";

/** A fake Ontos: up or down, slow or quick, with or without a session, recording every call. */
const server = {
  down: false,
  session: true,
  latencyMs: 0,
  /** Per-procedure latency, over latencyMs. */
  slow: {} as Record<string, number>,
  logoutDown: false,
  /** When set, sign-ins are refused with this error. */
  refuseSignIn: null as { code: string; message: string } | null,
  calls: [] as string[],
};
const HTTP_STATUS: Record<string, number> = { UNAUTHORIZED: 401, FORBIDDEN: 403, SERVICE_UNAVAILABLE: 503 };
const USER = { id: 1, name: "Ada Byron", email: "ada@acme.com", role: "admin", avatar: null };
const PERSONA_KEY = "ontos:active-persona";

const fakeLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable((observer) => {
    server.calls.push(op.path);
    const fail = (code: string, message: string) =>
      observer.error(TRPCClientError.from({ error: { message, code: -32000, data: { code, httpStatus: HTTP_STATUS[code] ?? 500 } } } as never));
    const ok = (data: unknown) => {
      observer.next({ result: { type: "data", data } } as never);
      observer.complete();
    };
    const answer = () => {
      if (server.down) return fail("SERVICE_UNAVAILABLE", "Your session could not be checked just now.");
      switch (op.path) {
        case "auth.me":
          return server.session ? ok(USER) : fail("UNAUTHORIZED", "Please sign in");
        case "auth.logout":
          if (server.logoutDown) return fail("SERVICE_UNAVAILABLE", "Your session could not be checked just now.");
          if (!server.session) return fail("UNAUTHORIZED", "Please sign in");
          server.session = false;
          return ok({ success: true });
        case "auth.demoLogin":
        case "auth.login":
          if (server.refuseSignIn) return fail(server.refuseSignIn.code, server.refuseSignIn.message);
          server.session = true;
          return ok(USER);
        default:
          return server.session ? ok({ totals: { nodes: 1, edges: 0 } }) : fail("UNAUTHORIZED", "Please sign in");
      }
    };
    const latency = server.slow[op.path] ?? server.latencyMs;
    if (latency === 0) return void answer();
    const t = setTimeout(answer, latency);
    return () => clearTimeout(t);
  });

const seen: {
  auth: ReturnType<typeof useAuth> | null;
  watcher: ReturnType<typeof useAuth> | null;
  navigate: NavigateFunction | null;
  appMounts: number;
} = { auth: null, watcher: null, navigate: null, appMounts: 0 };
const paths: string[] = [];

function Probe() {
  const auth = useAuth();
  useEffect(() => {
    seen.auth = auth;
  });
  useEffect(() => {
    seen.appMounts++;
  }, []);
  // Another request on the page, whose failures should prompt a session check.
  trpc.graph.stats.useQuery(undefined, { retry: false, refetchInterval: 5_000 });
  return <div>app content</div>;
}

/** A page that makes no requests of its own. */
function QuietProbe() {
  const auth = useAuth();
  useEffect(() => {
    seen.auth = auth;
  });
  return <div>quiet content</div>;
}

/** A consumer of useAuth that stays mounted on every page, as a global header would. */
function Watcher() {
  const auth = useAuth();
  useEffect(() => {
    seen.watcher = auth;
  });
  return null;
}

function Where() {
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    seen.navigate = navigate;
  });
  useEffect(() => {
    if (paths[paths.length - 1] !== loc.pathname) paths.push(loc.pathname);
  }, [loc.pathname]);
  return null;
}

function renderApp({ start = "/app", watcher = false, realLinks = false } = {}) {
  const queryClient = createAppQueryClient();
  const client = createAppTrpcClient(realLinks ? undefined : [fakeLink]);
  return render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SessionSignOutCompleter />
        <MemoryRouter initialEntries={[start]}>
          <Where />
          {watcher && <Watcher />}
          <Routes>
            <Route path="/app" element={<AuthGuard><Probe /></AuthGuard>} />
            <Route path="/quiet" element={<AuthGuard><QuietProbe /></AuthGuard>} />
            <Route path="/login" element={<Login />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </trpc.Provider>,
  );
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const count = (path: string) => server.calls.filter((c) => c === path).length;
const go = (path: string) => act(async () => void seen.navigate?.(path));
/** Another tab signs in: it clears the shared flag, and this tab hears of it. */
function anotherTabSignsIn(persona?: unknown) {
  window.localStorage.removeItem("ontos:pending-sign-out");
  document.cookie = "ontos_pending_signout=; Path=/; Max-Age=0";
  if (persona) window.localStorage.setItem(PERSONA_KEY, JSON.stringify(persona));
  return act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: "ontos:pending-sign-out" })));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  Object.assign(server, { down: false, session: true, latencyMs: 0, slow: {}, logoutDown: false, refuseSignIn: null, calls: [] });
  paths.length = 0;
  Object.assign(seen, { auth: null, watcher: null, navigate: null, appMounts: 0 });
  outageClock.reset();
  resetOutageExpiry();
  pendingSignOut.clear();
  window.localStorage.clear();
  document.cookie = "ontos_pending_signout=; Path=/; Max-Age=0";
});

afterEach(async () => {
  cleanup();
  // Let whatever is still in flight settle (B3, B4) before the fake clock goes,
  // so no request or lock holder carries over into the next test.
  await vi.advanceTimersByTimeAsync(SESSION_LOCK_MAX_HOLD_MS + 1);
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a page loaded during an outage", () => {
  it("waits, reconnecting, through a one-minute outage and then signs in", async () => {
    server.down = true;
    renderApp();
    await advance(60_000);
    expect(paths).toEqual(["/app"]);
    expect(screen.getByText(/Reconnecting to Ontos/)).toBeTruthy();
    server.down = false;
    await advance(16_000);
    expect(screen.getByText("app content")).toBeTruthy();
    expect(seen.auth?.isAuthenticated).toBe(true);
    expect(paths).toEqual(["/app"]);
  });

  it("signs out after three minutes, then ends the session on the server once it answers", async () => {
    server.down = true;
    renderApp();
    await advance(SESSION_GRACE_MS + 20_000);
    expect(paths).toEqual(["/app", "/login"]);
    expect(pendingSignOut.get()).toBe(true);
    expect(screen.getByText(/signed out because Ontos could not check your session/)).toBeTruthy();
    // The server returns with the old session still valid: the app ends it.
    server.down = false;
    await advance(16_000);
    expect(count("auth.logout")).toBeGreaterThanOrEqual(1);
    expect(server.session).toBe(false);
    expect(pendingSignOut.get()).toBe(false);
    expect(paths).toEqual(["/app", "/login"]);
  });

  it("B3: counts a server that never answers as an outage, giving up on each call after 10 s (real links)", async () => {
    const requests: { path: string; start: number; end?: number }[] = [];
    let hang = true;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://ontos.test").pathname.replace("/api/trpc/", "");
      const req: { path: string; start: number; end?: number } = { path, start: performance.now() };
      requests.push(req);
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          req.end = performance.now();
          reject(init.signal?.reason);
        });
        if (hang) return;
        req.end = performance.now();
        if (path.startsWith("auth.logout")) {
          server.session = false;
          resolve(json(200, { result: { data: { json: { success: true } } } }));
        } else resolve(json(401, { error: { json: { message: "Please sign in", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } } }));
      });
    });
    renderApp({ realLinks: true });
    await advance(SESSION_GRACE_MS + 90_000);
    expect(paths).toEqual(["/app", "/login"]);
    expect(pendingSignOut.get()).toBe(true);
    // Every call was abandoned at the timeout, none left hanging.
    const settled = requests.filter((r) => r.end !== undefined);
    expect(settled.length).toBeGreaterThan(0);
    for (const r of settled) expect(r.end! - r.start).toBeLessThanOrEqual(10_000);
    expect(requests.filter((r) => r.end === undefined).length).toBeLessThanOrEqual(2);
    // The server answers again: the sign-out is completed through the real link.
    hang = false;
    await advance(16_000);
    expect(requests.some((r) => r.path.startsWith("auth.logout") && r.end !== undefined)).toBe(true);
    expect(pendingSignOut.get()).toBe(false);
  });
});

describe("a signed-in page", () => {
  it("notices an outage through another request, stays signed in through 30 seconds of it, and recovers", async () => {
    renderApp();
    await advance(100);
    expect(seen.auth?.isAuthenticated).toBe(true);
    server.down = true;
    await advance(30_000);
    expect(seen.auth?.isReconnecting).toBe(true);
    expect(seen.auth?.isAuthenticated).toBe(true);
    server.down = false;
    await advance(16_000);
    expect(seen.auth?.isReconnecting).toBe(false);
    expect(seen.auth?.isAuthenticated).toBe(true);
    expect(paths).toEqual(["/app"]);
  });

  it("signs out when the outage it noticed lasts three minutes", async () => {
    renderApp();
    await advance(100);
    server.down = true;
    await advance(SESSION_GRACE_MS + 30_000);
    expect(paths).toEqual(["/app", "/login"]);
    expect(pendingSignOut.get()).toBe(true);
  });

  it("I1: a 401 on any request signs out within seconds, not at the next minute's check", async () => {
    renderApp();
    await advance(100);
    server.session = false; // the session ended elsewhere
    await advance(6_000);
    expect(paths).toEqual(["/app", "/login"]);
    expect(pendingSignOut.get()).toBe(false);
    expect(screen.queryByText(/signed out because Ontos could not check your session/)).toBeNull();
  });

  it("I2: a change to the system clock neither shortens nor lengthens the three minutes", async () => {
    renderApp();
    await advance(100);
    server.down = true;
    await advance(30_000);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await advance(60_000);
    expect(seen.auth?.isAuthenticated).toBe(true);
    expect(paths).toEqual(["/app"]);
    vi.setSystemTime(Date.now() - 60 * 60_000);
    await advance(SESSION_GRACE_MS);
    expect(paths).toEqual(["/app", "/login"]);
  });

  it("I2: a hidden tab, whose retries react-query would pause, still gathers the evidence and signs out", async () => {
    renderApp();
    await advance(100);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    focusManager.setFocused(false);
    try {
      server.down = true;
      await advance(SESSION_HEALTHY_RECHECK_MS + SESSION_GRACE_MS + 20_000);
      expect(paths).toEqual(["/app", "/login"]);
      expect(pendingSignOut.get()).toBe(true);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it("I2: slow failures still count: other requests' failures never cancel a check under way", async () => {
    renderApp();
    await advance(100);
    server.down = true;
    server.latencyMs = 9_000; // just under the session call timeout
    await advance(SESSION_GRACE_MS + 120_000);
    expect(paths).toEqual(["/app", "/login"]);
    expect(pendingSignOut.get()).toBe(true);
  });

  it("B1: a quiet page, with no requests of its own, notices an outage within a minute", async () => {
    renderApp({ start: "/quiet" });
    await advance(100);
    const before = count("auth.me");
    await advance(5 * 60_000);
    expect(count("auth.me") - before).toBeLessThanOrEqual(5);
    server.down = true;
    await advance(SESSION_HEALTHY_RECHECK_MS + SESSION_GRACE_MS + 20_000);
    expect(paths).toEqual(["/quiet", "/login"]);
  });

  it("B1, B2: requests stay bounded through the outage, and none carry on after the sign-out", async () => {
    renderApp();
    await advance(100);
    server.down = true;
    const before = count("auth.me");
    await advance(SESSION_GRACE_MS + 30_000);
    expect(paths).toEqual(["/app", "/login"]);
    // Three attempts per 15 s check, plus the check that noticed and the deadline check.
    expect(count("auth.me") - before).toBeLessThanOrEqual(3 * ((SESSION_GRACE_MS + 30_000) / SESSION_RECHECK_MS + 2));
    const meAfter = count("auth.me");
    const logoutsAfter = count("auth.logout");
    await advance(5 * 60_000);
    expect(count("auth.me") - meAfter).toBe(0);
    expect(count("auth.logout") - logoutsAfter).toBeLessThanOrEqual((5 * 60_000) / SESSION_RECHECK_MS + 1);
  });
});

describe("after an outage sign-out", () => {
  it("I4: stays signed out while the server still holds the old session, and shows nothing of the app", async () => {
    renderApp();
    await advance(100);
    server.down = true;
    await advance(SESSION_GRACE_MS + 30_000);
    const mounts = seen.appMounts;
    // The server is back and the old session is valid, but its sign-out keeps failing.
    server.down = false;
    server.logoutDown = true;
    await advance(60_000);
    expect(pendingSignOut.get()).toBe(true);
    await go("/app");
    await advance(1_000);
    expect(paths[paths.length - 1]).toBe("/login");
    expect(seen.appMounts).toBe(mounts);
    // The sign-out goes through at last: the old session is gone for good.
    server.logoutDown = false;
    await advance(16_000);
    expect(server.session).toBe(false);
    expect(pendingSignOut.get()).toBe(false);
    await go("/app");
    await advance(1_000);
    expect(paths[paths.length - 1]).toBe("/login");
    expect(seen.appMounts).toBe(mounts);
  });

  it("I4: the remembered persona does not come back as signed in once the server has ended the session", async () => {
    window.localStorage.setItem(PERSONA_KEY, JSON.stringify(USER));
    renderApp();
    await advance(100);
    expect(seen.auth?.isAuthenticated).toBe(true);
    server.down = true;
    await advance(SESSION_GRACE_MS + 30_000);
    expect(paths).toEqual(["/app", "/login"]);
    expect(window.localStorage.getItem(PERSONA_KEY)).toBeNull();
    const mounts = seen.appMounts;
    server.down = false;
    await advance(16_000);
    expect(pendingSignOut.get()).toBe(false);
    await go("/app");
    await advance(1_000);
    expect(paths[paths.length - 1]).toBe("/login");
    expect(seen.appMounts).toBe(mounts);
  });

  it("I4: a page loaded while the sign-out is pending goes straight to the login page and ends the session", async () => {
    pendingSignOut.set();
    window.localStorage.setItem(PERSONA_KEY, JSON.stringify(USER));
    renderApp();
    await advance(100);
    expect(paths).toEqual(["/app", "/login"]);
    expect(seen.appMounts).toBe(0);
    expect(server.session).toBe(false);
    expect(pendingSignOut.get()).toBe(false);
  });

  it("I3: when another tab signs in, this tab's old outage cannot sign the new session out", async () => {
    renderApp({ watcher: true });
    await advance(100);
    server.down = true;
    await advance(SESSION_GRACE_MS + 30_000);
    expect(pendingSignOut.get()).toBe(true);
    // The server is still down; another tab signs in anyway (the persona path does not wait for it).
    await anotherTabSignsIn(USER);
    await advance(100);
    expect(seen.watcher?.isAuthenticated).toBe(true);
    // The new session gets its own full three minutes of failed checks.
    await advance(SESSION_HEALTHY_RECHECK_MS + 90_000);
    expect(pendingSignOut.get()).toBe(false);
    expect(seen.watcher?.isAuthenticated).toBe(true);
    await advance(SESSION_GRACE_MS);
    expect(pendingSignOut.get()).toBe(true);
    expect(seen.watcher?.isAuthenticated).toBe(false);
  });

  it("B1: a mounted session check keeps to its 15 s cadence while the sign-out is pending", async () => {
    renderApp({ watcher: true });
    await advance(100);
    server.down = true;
    await advance(SESSION_GRACE_MS + 30_000);
    expect(pendingSignOut.get()).toBe(true);
    const before = count("auth.me");
    await advance(60_000);
    expect(count("auth.me") - before).toBeLessThanOrEqual(3 * (60_000 / SESSION_RECHECK_MS + 1));
  });
});

describe("signing in again", () => {
  it("after an outage sign-out, the new session holds", async () => {
    server.down = true;
    renderApp();
    await advance(SESSION_GRACE_MS + 20_000);
    expect(paths).toEqual(["/app", "/login"]);
    server.down = false;
    await advance(16_000); // the old session is ended on the server
    fireEvent.click(screen.getByText("Elena Cortez"));
    await advance(1_000);
    expect(paths).toEqual(["/app", "/login", "/app"]);
    await advance(60_000);
    expect(seen.auth?.isAuthenticated).toBe(true);
    expect(server.session).toBe(true);
    expect(paths).toEqual(["/app", "/login", "/app"]);
  });

  it("I5: a sign-in the server cannot answer is refused with its reason, and the outage sign-out stays pending", async () => {
    server.down = true;
    renderApp();
    await advance(SESSION_GRACE_MS + 20_000);
    expect(paths).toEqual(["/app", "/login"]);
    fireEvent.click(screen.getByText("Elena Cortez"));
    await advance(1_000);
    expect(paths).toEqual(["/app", "/login"]);
    expect(screen.getByText("Your session could not be checked just now.")).toBeTruthy();
    expect(pendingSignOut.get()).toBe(true);
    // The server comes back with the old session still valid: it is ended, not revived.
    server.down = false;
    await advance(16_000);
    expect(server.session).toBe(false);
    expect(pendingSignOut.get()).toBe(false);
    expect(paths).toEqual(["/app", "/login"]);
  });

  it("the email and password form signs in, the way in when persona login is off", async () => {
    server.session = false;
    renderApp({ start: "/login" });
    await advance(100);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@acme-ontology.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-admin-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await advance(1_000);
    expect(count("auth.login")).toBe(1);
    expect(server.session).toBe(true);
    expect(paths).toEqual(["/login", "/app"]);
    expect(seen.auth?.isAuthenticated).toBe(true);
  });

  it("wrong credentials are refused with the server's message", async () => {
    server.session = false;
    server.refuseSignIn = { code: "UNAUTHORIZED", message: "Invalid email or password." };
    renderApp({ start: "/login" });
    await advance(100);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@acme-ontology.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await advance(1_000);
    expect(paths).toEqual(["/login"]);
    expect(screen.getByRole("alert").textContent).toBe("Invalid email or password.");
    expect(seen.appMounts).toBe(0);
  });

  it("a sign-in the server refuses shows why and opens nothing", async () => {
    server.session = false;
    server.refuseSignIn = { code: "FORBIDDEN", message: "Demo login is disabled in production." };
    renderApp({ start: "/login" });
    await advance(100);
    fireEvent.click(screen.getByText("Elena Cortez"));
    await advance(1_000);
    expect(paths).toEqual(["/login"]);
    expect(screen.getByText("Demo login is disabled in production.")).toBeTruthy();
    expect(seen.appMounts).toBe(0);
    expect(window.localStorage.getItem(PERSONA_KEY)).toBeNull();
    // The personas are usable again.
    expect((screen.getByText("Elena Cortez").closest("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a remembered persona whose session has ended is checked on load, and forgotten", async () => {
    window.localStorage.setItem(PERSONA_KEY, JSON.stringify(USER));
    server.session = false;
    // A page with no requests of its own: only the session check can notice.
    renderApp({ start: "/quiet" });
    await advance(1_000);
    expect(paths).toEqual(["/quiet", "/login"]);
    expect(window.localStorage.getItem(PERSONA_KEY)).toBeNull();
  });

  it("I5: a pending server sign-out never lands after a sign-in and ends the new session", async () => {
    server.down = true;
    renderApp();
    await advance(SESSION_GRACE_MS + 20_000);
    expect(pendingSignOut.get()).toBe(true);
    // The server returns slowly: a sign-out attempt is in flight when the user signs in.
    server.down = false;
    server.latencyMs = 3_000;
    await advance(SESSION_RECHECK_MS - 1_000);
    fireEvent.click(screen.getByText("Elena Cortez"));
    await advance(30_000);
    expect(server.session).toBe(true);
    expect(seen.auth?.isAuthenticated).toBe(true);
  });

  it("I5: an ordinary sign-out still in flight cannot undo a sign-in made meanwhile in another tab", async () => {
    renderApp();
    await advance(100);
    server.slow = { "auth.logout": 5_000, "auth.demoLogin": 1_000 };
    act(() => seen.auth?.logout());
    await advance(100);
    // Another tab signs in while the sign-out is on its way (it shares the session lock).
    const otherTab = createAppTrpcClient([fakeLink]);
    void withSessionLock(() => otherTab.auth.demoLogin.mutate({ role: "admin" })).catch(() => undefined);
    await advance(10_000);
    expect(count("auth.logout")).toBe(1);
    expect(server.session).toBe(true);
  });

  it("a persona sign-in holds even when the page's first requests reach the server before the new session cookie does", async () => {
    server.session = false;
    renderApp({ start: "/login" });
    await advance(100);
    // The server takes a moment to create the session; the app shows the page at once.
    server.slow = { "auth.demoLogin": 300 };
    fireEvent.click(screen.getByText("Elena Cortez"));
    await advance(5_000);
    expect(server.session).toBe(true);
    expect(paths).toEqual(["/login", "/app"]);
    expect(seen.auth?.isAuthenticated).toBe(true);
  });

  it("after an ordinary sign-out, goes straight in without bouncing back to the login page", async () => {
    renderApp();
    await advance(100);
    act(() => seen.auth?.logout());
    await advance(1_000);
    expect(paths).toEqual(["/app", "/login"]);
    fireEvent.click(screen.getByText("Elena Cortez"));
    await advance(1_000);
    await advance(10_000);
    expect(paths).toEqual(["/app", "/login", "/app"]);
    expect(seen.auth?.isAuthenticated).toBe(true);
  });
});
