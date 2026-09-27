// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MutationObserver, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../api/router";
import {
  outageClock,
  pendingSignOut,
  resetOutageExpiry,
  SESSION_LOCK_MAX_HOLD_MS,
  SESSION_OUTAGE_RECHECK_MS,
  withSessionLock,
} from "@/lib/sessionGrace";
import {
  createAppQueryClient,
  createAppTrpcClient,
  fetchWithTimeout,
  SESSION_CALL_TIMEOUT_MS,
  SESSION_PATHS,
  SessionSignOutCompleter,
  trpc,
} from "@/providers/trpc";

const err = (code: string) => TRPCClientError.from({ error: { message: code, code: -32000, data: { code } } } as never);
const authMeKey = getQueryKey(trpc.auth.me);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createAppQueryClient: which failures prompt a session check", () => {
  const failQuery = (client: ReturnType<typeof createAppQueryClient>, key: unknown[], error: unknown) =>
    client.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(error), retry: false }).catch(() => undefined);
  /** Lets a check that waits for the session lock (a 401's) run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  beforeEach(() => outageClock.reset());
  afterEach(() => outageClock.reset());

  it("a 503 or no answer from another request re-checks the session, without cancelling a check under way", async () => {
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    await failQuery(client, [["graph", "stats"], { type: "query" }], err("SERVICE_UNAVAILABLE"));
    expect(spy).toHaveBeenCalledWith({ queryKey: authMeKey }, { cancelRefetch: false });
  });

  it("a 401 anywhere re-checks the session too; a plain bad request does not", async () => {
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    await failQuery(client, [["graph", "stats"], { type: "query" }], err("BAD_REQUEST"));
    expect(spy).not.toHaveBeenCalled();
    await failQuery(client, [["graph", "stats"], { type: "query" }], err("UNAUTHORIZED"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("B1: re-checks at most once per five seconds however many requests fail", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    for (let i = 0; i < 10; i++) await failQuery(client, [["graph", "stats"], { type: "query" }, i], err("UNAUTHORIZED"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SESSION_OUTAGE_RECHECK_MS + 1);
    await failQuery(client, [["graph", "stats"], { type: "query" }, "later"], err("UNAUTHORIZED"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("B1: measures the five seconds on the monotonic clock, so a system clock change neither stops nor floods re-checks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    await failQuery(client, [["graph", "stats"], { type: "query" }, 1], err("UNAUTHORIZED"));
    vi.setSystemTime(Date.now() + 3_600_000);
    await failQuery(client, [["graph", "stats"], { type: "query" }, 2], err("UNAUTHORIZED"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() - 7_200_000);
    vi.advanceTimersByTime(SESSION_OUTAGE_RECHECK_MS + 1);
    await failQuery(client, [["graph", "stats"], { type: "query" }, 3], err("UNAUTHORIZED"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("B1: once the outage clock is running, outages elsewhere add no checks, but 'not signed in' still does", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    outageClock.observe({ ok: false, error: err("SERVICE_UNAVAILABLE") });
    for (let i = 0; i < 5; i++) {
      await failQuery(client, [["graph", "stats"], { type: "query" }, i], err("SERVICE_UNAVAILABLE"));
      vi.advanceTimersByTime(SESSION_OUTAGE_RECHECK_MS + 1);
    }
    expect(spy).not.toHaveBeenCalled();
    await failQuery(client, [["graph", "stats"], { type: "query" }, "401"], err("UNAUTHORIZED"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("I5: a check prompted by 'not signed in' waits for a sign-in in flight, and only one waits", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    let release!: () => void;
    const signIn = withSessionLock(() => new Promise<void>((resolve) => (release = resolve)));
    await settle();
    await failQuery(client, [["graph", "stats"], { type: "query" }, 1], err("UNAUTHORIZED"));
    await settle();
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SESSION_OUTAGE_RECHECK_MS + 1);
    await failQuery(client, [["graph", "stats"], { type: "query" }, 2], err("UNAUTHORIZED"));
    await settle();
    expect(spy).not.toHaveBeenCalled();
    release();
    await signIn;
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not re-check on the session check's own failure, which feeds the outage clock instead", async () => {
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    await failQuery(client, [...authMeKey, { type: "query" }], err("SERVICE_UNAVAILABLE"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("failed mutations count as well", async () => {
    const client = createAppQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const m = new MutationObserver(client, { mutationFn: () => Promise.reject(err("SERVICE_UNAVAILABLE")) });
    await m.mutate().catch(() => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithTimeout", () => {
  it("B3: gives up after the timeout, and sends the session cookie", async () => {
    vi.useFakeTimers();
    let seen: RequestInit | undefined;
    vi.stubGlobal("fetch", (_: unknown, init: RequestInit) => {
      seen = init;
      return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    });
    const p = fetchWithTimeout(SESSION_CALL_TIMEOUT_MS)("/api/trpc/auth.me");
    const settled = expect(p).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(SESSION_CALL_TIMEOUT_MS);
    await settled;
    expect(seen?.credentials).toBe("include");
  });

  it("U5: gives up on a body that stalls after the headers arrive, not only on headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async (_: unknown, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"result":'));
          init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const p = fetchWithTimeout(SESSION_CALL_TIMEOUT_MS)("/api/trpc/auth.me").then((r) => r.text());
    const settled = expect(p).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(SESSION_CALL_TIMEOUT_MS);
    await settled;
  });

  it("keeps the answer's status, headers and body once buffered, and gives an answer that may have no body none", async () => {
    vi.stubGlobal("fetch", async (input: unknown) =>
      String(input).includes("empty")
        ? new Response(null, { status: 204, statusText: "No Content", headers: { "x-ontos": "1" } })
        : new Response('{"error":"Please sign in"}', { status: 401, statusText: "Unauthorized", headers: { "content-type": "application/json" } }),
    );
    const refused = await fetchWithTimeout(1_000)("/api/trpc/auth.me");
    expect([refused.status, refused.statusText, refused.headers.get("content-type")]).toEqual([401, "Unauthorized", "application/json"]);
    await expect(refused.text()).resolves.toBe('{"error":"Please sign in"}');
    const empty = await fetchWithTimeout(1_000)("/empty");
    expect([empty.status, empty.headers.get("x-ontos"), empty.body]).toEqual([204, "1", null]);
  });

  it("passes the caller's abort through, and answers normally when the server does", async () => {
    vi.stubGlobal("fetch", (_: unknown, init: RequestInit) =>
      new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        if (!String(_).includes("hang")) resolve(new Response("ok"));
      }),
    );
    await expect(fetchWithTimeout(1_000)("/fast").then((r) => r.text())).resolves.toBe("ok");
    const outer = new AbortController();
    const p = fetchWithTimeout(60_000)("/hang", { signal: outer.signal });
    outer.abort(new Error("navigated away"));
    await expect(p).rejects.toThrow("navigated away");
  });
});

describe("createAppTrpcClient: session calls travel alone", () => {
  it("sends auth.me unbatched through the timed link, and other queries batched", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("batch=1") ? [{ result: { data: { json: null } } }] : { result: { data: { json: null } } };
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
    const client = createAppTrpcClient();
    await client.auth.me.query();
    await client.graph.stats.query();
    expect(urls.find((u) => u.includes("auth.me"))).not.toContain("batch=1");
    expect(urls.find((u) => u.includes("graph.stats"))).toContain("batch=1");
  });

  it("B3, B4: sign-ins and sign-outs take the timed link too, so none can hold the session lock for long", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    });
    const client = createAppTrpcClient();
    const calls = [
      client.auth.demoLogin.mutate({ role: "admin" }),
      client.auth.login.mutate({ email: "a@b.co", password: "x" }),
      client.auth.logout.mutate(),
    ].map((p) => p.then(() => "answered", () => "gave up"));
    await vi.advanceTimersByTimeAsync(SESSION_CALL_TIMEOUT_MS);
    await expect(Promise.all(calls)).resolves.toEqual(["gave up", "gave up", "gave up"]);
    expect(urls.every((u) => !u.includes("batch=1"))).toBe(true);
    expect(SESSION_PATHS).toEqual(new Set(["auth.me", "auth.logout", "auth.login", "auth.demoLogin"]));
  });
});

describe("SessionSignOutCompleter", () => {
  const server = { logoutCalls: 0, down: false, slowMs: 0, session: true };
  const link: TRPCLink<AppRouter> = () => ({ op }) =>
    observable((observer) => {
      if (op.path === "auth.logout") server.logoutCalls++;
      const answer = () => {
        if (server.down) return observer.error(err("SERVICE_UNAVAILABLE"));
        if (op.path === "auth.logout") {
          if (!server.session) return observer.error(err("UNAUTHORIZED"));
          server.session = false;
        }
        observer.next({ result: { type: "data", data: { success: true } } } as never);
        observer.complete();
      };
      const t = setTimeout(answer, server.slowMs);
      return () => clearTimeout(t);
    });

  const mount = () => {
    const queryClient = createAppQueryClient();
    const client = createAppTrpcClient([link]);
    render(
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <SessionSignOutCompleter />
        </QueryClientProvider>
      </trpc.Provider>,
    );
    return queryClient;
  };
  const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    Object.assign(server, { logoutCalls: 0, down: false, slowMs: 0, session: true });
    pendingSignOut.clear();
    outageClock.reset();
    resetOutageExpiry();
  });
  afterEach(async () => {
    cleanup();
    await vi.advanceTimersByTimeAsync(SESSION_LOCK_MAX_HOLD_MS + 1);
    pendingSignOut.clear();
  });

  it("does nothing while no sign-out is pending", async () => {
    mount();
    await advance(60_000);
    expect(server.logoutCalls).toBe(0);
  });

  it("ends the server session once and clears the pending sign-out", async () => {
    pendingSignOut.set();
    mount();
    await advance(100);
    expect(server.logoutCalls).toBe(1);
    expect(server.session).toBe(false);
    expect(pendingSignOut.get()).toBe(false);
    await advance(60_000);
    expect(server.logoutCalls).toBe(1);
  });

  it("treats 'not signed in' as already ended", async () => {
    server.session = false;
    pendingSignOut.set();
    mount();
    await advance(100);
    expect(pendingSignOut.get()).toBe(false);
  });

  it("B2: tries once per 15 s while the server is down, never two at once", async () => {
    server.down = true;
    server.slowMs = 20_000;
    pendingSignOut.set();
    mount();
    await advance(60_000);
    // 20 s answers and a 15 s cadence: attempts at 0, ~20 (next tick after), ~40 s.
    expect(server.logoutCalls).toBeLessThanOrEqual(3);
    expect(pendingSignOut.get()).toBe(true);
  });

  it("I5: a sign-out queued behind another tab's sign-in does not run once that sign-in has cleared the flag", async () => {
    pendingSignOut.set();
    // Another tab's sign-in holds the session lock (the in-tab lock stands in for the Web Lock here).
    let release!: () => void;
    const signIn = withSessionLock(() => new Promise<void>((resolve) => (release = resolve)));
    mount();
    await advance(100);
    expect(server.logoutCalls).toBe(0);
    // That sign-in clears the shared flag; its storage event has not reached this tab yet.
    window.localStorage.removeItem("ontos:pending-sign-out");
    document.cookie = "ontos_pending_signout=; Path=/; Max-Age=0";
    release();
    await signIn;
    await advance(100);
    expect(server.logoutCalls).toBe(0);
    expect(server.session).toBe(true);
  });

  it("I4: when another tab ends the sign-out, forgets the old session here before anything renders", async () => {
    server.down = true;
    pendingSignOut.set();
    const queryClient = mount();
    const key = [...getQueryKey(trpc.auth.me), { type: "query" }];
    outageClock.observe({ ok: false, error: err("SERVICE_UNAVAILABLE") }, 1);
    queryClient.setQueryData(key, { id: 1, name: "Old User" });
    // Another tab signs in: the flag disappears from storage and an event arrives.
    window.localStorage.removeItem("ontos:pending-sign-out");
    document.cookie = "ontos_pending_signout=; Path=/; Max-Age=0";
    // No act(): the listener itself must have forgotten it, not a later effect.
    window.dispatchEvent(new StorageEvent("storage", { key: "ontos:pending-sign-out" }));
    expect(outageClock.get()).toBeNull();
    expect(queryClient.getQueryCache().find({ queryKey: key })).toBeUndefined();
  });

  it("I4: keeps the session's check while the sign-out stays pending, and on unrelated events", async () => {
    pendingSignOut.set();
    server.down = true;
    const queryClient = mount();
    const key = [...getQueryKey(trpc.auth.me), { type: "query" }];
    queryClient.setQueryData(key, { id: 1, name: "User" });
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new StorageEvent("storage", { key: "ontos:pending-sign-out" }));
    expect(queryClient.getQueryData(key)).toEqual({ id: 1, name: "User" });
  });
});
