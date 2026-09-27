import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink, type TRPCLink } from "@trpc/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  announcePendingChange,
  isOutageError,
  isSignedOutError,
  monotonicNow,
  outageClock,
  pendingSignOut,
  SESSION_CALL_TIMEOUT_MS,
  SESSION_EPOCH_KEY,
  SESSION_OUTAGE_RECHECK_MS,
  SESSION_RECHECK_MS,
  sessionEpoch,
  subscribePending,
  withSessionLock,
} from "@/lib/sessionGrace";

export const trpc = createTRPCReact<AppRouter>();

export { SESSION_CALL_TIMEOUT_MS };

function isAuthMe(key: readonly unknown[]): boolean {
  return JSON.stringify(key[0]) === JSON.stringify(getQueryKey(trpc.auth.me)[0]);
}

/**
 * The app's query client. A request that meets an outage (a 503, or no answer)
 * or is told "not signed in" has the session checked again, at most every few
 * seconds, so an open page notices either while its last check is fresh. A
 * check already under way is left to finish rather than restarted. Once the
 * outage clock is running, the session check's own 15 s cadence carries on and
 * further outages elsewhere add no checks.
 *
 * The session check's own results are the outage clock's evidence. The cache
 * reports each once, as it settles, whether or not any part of the page is
 * showing the session; a part of the page that opens later adds nothing (U1).
 */
export function createAppQueryClient(): QueryClient {
  const authMeKey = getQueryKey(trpc.auth.me);
  let lastRecheck = -Infinity;
  let waitingForLock = false;
  const recheck = (err: unknown) => {
    if (!isOutageError(err) && !isSignedOutError(err)) return;
    if (isOutageError(err) && outageClock.get() !== null) return;
    const now = monotonicNow();
    if (now - lastRecheck < SESSION_OUTAGE_RECHECK_MS) return;
    lastRecheck = now;
    const check = () => client.invalidateQueries({ queryKey: authMeKey }, { cancelRefetch: false });
    if (!isSignedOutError(err)) return void check();
    // "Not signed in" may only mean a sign-in has not set its cookie yet: check
    // once any sign-in or sign-out in flight has finished (I5), one waiting at most.
    if (waitingForLock) return;
    waitingForLock = true;
    void withSessionLock(check)
      .catch(() => undefined)
      .finally(() => {
        waitingForLock = false;
      });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (isAuthMe(query.queryKey)) return void outageClock.observe({ ok: false, error: err });
        recheck(err);
      },
      onSuccess: (_data, query) => {
        if (isAuthMe(query.queryKey)) outageClock.observe({ ok: true });
      },
    }),
    mutationCache: new MutationCache({ onError: (err) => recheck(err) }),
  });
  return client;
}

/**
 * A fetch that gives up after `ms`, as well as when the caller aborts. The
 * body is read under the same deadline: headers that arrive with a body that
 * never finishes are no answer (B3). Session answers are small, so buffering
 * them costs nothing.
 */
export function fetchWithTimeout(ms: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("The session check timed out", "TimeoutError")), ms);
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
    }
    try {
      const res = await globalThis.fetch(input, { ...(init ?? {}), credentials: "include", signal: controller.signal });
      const body = await res.arrayBuffer();
      const noBody = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(noBody ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Session calls: checked often, and never left hanging, so a silent server
 * counts as an outage and no sign-in or sign-out holds the session lock for
 * long (lib/sessionGrace.ts, B3 and B4).
 */
export const SESSION_PATHS: ReadonlySet<string> = new Set(["auth.me", "auth.logout", "auth.login", "auth.demoLogin"]);

export function createAppTrpcClient(links?: TRPCLink<AppRouter>[]) {
  return trpc.createClient({
    links: links ?? [
      splitLink({
        condition: (op) => SESSION_PATHS.has(op.path),
        true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: fetchWithTimeout(SESSION_CALL_TIMEOUT_MS) }),
        false: httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          /**
           * Batched queries travel as a GET query string, which counts toward the
           * request-header budget. The Twins page fans out one getStateHistory call
           * per twin and was producing ~21KB URLs, past Node's ~16KB header limit —
           * the server answered 431 and the telemetry charts silently stayed empty.
           * tRPC splits a batch that would exceed this into several requests.
           */
          maxURLLength: 8000,
          fetch(input, init) {
            return globalThis.fetch(input, {
              ...(init ?? {}),
              credentials: "include",
            });
          },
        }),
      }),
    ],
  });
}

const queryClient = createAppQueryClient();
const trpcClient = createAppTrpcClient();

/**
 * Ends a sign-out that an outage started: once the server answers, it clears
 * the session cookie. One attempt now and one every 15 seconds while the
 * sign-out is pending, each under the session lock, so none can race a
 * sign-in in any tab. "Not signed in" means the server already holds no
 * session, which also ends it.
 *
 * Whenever the sign-out stops being pending, from this tab or another, the
 * tab forgets the old session: its outage clock and its cached check, so
 * neither can sign out a new session or show the old user as signed in.
 */
export function SessionSignOutCompleter() {
  const pending = useSyncExternalStore(subscribePending, pendingSignOut.get, () => false);
  const client = useQueryClient();
  // Offline, fail at once rather than wait to run later, outside the lock (B5).
  const logout = trpc.auth.logout.useMutation({ retry: false, networkMode: "always" });
  const mutateRef = useRef(logout.mutateAsync);
  useEffect(() => {
    mutateRef.current = logout.mutateAsync;
  });

  // Forget the old session the moment the sign-out stops being pending, in the
  // store listener itself: every useAuth re-renders on the same change, and
  // must find no cached check to show. The check is removed rather than reset,
  // because a reset restores the state it was created with, which may hold the
  // remembered persona; the next render builds a new one and checks afresh.
  useEffect(() => {
    let was = pendingSignOut.get();
    return subscribePending(() => {
      const now = pendingSignOut.get();
      if (was && !now) {
        outageClock.reset();
        client.removeQueries({ queryKey: getQueryKey(trpc.auth.me) });
      }
      was = now;
    });
  }, [client]);

  // A sign-in in any tab starts a new session (sessionEpoch). A tab that was
  // frozen, or restored from the back/forward cache, may have missed the
  // changes above, and would show the old user until its next check. Whenever
  // it sees the epoch has moved (another tab's storage event, or on waking),
  // it forgets the old session's outage and checks the session again.
  useEffect(() => {
    let known = sessionEpoch.get();
    const check = () => {
      const now = sessionEpoch.get();
      if (now === known) return;
      known = now;
      outageClock.reset();
      void client.invalidateQueries({ queryKey: getQueryKey(trpc.auth.me) });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_EPOCH_KEY || e.key === null) check();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [client]);

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let attempting = false;
    const attempt = () => {
      if (stopped || attempting) return;
      attempting = true;
      void withSessionLock(async () => {
        // A sign-in in another tab may have ended it while this waited.
        if (stopped || !pendingSignOut.get()) return;
        try {
          await mutateRef.current();
        } catch (err) {
          if (!isSignedOutError(err)) return;
        }
        pendingSignOut.clear();
        announcePendingChange();
      }).finally(() => {
        attempting = false;
      });
    };
    attempt();
    const id = setInterval(attempt, SESSION_RECHECK_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [pending]);
  return null;
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <SessionSignOutCompleter />
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
