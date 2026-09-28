import net from "node:net";
import type { Clock } from "./clock";
import { httpRequest } from "./engineHttp";
import type { EngineExit, EngineProcess } from "./process";

/** Starting and stopping one engine process: shared by workspace and scratch engines. */

const STOP_GRACE_MS = 5_000;
const KILL_WAIT_MS = 5_000;
const HEALTH_POLL_MS = 25;

export type LifecycleDeps = {
  clock: Clock;
  probeHealth: (port: number, signal: AbortSignal) => Promise<boolean>;
  log: (line: string) => void;
};

/** A port the OS just gave out on loopback. Another process may take it first; the engine then says so. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
    });
  });
}

export async function probeEngineHealth(port: number, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await httpRequest({ method: "GET", url: `http://127.0.0.1:${port}/health`, timeoutMs: 1000, signal });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Ready once the process printed that it listens on `port` and /health
 * answers there; bounded by `timeoutMs`.
 */
export async function waitReady(
  proc: EngineProcess,
  port: number,
  timeoutMs: number,
  deps: Pick<LifecycleDeps, "clock" | "probeHealth">,
): Promise<"ready" | "exited" | "timeout"> {
  const stop = new AbortController();
  const poll = async (): Promise<"ready" | "exited" | "timeout"> => {
    while (!stop.signal.aborted && !proc.exit()) {
      if (await deps.probeHealth(port, stop.signal).catch(() => false)) return "ready";
      await deps.clock.sleep(HEALTH_POLL_MS, stop.signal);
    }
    return proc.exit() ? "exited" : "timeout";
  };
  try {
    return await Promise.race([
      proc.listening.then(poll),
      proc.exited.then(() => "exited" as const),
      deps.clock.sleep(timeoutMs, stop.signal).then(() => "timeout" as const),
    ]);
  } finally {
    stop.abort();
  }
}

async function exitsWithin(proc: EngineProcess, ms: number, clock: Clock): Promise<boolean> {
  const stop = new AbortController();
  try {
    return await Promise.race([proc.exited.then(() => true), clock.sleep(ms, stop.signal).then(() => false)]);
  } finally {
    stop.abort();
  }
}

/**
 * SIGTERM, which on Linux lets the engine close RocksDB cleanly, then SIGKILL;
 * each bounded. (On Windows both end the process at once; the store survives
 * that too.) `force` goes straight to SIGKILL: an engine stuck in a request
 * would not finish a graceful shutdown, which waits for that request.
 */
export async function terminate(
  proc: EngineProcess,
  deps: Pick<LifecycleDeps, "clock" | "log">,
  opts: { force?: boolean } = {},
): Promise<void> {
  if (proc.exit()) return;
  if (!opts.force) {
    proc.signal("SIGTERM");
    if (await exitsWithin(proc, STOP_GRACE_MS, deps.clock)) return;
  }
  proc.signal("SIGKILL");
  if (await exitsWithin(proc, KILL_WAIT_MS, deps.clock)) return;
  deps.log(`engine pid ${proc.pid} did not exit after SIGKILL`);
}

export function describeExit(exit: EngineExit): string {
  if (exit.spawnError) return exit.spawnError;
  return exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
}

export function lastLines(output: string, n = 3): string {
  const lines = output.split("\n").filter((l) => l.trim());
  return lines.slice(-n).join(" | ") || "(no output)";
}
