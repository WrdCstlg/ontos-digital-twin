import { trpc } from "@/providers/trpc";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { LOGIN_PATH } from "@/const";
import {
  announcePendingChange,
  claimOutageExpiry,
  isSignedOutError,
  monotonicNow,
  outageClock,
  pendingSignOut,
  SESSION_FIRST_RECHECK_MS,
  SESSION_GRACE_MS,
  SESSION_HEALTHY_RECHECK_MS,
  SESSION_RECHECK_MS,
  sessionState,
  subscribePending,
  withSessionLock,
} from "@/lib/sessionGrace";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

/**
 * Who is signed in. "Not signed in" from the server signs the user out at
 * once. A session the server could not check (an outage) keeps the user
 * signed in, checking again every 15 seconds; a check that still fails three
 * minutes after the first failed one signs them out, and the app keeps them
 * signed out until the server has ended the session or they sign in again
 * (lib/sessionGrace.ts; SessionSignOutCompleter ends the server session).
 */
export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = LOGIN_PATH } =
    options ?? {};

  const navigate = useNavigate();

  const utils = trpc.useUtils();

  const pending = useSyncExternalStore(subscribePending, pendingSignOut.get, () => false);

  const query = trpc.auth.me.useQuery(undefined, {
    initialData: () => {
      try {
        if (typeof window === "undefined") return undefined;
        if (pendingSignOut.get()) return undefined;
        const stored = window.localStorage.getItem("ontos:active-persona");
        return stored ? JSON.parse(stored) : undefined;
      } catch {
        return undefined;
      }
    },
    // The remembered persona opens the page at once, but it is only a guess:
    // counting it as already stale has the session checked on load.
    initialDataUpdatedAt: 0,
    staleTime: SESSION_HEALTHY_RECHECK_MS,
    // Count an unreachable server as a failed check rather than pausing.
    networkMode: "always",
    // No retries: the regular re-check is the retry. react-query pauses a
    // retry whose tab is hidden when its delay ends, and a paused check never
    // settles, so a hidden tab would stop gathering evidence (B1).
    retry: false,
    // While the session cannot be checked, check again every 15 s (every 5 s
    // while no user is known yet), in a background tab too; while it is
    // healthy, once a minute, so a quiet page still notices an outage.
    refetchInterval: (q) =>
      q.state.status === "error"
        ? isSignedOutError(q.state.error)
          ? false
          : q.state.data === undefined
            ? SESSION_FIRST_RECHECK_MS
            : SESSION_RECHECK_MS
        : q.state.status === "success"
          ? SESSION_HEALTHY_RECHECK_MS
          : false,
    refetchIntervalInBackground: true,
    // The cadence above is the whole budget (B1): focus and reconnect add none.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data: user, error, refetch, status, fetchStatus } = query;

  // The outage clock is fed by the query cache as each check settles
  // (providers/trpc.tsx), not from here: a part of the page that mounts later
  // adds no evidence, and the remembered persona, which is no check, ends no
  // outage, so a reload still resumes the one the tab was in.
  const outage = useSyncExternalStore(outageClock.subscribe, outageClock.get, outageClock.get);
  const since = outage?.since ?? null;

  // Check once more when the grace period runs out, so a still-failing check
  // at that moment is the evidence. Armed once per outage, only while the
  // deadline is ahead; after it the 15 s re-check carries on.
  useEffect(() => {
    if (since === null || pending) return;
    const wait = since + SESSION_GRACE_MS - monotonicNow();
    if (wait <= 0) return;
    const timer = setTimeout(() => void refetch({ cancelRefetch: false }), wait + 250);
    return () => clearTimeout(timer);
  }, [since, pending, refetch]);

  const state = pending
    ? ({ kind: "signed-out", reason: "outage" } as const)
    : sessionState({ status, hasUser: !!user, error, outage, paused: fetchStatus === "paused" });

  // The grace period ran out: sign out in every tab, once per outage, and have
  // the server end the session as soon as it answers (SessionSignOutCompleter).
  const graceExpired = !pending && state.kind === "signed-out" && state.reason === "outage";
  useEffect(() => {
    if (!graceExpired || since === null || !claimOutageExpiry(since)) return;
    // The remembered persona would otherwise come back as signed in once the
    // sign-out is no longer pending.
    try {
      window.localStorage.removeItem("ontos:active-persona");
    } catch {
      // storage unavailable: nothing to forget
    }
    pendingSignOut.set();
    announcePendingChange();
  }, [graceExpired, since]);

  const logoutMutation = trpc.auth.logout.useMutation({
    // Offline, fail at once rather than wait to run later, outside the lock (B5).
    networkMode: "always",
    onSuccess: () => {
      try {
        window.localStorage.removeItem("ontos:active-persona");
      } catch {
        // storage unavailable: nothing to forget
      }
      pendingSignOut.clear();
      outageClock.reset();
      announcePendingChange();
      // Not awaited: the sign-out holds the session lock until this returns,
      // and a page's queries refreshing is no reason to hold a sign-in back (B4).
      void utils.invalidate();
      navigate(redirectPath);
    },
  });

  const logout = useCallback(() => {
    try {
      window.localStorage.removeItem("ontos:active-persona");
    } catch {
      // storage unavailable: nothing to forget
    }
    // Under the session lock, so a sign-in that follows cannot be undone by it.
    void withSessionLock(() => logoutMutation.mutateAsync()).catch(() => undefined);
  }, [logoutMutation]);

  // The server says there is no session: the remembered persona is stale.
  const noSession = state.kind === "signed-out" && state.reason === "no-session";
  useEffect(() => {
    if (!noSession) return;
    try {
      window.localStorage.removeItem("ontos:active-persona");
    } catch {
      // storage unavailable: nothing to forget
    }
  }, [noSession]);

  const signedIn = state.kind === "signed-in";
  const checking = state.kind === "checking";
  const reconnecting = (state.kind === "signed-in" && state.degraded) || (state.kind === "checking" && state.unreachable);
  const signedOutBecause = state.kind === "signed-out" ? state.reason : null;

  useEffect(() => {
    if (redirectOnUnauthenticated && !checking && !signedIn) {
      const currentPath = window.location.pathname;
      if (currentPath !== redirectPath) {
        navigate(redirectPath);
      }
    }
  }, [redirectOnUnauthenticated, checking, signedIn, navigate, redirectPath]);

  return useMemo(
    () => ({
      user: signedIn ? (user ?? null) : null,
      isAuthenticated: signedIn,
      /** Still finding out; true while a first check runs or cannot be made within the grace period. */
      isLoading: checking || logoutMutation.isPending,
      /** The session could not be checked just now; the user stays signed in for the grace period. */
      isReconnecting: reconnecting,
      /** Why the user is signed out, when they are. */
      signedOutBecause,
      error,
      logout,
      refresh: refetch,
    }),
    [signedIn, user, checking, logoutMutation.isPending, reconnecting, signedOutBecause, error, logout, refetch],
  );
}
