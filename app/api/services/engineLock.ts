import os from "node:os";
import { lockName, withNamedLock, type LockConnection } from "../lib/namedLock";
import type { EngineLock } from "./semanticEngine";

/**
 * How long an engine task waits for other processes' before giving up. A
 * worker's SHACL check holds the engine for under a minute, so this lets a
 * few replicas queue ahead. Past it, the import is treated as not checked just
 * now: a mapping set to block retries it, and one that warns (the default)
 * imports and records that it was not checked (mappingSync.ts). A job aborted
 * while it waits (its worker stopping, its lease lost) stops waiting at once.
 */
export const ENGINE_LOCK_WAIT_SECONDS = 180;

/** How long an engine task may hold the engine before it is told to stop. */
export const ENGINE_LOCK_HOLD_MS = 120_000;

/** The ways a URL names this host itself. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i;

/**
 * Which engine a URL reaches, for telling processes that share one from those
 * that do not. ENGINE_LOCK_KEY, when set, names it outright: processes that
 * reach one engine by different URLs (a name and an address, say) set the
 * same key. Otherwise the URL, normalised. An engine on loopback is this
 * host's own, however the URL spells loopback, so it is named by the host.
 */
export function engineIdentity(engineUrl: string, explicitKey?: string, hostname = os.hostname()): string {
  const key = explicitKey?.trim();
  if (key) return `key ${key}`;
  const u = new URL(engineUrl);
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const path = u.pathname.replace(/\/+$/, "");
  return LOOPBACK.test(u.hostname)
    ? `${u.protocol}//loopback:${port}${path} on ${hostname.toLowerCase()}`
    : `${u.protocol}//${u.hostname}:${port}${path}`;
}

/**
 * The lock the processes sharing an engine take. MySQL lock names are the
 * server's, so the name holds the database too: deployments whose databases
 * share a server never wait for each other.
 */
export function engineLockName(databaseUrl: string, engineUrl: string, explicitKey?: string, hostname?: string): string {
  let database = databaseUrl;
  try {
    database = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    // Not a URL: the whole string stands for the database.
  }
  return lockName("engine", `${database}\n${engineIdentity(engineUrl, explicitKey, hostname)}`);
}

/**
 * Makes every exclusive() task of `engine` take MySQL's named lock `name`
 * first, as every other process given the same name does: the processes that
 * share one engine then use it one task at a time (semanticEngine.shareWith).
 */
export function installEngineLock(
  engine: { shareWith(lock: EngineLock | null): void },
  opts: { connect: () => Promise<LockConnection>; name: string; waitSeconds?: number; holdMs?: number },
): void {
  const waitSeconds = opts.waitSeconds ?? ENGINE_LOCK_WAIT_SECONDS;
  const holdMs = opts.holdMs ?? ENGINE_LOCK_HOLD_MS;
  engine.shareWith((task, signal) => withNamedLock(opts.connect, opts.name, { waitSeconds, holdMs, signal }, task));
}
