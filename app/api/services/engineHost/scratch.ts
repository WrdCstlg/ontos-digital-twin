import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { systemClock, type Clock } from "./clock";
import { HostError, message, shuttingDown, unavailable } from "./errors";
import {
  describeExit,
  freeLoopbackPort,
  lastLines,
  probeEngineHealth,
  terminate,
  waitReady,
  type LifecycleDeps,
} from "./lifecycle";
import type { EngineLauncher, EngineProcess } from "./process";

/**
 * In-memory engines for what-if SHACL checks: data that is in no workspace's
 * store yet (an import's rows, an action's result). A persistent store cannot
 * hold it apart from the real data, since SHACL sees every graph.
 *
 * Each scratch engine serves one request at a time. Requests wait their turn
 * in a bounded queue, for a bounded time, and are otherwise refused (503). A
 * scratch engine that failed mid-request is replaced rather than trusted to be
 * empty: a new in-memory engine is empty by construction.
 */

const MAX_WAITERS = 64;

export type ScratchLease = {
  readonly label: string;
  readonly port: number;
  readonly token: string;
  /** Replaces this engine: it may hold data it could not be made to drop. */
  discard(): Promise<void>;
};

type ScratchEngine = {
  label: string;
  proc: EngineProcess | null;
  port: number;
  token: string;
  /** Its data directory, in the OS temp directory: memory mode keeps no store, only the engine's state database. */
  dir: string | null;
  busy: boolean;
};

type Waiter = { resolve: (e: ScratchEngine) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

export type ScratchPoolOptions = {
  size: number;
  waitMs: number;
  startTimeoutMs: number;
  launcher: EngineLauncher;
  clock?: Clock;
  probeHealth?: (port: number, signal: AbortSignal) => Promise<boolean>;
  freePort?: () => Promise<number>;
  log?: (line: string) => void;
};

export class ScratchPool {
  private readonly engines: ScratchEngine[];
  private readonly waiting: Waiter[] = [];
  private readonly deps: LifecycleDeps;
  private readonly freePort: () => Promise<number>;
  private closing = false;

  constructor(private readonly opts: ScratchPoolOptions) {
    this.engines = Array.from({ length: opts.size }, (_, i) => ({
      label: `scratch-${i}`,
      proc: null,
      port: 0,
      token: "",
      dir: null,
      busy: false,
    }));
    const log = opts.log ?? ((line: string) => console.log(`[engine-host] ${line}`));
    this.deps = { clock: opts.clock ?? systemClock, probeHealth: opts.probeHealth ?? probeEngineHealth, log };
    this.freePort = opts.freePort ?? freeLoopbackPort;
  }

  /** Scratch engines free right now, and requests waiting for one. */
  stats(): { size: number; free: number; waiting: number } {
    return { size: this.engines.length, free: this.engines.filter((e) => !e.busy).length, waiting: this.waiting.length };
  }

  /** Runs `work` with a scratch engine to itself. */
  async use<T>(work: (lease: ScratchLease) => Promise<T>): Promise<T> {
    const engine = await this.take();
    try {
      await this.ensureRunning(engine);
      return await work({
        label: engine.label,
        port: engine.port,
        token: engine.token,
        discard: () => this.stop(engine),
      });
    } finally {
      this.give(engine);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const w of this.waiting.splice(0)) {
      clearTimeout(w.timer);
      w.reject(shuttingDown());
    }
    await Promise.all(this.engines.map((e) => this.stop(e)));
  }

  private take(): Promise<ScratchEngine> {
    if (this.closing) return Promise.reject(shuttingDown());
    const free = this.engines.find((e) => !e.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    if (this.waiting.length >= MAX_WAITERS || this.opts.waitMs <= 0) return Promise.reject(this.busyError());
    return new Promise<ScratchEngine>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = this.waiting.indexOf(waiter);
          if (i >= 0) this.waiting.splice(i, 1);
          reject(this.busyError());
        }, this.opts.waitMs),
      };
      this.waiting.push(waiter);
    });
  }

  /** Hands the engine to the next waiter, who finds it still marked busy, or frees it. */
  private give(engine: ScratchEngine): void {
    const next = this.waiting.shift();
    if (next && !this.closing) {
      clearTimeout(next.timer);
      next.resolve(engine);
      return;
    }
    engine.busy = false;
  }

  private busyError(): HostError {
    return new HostError(
      503,
      "scratch_busy",
      `All ${this.engines.length} scratch engines are busy; try again shortly.`,
      { retryAfterMs: 1000 },
    );
  }

  private async ensureRunning(engine: ScratchEngine): Promise<void> {
    if (engine.proc && !engine.proc.exit()) return;
    await this.stop(engine);
    if (this.closing) throw shuttingDown();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ontos-scratch-"));
    engine.dir = dir;
    let port: number;
    try {
      port = await this.freePort();
    } catch (err) {
      throw unavailable(`No free port for a scratch engine: ${message(err)}`);
    }
    // close() may have run meanwhile; it cannot stop an engine started after it.
    if (this.closing) {
      await this.stop(engine);
      throw shuttingDown();
    }
    const token = randomBytes(24).toString("hex");
    const proc = this.opts.launcher.launch({ label: engine.label, dataDir: dir, port, mode: "memory", token });
    engine.proc = proc;
    engine.port = port;
    engine.token = token;
    const result = await waitReady(proc, port, this.opts.startTimeoutMs, this.deps);
    if (result === "ready" && !this.closing) return;
    await this.stop(engine);
    if (this.closing) throw shuttingDown();
    const why =
      result === "timeout"
        ? `not ready within ${this.opts.startTimeoutMs} ms`
        : `exited (${describeExit(proc.exit() ?? { code: null, signal: null })}): ${lastLines(proc.output())}`;
    throw unavailable(`A scratch engine could not start: ${why}`);
  }

  /** A scratch engine holds nothing worth a graceful stop: it is killed. */
  private async stop(engine: ScratchEngine): Promise<void> {
    const proc = engine.proc;
    engine.proc = null;
    if (proc) await terminate(proc, this.deps, { force: true });
    if (engine.dir) {
      const dir = engine.dir;
      engine.dir = null;
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }
}
