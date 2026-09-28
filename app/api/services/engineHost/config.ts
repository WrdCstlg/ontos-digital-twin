import fs from "node:fs";
import path from "node:path";

/**
 * The engine host's settings, from the environment. Every one has a safe
 * default except the token: without ENGINE_HOST_TOKEN the host refuses to
 * start, unless ENGINE_HOST_DEV=true says this is local development, where it
 * then listens on loopback only.
 */
export type HostConfig = {
  /** Every store lives under here, as ws-<id>. */
  dataDir: string;
  /** Bearer token for every route but /health; null only in dev mode. */
  token: string | null;
  dev: boolean;
  bind: string;
  port: number;
  binPath: string;
  /** Live workspace engines at most; the least recently used idle one makes room. */
  maxEngines: number;
  /** An engine idle this long is stopped. Its store stays on disk. */
  idleMs: number;
  scratchEngines: number;
  /** How long a scratch validation waits for a free scratch engine before 503. */
  scratchWaitMs: number;
  /** A /load body larger than this is refused (413), to protect the disk. */
  loadMaxBytes: number;
  /** A /scratch/validate body larger than this is refused (413); it is held in memory. */
  scratchMaxBytes: number;
  /** An engine must be ready within this, plus more for a large store. */
  startTimeoutMs: number;
  timeouts: RouteTimeouts;
};

export type RouteTimeouts = {
  query: number;
  update: number;
  load: number;
  shacl: number;
  reason: number;
  scratch: number;
};

export class ConfigError extends Error {}

export const MIN_TOKEN_LENGTH = 32;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be a whole number, not "${raw}"`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}, not ${raw}`);
  }
  return value;
}

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw || raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  throw new ConfigError(`${name} must be true or false, not "${env[name]}"`);
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The engine binary: ENGINE_HOST_BIN, else OPEN_ONTOLOGIES_BIN (what CI and
 * local development already set), else the places the README names, else the
 * path the Ontos image installs it to.
 */
export function findEngineBinary(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string | null {
  for (const name of ["ENGINE_HOST_BIN", "OPEN_ONTOLOGIES_BIN"]) {
    const value = env[name]?.trim();
    if (value) {
      if (isFile(value)) return path.resolve(value);
      if (name === "ENGINE_HOST_BIN") throw new ConfigError(`ENGINE_HOST_BIN names no file: ${value}`);
    }
  }
  const exe = process.platform === "win32" ? "open-ontologies.exe" : "open-ontologies";
  const candidates = [
    path.resolve(cwd, "bin", exe),
    path.resolve(cwd, "..", "bin", exe),
    path.resolve(cwd, "app", "bin", exe),
    "/usr/local/bin/open-ontologies",
  ];
  return candidates.find(isFile) ?? null;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function readHostConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): HostConfig {
  const dev = flag(env, "ENGINE_HOST_DEV");
  const token = env.ENGINE_HOST_TOKEN?.trim() || null;
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(
      `ENGINE_HOST_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters (e.g. \`openssl rand -hex 32\`)`,
    );
  }
  if (!token && !dev) {
    throw new ConfigError(
      "Set ENGINE_HOST_TOKEN (e.g. `openssl rand -hex 32`), or ENGINE_HOST_DEV=true for local development without one",
    );
  }
  const bind = env.ENGINE_HOST_BIND?.trim() || "127.0.0.1";
  if (!token && !isLoopback(bind)) {
    throw new ConfigError(`Without ENGINE_HOST_TOKEN the host listens on loopback only, not on ${bind}`);
  }

  const binPath = findEngineBinary(env, cwd);
  if (!binPath) {
    throw new ConfigError(
      "No open-ontologies binary found: set ENGINE_HOST_BIN (or OPEN_ONTOLOGIES_BIN), or place it at bin/open-ontologies",
    );
  }

  const dataDir = path.resolve(cwd, env.ENGINE_HOST_DATA_DIR?.trim() || ".ontos-engines");

  return {
    dataDir,
    token,
    dev,
    bind,
    port: integer(env, "ENGINE_HOST_PORT", 8086, 1, 65535),
    binPath,
    maxEngines: integer(env, "ENGINE_HOST_MAX_ENGINES", 16, 1, 1024),
    idleMs: integer(env, "ENGINE_HOST_IDLE_MS", 10 * MINUTE, SECOND, 7 * 24 * HOUR),
    scratchEngines: integer(env, "ENGINE_HOST_SCRATCH_ENGINES", 2, 1, 32),
    scratchWaitMs: integer(env, "ENGINE_HOST_SCRATCH_WAIT_MS", 10 * SECOND, 0, 10 * MINUTE),
    loadMaxBytes: integer(env, "ENGINE_HOST_LOAD_MAX_BYTES", 2 * GIB, 1, 64 * GIB),
    scratchMaxBytes: integer(env, "ENGINE_HOST_SCRATCH_MAX_BYTES", 64 * MIB, 1, GIB),
    startTimeoutMs: integer(env, "ENGINE_HOST_START_TIMEOUT_MS", 10 * SECOND, SECOND, HOUR),
    timeouts: {
      query: integer(env, "ENGINE_HOST_QUERY_TIMEOUT_MS", 30 * SECOND, 100, 24 * HOUR),
      update: integer(env, "ENGINE_HOST_UPDATE_TIMEOUT_MS", 60 * SECOND, 100, 24 * HOUR),
      load: integer(env, "ENGINE_HOST_LOAD_TIMEOUT_MS", 10 * MINUTE, 100, 24 * HOUR),
      shacl: integer(env, "ENGINE_HOST_SHACL_TIMEOUT_MS", 5 * MINUTE, 100, 24 * HOUR),
      reason: integer(env, "ENGINE_HOST_REASON_TIMEOUT_MS", 5 * MINUTE, 100, 24 * HOUR),
      scratch: integer(env, "ENGINE_HOST_SCRATCH_TIMEOUT_MS", 2 * MINUTE, 100, 24 * HOUR),
    },
  };
}
