import os from "node:os";
import { lockName, withNamedLock, type LockConnection } from "../lib/namedLock";
import type { EngineLock } from "./semanticEngine";

/**
 * How long an engine task waits for other processes' before giving up. A
 * worker's SHACL check holds the engine for under a minute, so this lets a
 * few replicas queue ahead, and is longer than the most one holder can keep
 * it: ENGINE_LOCK_HOLD_MS, then its requests' last timeout and the settling
 * after it (semanticEngine.runTask). Past it, the import is treated as not
 * checked just now: a mapping set to block retries it, and one that warns (the
 * default) imports and records that it was not checked (mappingSync.ts). A
 * job aborted while it waits (its worker stopping, its lease lost) stops
 * waiting at once.
 */
export const ENGINE_LOCK_WAIT_SECONDS = 240;

/** How long an engine task may hold the engine before it is told to stop. */
export const ENGINE_LOCK_HOLD_MS = 120_000;

/**
 * The ways a URL's host (as URL parses it) names this host itself: localhost
 * and its subdomains, with or without the root's dot; 127/8, also mapped into
 * IPv6 (URL writes [::ffff:127.0.0.1] as [::ffff:7f00:1]); ::1; and 0.0.0.0.
 */
const LOOPBACK = /^((.+\.)?localhost\.?|127(\.\d{1,3}){3}|\[::1\]|\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]|0\.0\.0\.0)$/i;

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
 * server's, so without ENGINE_LOCK_KEY the name holds the database too:
 * deployments whose databases share a server never wait for each other. The
 * key names the engine by itself, whatever the database: processes of two
 * databases that share one engine set the same key, and must, or they would
 * clear and load it under each other. (Separate engines that one name reaches
 * on each host, in turn, get a key per host.)
 */
export function engineLockName(databaseUrl: string, engineUrl: string, explicitKey?: string, hostname?: string): string {
  if (explicitKey?.trim()) return lockName("engine", engineIdentity(engineUrl, explicitKey, hostname));
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
