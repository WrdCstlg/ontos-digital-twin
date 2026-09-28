import fs from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { systemClock, type Clock } from "./clock";
import type { DataRoot, StoreMeta } from "./dataRoot";
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
import { McpSessionClient } from "./mcp";
import { classifyEarlyExit, type EngineExit, type EngineLauncher, type EngineProcess } from "./process";
import type { EngineState, WorkspaceEngineStatus } from "./types";

/**
 * One persistent engine per workspace, started on demand and stopped when
 * idle. The policy:
 *
 * - At most `maxEngines` run (or are starting). To start another, the least
 *   recently used idle engine is stopped; when none is idle the start is
 *   refused (503). An engine with a request in flight is never stopped.
 * - An engine idle for `idleMs` is stopped. Its store stays on disk.
 * - An engine is ready once it printed that it listens on its port and its
 *   /health answers. The start timeout grows with the store's last known size.
 * - An engine that exits, or fails to start, starts again on a later request,
 *   after a backoff of 1, 2, 4 … up to 60 s.
 * - A failed start is classified: a store whose RocksDB LOCK another process
 *   holds is `locked`, and the host neither resets nor deletes it; three other
 *   failed opens in a row make it `corrupt`, which only a reset clears.
 * - Start, stop, reset and delete of one workspace take turns (`lock`);
 *   requests do not take it, they count themselves in flight.
 */

export const OPEN_FAILURES_BEFORE_CORRUPT = 3;
export const MAX_BACKOFF_MS = 60_000;
/** Beyond this many requests in flight to one engine, more are refused rather than queued. */
export const MAX_IN_FLIGHT_PER_ENGINE = 64;
/** The start timeout grows by this much per million triples in the store (6 s at 10^6 on a fast host). */
const START_MS_PER_MILLION_TRIPLES = 15_000;
const MAX_START_TIMEOUT_MS = 30 * 60_000;
/** An engine up this long before it exits starts a new failure streak. */
const STABLE_AFTER_MS = 60_000;
const PORT_RETRIES = 3;
/** Workspaces the host remembers (failures, sessions); quiet ones beyond this are forgotten. */
const SLOT_LIMIT = 10_000;

/** 1, 2, 4 … s, then 60 s: the wait before the next start after `failures` failures in a row. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(failures - 1, 16));
}

/** The base, plus time for a large store, doubled for each start in a row that timed out. */
export function startTimeoutMs(baseMs: number, triples: number | null, timeoutsInARow: number): number {
  const scaled = baseMs + Math.ceil(((triples ?? 0) / 1_000_000) * START_MS_PER_MILLION_TRIPLES);
  return Math.min(MAX_START_TIMEOUT_MS, scaled * 2 ** Math.min(timeoutsInARow, 4));
}

/** Runs operations one at a time, in the order they came. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  get busy(): boolean {
    return this.pending > 0;
  }

  run<T>(op: () => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(op);
    this.tail = result.then(
      () => {
        this.pending--;
      },
      () => {
        this.pending--;
      },
    );
    return result;
  }

  /** Resolves once nothing queued before this call is still running. */
  idle(): Promise<void> {
    return this.tail;
  }
}

type Phase = "cold" | "starting" | "ready" | "failed" | "locked" | "corrupt";

type Slot = {
  readonly ws: number;
  readonly dir: string;
  readonly lock: Mutex;
  /** Kept across engine restarts on purpose: a stale session answers 404, and the client opens a new one. */
  readonly mcp: McpSessionClient;
  proc: EngineProcess | null;
  port: number;
  token: string;
  phase: Phase;
  meta: StoreMeta | null;
  inFlight: number;
  /** Requests (and resets) waiting for this engine: it is not stopped for being idle meanwhile. */
  waiters: number;
  busySince: number | null;
  lastUsed: number;
  readyAt: number | null;
  failures: number;
  openFailures: number;
  timeoutsInARow: number;
  retryAt: number | null;
  lastError: string | null;
  stopping: boolean;
  evicting: boolean;
};

type StopReason = "idle" | "evicted" | "reset" | "deleted" | "shutdown" | "stuck" | "failed";

/**
 * How a start ended. Only `store` and `timeout` count towards `corrupt`:
 * `locked` is another process's store, `port_in_use` the host's bad luck,
 * `spawn` a binary that would not run (or no free port, or no host.json
 * written), `exited` a crash right after the store opened.
 */
type LaunchOutcome =
  | { kind: "ready"; proc: EngineProcess; startedAt: number }
  | { kind: "locked" | "store" | "port_in_use" | "spawn" | "timeout" | "exited"; message: string };

/** A request's hold on a running engine. Release it once, when the engine has answered or failed. */
export type EngineLease = {
  readonly ws: number;
  readonly port: number;
  readonly token: string;
  readonly pid: number | null;
  readonly incarnation: string;
  /** How long the engine had already been busy with other requests when this one began. */
  readonly busyMs: number;
  readonly mcp: McpSessionClient;
  release(): void;
  /** This lease's engine is still the one running. */
  current(): boolean;
  /** Stops this lease's engine, if it is still the one running (a request stuck in it). */
  abandon(reason: string): Promise<void>;
  /** Adds a load's triples to the store's last known size. */
  recordLoad(triples: number): void;
};

export type SupervisorOptions = {
  root: DataRoot;
  launcher: EngineLauncher;
  maxEngines: number;
  idleMs: number;
  startTimeoutMs: number;
  clock?: Clock;
  probeHealth?: (port: number, signal: AbortSignal) => Promise<boolean>;
  freePort?: () => Promise<number>;
  mcpClient?: () => McpSessionClient;
  log?: (line: string) => void;
};

export class Supervisor {
  private readonly slots = new Map<number, Slot>();
  private readonly clock: Clock;
  private readonly freePort: () => Promise<number>;
  private readonly newMcpClient: () => McpSessionClient;
  private readonly log: (line: string) => void;
  private readonly deps: LifecycleDeps;
  private closing = false;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: SupervisorOptions) {
    this.clock = opts.clock ?? systemClock;
    this.freePort = opts.freePort ?? freeLoopbackPort;
    this.newMcpClient = opts.mcpClient ?? (() => new McpSessionClient());
    this.log = opts.log ?? ((line) => console.log(`[engine-host] ${line}`));
    this.deps = { clock: this.clock, probeHealth: opts.probeHealth ?? probeEngineHealth, log: this.log };
  }

  get isClosing(): boolean {
    return this.closing;
  }

  /** Stops idle engines every so often, until close(). */
  startSweeper(): void {
    if (this.sweeper) return;
    const every = Math.max(1000, Math.min(30_000, Math.floor(this.opts.idleMs / 2)));
    this.sweeper = setInterval(() => {
      this.sweep().catch((err) => this.log(`idle sweep failed: ${message(err)}`));
    }, every);
    this.sweeper.unref();
  }

  /** Engines running or starting. */
  liveCount(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.proc || s.phase === "starting") n++;
    return n;
  }

  /** For tests and diagnostics: the MCP session client kept for a workspace. */
  mcpClient(ws: number): McpSessionClient | undefined {
    return this.slots.get(ws)?.mcp;
  }

  /**
   * A running engine for `ws`, started if it is not. Refused while the store is
   * corrupt or locked, or while a failed engine waits out its backoff.
   */
  async acquire(ws: number): Promise<EngineLease> {
    if (this.closing) throw shuttingDown();
    const slot = this.slotFor(ws);
    slot.waiters++;
    try {
      for (let round = 0; round < 3; round++) {
        // A start, stop, reset or delete under way finishes first.
        await slot.lock.idle();
        if (this.closing) throw shuttingDown();
        if (this.isUp(slot)) return this.lease(slot);
        await slot.lock.run(() => this.ensureStarted(slot));
        if (this.isUp(slot)) return this.lease(slot);
      }
      throw unavailable("The engine did not stay up long enough to take the request.", { state: this.stateOf(slot) });
    } finally {
      slot.waiters--;
    }
  }

  /** The store's incarnation, from memory or from its file, without starting anything. */
  async incarnation(ws: number): Promise<string | null> {
    const slot = this.slots.get(ws);
    if (slot?.meta) return slot.meta.incarnation;
    return (await this.opts.root.readMeta(ws))?.incarnation ?? null;
  }

  /** Answers at once: never waits for an engine or for a start under way. */
  async status(ws: number): Promise<WorkspaceEngineStatus> {
    const slot = this.slots.get(ws);
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    const meta = slot?.meta ?? (await this.opts.root.readMeta(ws).catch(() => null));
    if (!slot) {
      return {
        workspace: ws,
        state: meta?.corrupt ? "corrupt" : "cold",
        pid: null,
        incarnation: meta?.incarnation ?? null,
        lastStart: null,
        busySince: null,
        inFlight: 0,
        failures: 0,
        retryAt: null,
        lastError: meta?.corrupt?.reason ?? null,
        triples: meta?.triples ?? null,
      };
    }
    return {
      workspace: ws,
      state: this.stateOf(slot),
      pid: slot.proc?.pid ?? null,
      incarnation: meta?.incarnation ?? null,
      lastStart: iso(slot.readyAt),
      busySince: slot.inFlight > 0 ? iso(slot.busySince) : null,
      inFlight: slot.inFlight,
      failures: slot.failures,
      retryAt: slot.phase === "failed" || slot.phase === "locked" ? iso(slot.retryAt) : null,
      lastError: slot.lastError,
      triples: meta?.triples ?? null,
    };
  }

  /**
   * Stops the engine, deletes its store and starts it empty, with a new
   * incarnation. Refused when another process holds the store.
   */
  async reset(ws: number): Promise<string> {
    if (this.closing) throw shuttingDown();
    const slot = this.slotFor(ws);
    slot.waiters++;
    try {
      return await slot.lock.run(async () => {
        if (this.closing) throw shuttingDown();
        await this.claimStore(slot, "reset");
        await this.stopProcess(slot, "reset");
        await this.opts.root.removeStore(ws);
        this.forgetStore(slot);
        const outcome = await this.launch(slot);
        if (outcome.kind !== "ready") throw await this.failStart(slot, outcome);
        await this.onReady(slot, outcome);
        this.log(`workspace ${ws}: reset, new incarnation ${slot.meta!.incarnation}`);
        return slot.meta!.incarnation;
      });
    } finally {
      slot.waiters--;
    }
  }

  /** Stops the engine and deletes its store. Refused when another process holds the store. */
  async remove(ws: number): Promise<void> {
    if (this.closing) throw shuttingDown();
    const slot = this.slotFor(ws);
    slot.waiters++;
    try {
      await slot.lock.run(async () => {
        if (this.closing) throw shuttingDown();
        await this.claimStore(slot, "delete");
        await this.stopProcess(slot, "deleted");
        await this.opts.root.removeStore(ws);
        this.forgetStore(slot);
        this.log(`workspace ${ws}: store deleted`);
      });
    } finally {
      slot.waiters--;
      if (this.isQuiet(slot) && slot.phase === "cold") this.slots.delete(ws);
    }
  }

  /** Stops every engine idle for `idleMs`, least recently used first. */
  async sweep(): Promise<void> {
    if (this.closing) return;
    const now = this.clock.now();
    const idle = [...this.slots.values()]
      .filter((s) => !s.lock.busy && this.isStoppable(s) && now - s.lastUsed >= this.opts.idleMs)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const slot of idle) {
      await slot.lock.run(async () => {
        if (this.isStoppable(slot) && this.clock.now() - slot.lastUsed >= this.opts.idleMs) {
          await this.stopProcess(slot, "idle");
        }
      });
    }
  }

  /**
   * Refuses new requests, waits up to `drainMs` for those in flight, then stops
   * every engine. The stores stay on disk; the next start reopens them.
   */
  async close(drainMs = 5000): Promise<void> {
    this.closing = true;
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    const deadline = this.clock.now() + drainMs;
    while (this.inFlight() > 0 && this.clock.now() < deadline) await this.clock.sleep(50);
    await Promise.all(
      [...this.slots.values()].map((slot) =>
        slot.lock
          .run(() => this.stopProcess(slot, "shutdown"))
          .catch((err) => this.log(`workspace ${slot.ws}: stopping failed: ${message(err)}`)),
      ),
    );
  }

  private inFlight(): number {
    let n = 0;
    for (const s of this.slots.values()) n += s.inFlight;
    return n;
  }

  private slotFor(ws: number): Slot {
    let slot = this.slots.get(ws);
    if (!slot) {
      this.trim();
      slot = {
        ws,
        dir: this.opts.root.storeDir(ws),
        lock: new Mutex(),
        mcp: this.newMcpClient(),
        proc: null,
        port: 0,
        token: "",
        phase: "cold",
        meta: null,
        inFlight: 0,
        waiters: 0,
        busySince: null,
        lastUsed: this.clock.now(),
        readyAt: null,
        failures: 0,
        openFailures: 0,
        timeoutsInARow: 0,
        retryAt: null,
        lastError: null,
        stopping: false,
        evicting: false,
      };
      this.slots.set(ws, slot);
    }
    return slot;
  }

  /** Forgets the quietest workspaces once too many are remembered. A corrupt mark stays on disk. */
  private trim(): void {
    if (this.slots.size < SLOT_LIMIT) return;
    const quiet = [...this.slots.values()].filter((s) => this.isQuiet(s)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const s of quiet) {
      if (this.slots.size < SLOT_LIMIT) break;
      this.slots.delete(s.ws);
    }
  }

  private isQuiet(s: Slot): boolean {
    return !s.proc && s.phase !== "starting" && s.inFlight === 0 && s.waiters === 0 && !s.lock.busy;
  }

  private isUp(s: Slot): boolean {
    return s.proc !== null && s.phase === "ready" && !s.stopping && !s.evicting;
  }

  private isStoppable(s: Slot): boolean {
    return this.isUp(s) && s.inFlight === 0 && s.waiters === 0;
  }

  private stateOf(s: Slot): EngineState {
    if (s.phase === "ready") return s.inFlight > 0 ? "busy" : "ready";
    return s.phase;
  }

  private lease(slot: Slot): EngineLease {
    if (slot.inFlight >= MAX_IN_FLIGHT_PER_ENGINE) {
      throw new HostError(
        503,
        "at_capacity",
        `${MAX_IN_FLIGHT_PER_ENGINE} requests are already in flight for this workspace.`,
        { retryAfterMs: 1000 },
      );
    }
    const proc = slot.proc!;
    const incarnation = slot.meta!.incarnation;
    const now = this.clock.now();
    const busyMs = slot.inFlight > 0 && slot.busySince !== null ? now - slot.busySince : 0;
    if (slot.inFlight === 0) slot.busySince = now;
    slot.inFlight++;
    slot.lastUsed = now;
    let released = false;
    return {
      ws: slot.ws,
      port: slot.port,
      token: slot.token,
      pid: proc.pid,
      incarnation,
      busyMs,
      mcp: slot.mcp,
      release: () => {
        if (released) return;
        released = true;
        slot.inFlight--;
        slot.lastUsed = this.clock.now();
        if (slot.inFlight === 0) slot.busySince = null;
      },
      current: () => slot.proc === proc,
      abandon: (reason) =>
        slot.lock.run(async () => {
          if (slot.proc !== proc) return;
          this.log(`workspace ${slot.ws}: ${reason}; stopping engine pid ${proc.pid}`);
          await this.stopProcess(slot, "stuck");
          slot.lastError = `Stopped: ${reason}.`;
        }),
      recordLoad: (triples) => {
        // At once in memory, for the store this lease was for; on disk under the
        // lock, so a reset under way cannot be overwritten with the old store's file.
        if (slot.proc !== proc || slot.meta?.incarnation !== incarnation) return;
        slot.meta = { ...slot.meta, triples: (slot.meta.triples ?? 0) + triples };
        slot.lock
          .run(async () => {
            if (slot.proc !== proc || slot.meta?.incarnation !== incarnation) return;
            await this.opts.root.writeMeta(slot.ws, slot.meta);
          })
          .catch((err) => this.log(`workspace ${slot.ws}: could not record the store's size: ${message(err)}`));
      },
    };
  }

  /** Under the slot's lock. */
  private async ensureStarted(slot: Slot): Promise<void> {
    if (this.isUp(slot)) return;
    if (this.closing) throw shuttingDown();
    // Read at every start: a store directory deleted behind the host's back
    // gets a new incarnation, not the one remembered for the old store.
    try {
      slot.meta = await this.opts.root.readMeta(slot.ws);
    } catch (err) {
      throw unavailable(`The store's host.json could not be read: ${message(err)}`);
    }
    if (slot.meta?.corrupt && slot.phase !== "corrupt") {
      slot.phase = "corrupt";
      slot.lastError = slot.meta.corrupt.reason;
    }
    if (slot.phase === "corrupt") throw this.corruptError(slot);
    if ((slot.phase === "failed" || slot.phase === "locked") && slot.retryAt !== null) {
      const wait = slot.retryAt - this.clock.now();
      if (wait > 0) throw this.backoffError(slot, wait);
    }
    const outcome = await this.launch(slot);
    if (outcome.kind !== "ready") throw await this.failStart(slot, outcome);
    await this.onReady(slot, outcome);
  }

  private backoffError(slot: Slot, waitMs: number): HostError {
    const seconds = Math.ceil(waitMs / 1000);
    if (slot.phase === "locked") {
      return new HostError(
        503,
        "locked",
        `Another process holds this workspace's store (its RocksDB LOCK). The host checks again in ${seconds} s.`,
        { state: "locked", retryAfterMs: waitMs },
      );
    }
    return unavailable(`The engine failed ${slot.failures} time(s) in a row; the next start is in ${seconds} s.`, {
      state: "failed",
      retryAfterMs: waitMs,
    });
  }

  private corruptError(slot: Slot): HostError {
    return new HostError(
      409,
      "corrupt",
      `This workspace's store failed to open ${OPEN_FAILURES_BEFORE_CORRUPT} times in a row; reset it to rebuild. ${slot.lastError ?? ""}`.trim(),
      { state: "corrupt" },
    );
  }

  /** Room for one more engine: stops the least recently used idle one if there is none. */
  private async makeRoom(slot: Slot): Promise<void> {
    // Counted and chosen before any await, so two starts cannot both take the last place.
    let others = 0;
    for (const s of this.slots.values()) if (s !== slot && (s.proc || s.phase === "starting")) others++;
    if (others < this.opts.maxEngines) return;
    let victim: Slot | null = null;
    for (const s of this.slots.values()) {
      if (s === slot || s.lock.busy || !this.isStoppable(s)) continue;
      if (!victim || s.lastUsed < victim.lastUsed) victim = s;
    }
    if (!victim) {
      throw new HostError(
        503,
        "at_capacity",
        `All ${this.opts.maxEngines} engines are busy or starting; try again shortly.`,
        { retryAfterMs: 1000 },
      );
    }
    const chosen = victim;
    chosen.evicting = true;
    this.log(`workspace ${chosen.ws}: stopping its idle engine to make room for workspace ${slot.ws}`);
    try {
      await chosen.lock.run(() => this.stopProcess(chosen, "evicted"));
    } finally {
      chosen.evicting = false;
    }
  }

  /**
   * Starts a process for the slot. A ready one leaves the slot `starting` for
   * the caller to finish; anything else leaves it as it was.
   */
  private async launch(slot: Slot): Promise<LaunchOutcome> {
    const before = slot.phase === "starting" ? "cold" : slot.phase;
    slot.phase = "starting";
    let outcome: LaunchOutcome | null = null;
    try {
      await this.makeRoom(slot);
      for (let attempt = 0; ; attempt++) {
        outcome = await this.launchOnce(slot);
        if (outcome.kind !== "port_in_use" || attempt >= PORT_RETRIES) break;
      }
      return outcome;
    } finally {
      if (outcome?.kind !== "ready" && slot.phase === "starting") slot.phase = before;
    }
  }

  private async launchOnce(slot: Slot): Promise<LaunchOutcome> {
    const startedAt = this.clock.now();
    let port: number;
    try {
      port = await this.freePort();
    } catch (err) {
      return { kind: "spawn", message: `no free port: ${message(err)}` };
    }
    try {
      await fs.mkdir(slot.dir, { recursive: true });
    } catch (err) {
      return { kind: "store", message: `could not create the store's directory: ${message(err)}` };
    }
    const token = randomBytes(24).toString("hex");
    const proc = this.opts.launcher.launch({
      label: `ws-${slot.ws}`,
      dataDir: slot.dir,
      port,
      mode: "persistent",
      token,
    });
    slot.proc = proc;
    slot.port = port;
    slot.token = token;
    slot.stopping = false;
    const timeoutMs = startTimeoutMs(this.opts.startTimeoutMs, slot.meta?.triples ?? null, slot.timeoutsInARow);
    const result = await waitReady(proc, port, timeoutMs, this.deps);
    if (result === "ready") return { kind: "ready", proc, startedAt };
    slot.proc = null;
    if (result === "timeout") {
      await terminate(proc, this.deps);
      return { kind: "timeout", message: `not ready within ${timeoutMs} ms: ${lastLines(proc.output())}` };
    }
    const exit = proc.exit() ?? { code: null, signal: null };
    if (exit.spawnError) return { kind: "spawn", message: `could not start open-ontologies: ${exit.spawnError}` };
    const output = proc.output();
    return {
      kind: classifyEarlyExit(output),
      message: `exited (${describeExit(exit)}) before it was ready: ${lastLines(output)}`,
    };
  }

  /** Under the slot's lock, with the process up. */
  private async onReady(slot: Slot, outcome: Extract<LaunchOutcome, { kind: "ready" }>): Promise<void> {
    const { proc } = outcome;
    const now = this.clock.now();
    const opened = proc.openedTriples();
    const created = !slot.meta;
    const meta: StoreMeta = {
      ...(slot.meta ?? { incarnation: randomUUID(), createdAt: new Date(now).toISOString(), triples: null }),
      triples: opened ?? slot.meta?.triples ?? null,
      corrupt: null,
    };
    try {
      await this.opts.root.writeMeta(slot.ws, meta);
    } catch (err) {
      // An incarnation that is not on disk would not survive a host restart,
      // and writers could not be fenced: do not serve the store without it.
      await this.stopProcess(slot, "failed");
      throw await this.failStart(slot, { kind: "spawn", message: `could not write host.json: ${message(err)}` });
    }
    if (proc.exit()) {
      slot.proc = null;
      throw await this.failStart(slot, {
        kind: "exited",
        message: `exited (${describeExit(proc.exit()!)}) right after it opened: ${lastLines(proc.output())}`,
      });
    }
    // From here an exit is a crash; nothing awaits between the check above and this.
    void proc.exited.then((exit) => this.onExit(slot, proc, exit));
    slot.meta = meta;
    slot.phase = "ready";
    slot.readyAt = now;
    slot.lastUsed = now;
    slot.openFailures = 0;
    slot.timeoutsInARow = 0;
    slot.retryAt = null;
    slot.lastError = null;
    this.log(
      `workspace ${slot.ws}: engine ready, pid ${proc.pid}, ${opened ?? "?"} triples, in ${now - outcome.startedAt} ms` +
        (created ? `; new incarnation ${meta.incarnation}` : ""),
    );
  }

  /**
   * Records a failed start, under the slot's lock (a corrupt mark is written
   * before anything else can touch the store); returns the error to answer with.
   */
  private async failStart(slot: Slot, outcome: Exclude<LaunchOutcome, { kind: "ready" }>): Promise<HostError> {
    const error = this.onStartFailure(slot, outcome);
    if (slot.phase === "corrupt") await this.markCorrupt(slot, outcome.message);
    return error;
  }

  private onStartFailure(slot: Slot, outcome: Exclude<LaunchOutcome, { kind: "ready" }>): HostError {
    slot.failures++;
    slot.lastError = outcome.message;
    const retryAfterMs = backoffMs(slot.failures);
    slot.retryAt = this.clock.now() + retryAfterMs;
    if (outcome.kind === "locked") {
      slot.phase = "locked";
      this.log(`workspace ${slot.ws}: another process holds the store; leaving it alone (${outcome.message})`);
      return new HostError(
        503,
        "locked",
        "Another process holds this workspace's store (its RocksDB LOCK). The host will not open, reset or delete it.",
        { state: "locked", retryAfterMs },
      );
    }
    if (outcome.kind === "store" || outcome.kind === "timeout") {
      slot.openFailures++;
      if (outcome.kind === "timeout") slot.timeoutsInARow++;
      if (slot.openFailures >= OPEN_FAILURES_BEFORE_CORRUPT) {
        slot.phase = "corrupt";
        slot.retryAt = null;
        this.log(`workspace ${slot.ws}: the store failed to open ${slot.openFailures} times in a row; marked corrupt`);
        return this.corruptError(slot);
      }
    }
    slot.phase = "failed";
    this.log(`workspace ${slot.ws}: the engine could not start (${outcome.message}); next try in ${retryAfterMs} ms`);
    return unavailable(`The engine could not start: ${outcome.message}`, { state: "failed", retryAfterMs });
  }

  /** Keeps the mark across host restarts; best effort. */
  private async markCorrupt(slot: Slot, reason: string): Promise<void> {
    const meta: StoreMeta = {
      ...(slot.meta ?? { incarnation: randomUUID(), createdAt: new Date(this.clock.now()).toISOString(), triples: null }),
      corrupt: { since: new Date(this.clock.now()).toISOString(), reason },
    };
    try {
      await this.opts.root.writeMeta(slot.ws, meta);
      slot.meta = meta;
    } catch (err) {
      this.log(`workspace ${slot.ws}: could not record the corrupt mark: ${message(err)}`);
    }
  }

  private onExit(slot: Slot, proc: EngineProcess, exit: EngineExit): void {
    if (slot.proc !== proc || slot.stopping) return;
    const now = this.clock.now();
    slot.proc = null;
    if (slot.readyAt !== null && now - slot.readyAt >= STABLE_AFTER_MS) slot.failures = 0;
    slot.failures++;
    slot.phase = "failed";
    const retryAfterMs = backoffMs(slot.failures);
    slot.retryAt = now + retryAfterMs;
    slot.lastError = `The engine exited unexpectedly (${describeExit(exit)}): ${lastLines(proc.output())}`;
    this.log(`workspace ${slot.ws}: engine pid ${proc.pid} exited unexpectedly (${describeExit(exit)}); next start in ${retryAfterMs} ms`);
  }

  /**
   * Makes sure no other process holds the store before it is deleted. Our own
   * running engine proves it. Otherwise an engine is started on it: ready, it
   * is ours; refused for the LOCK, it is not, and nothing is deleted. A store
   * that fails to open for any other reason is ours too: RocksDB takes the
   * LOCK before it reads anything else.
   */
  private async claimStore(slot: Slot, what: "reset" | "delete"): Promise<void> {
    if (this.isUp(slot)) return;
    if (!(await this.opts.root.storeExists(slot.ws))) return;
    const outcome = await this.launch(slot);
    switch (outcome.kind) {
      case "ready":
        slot.phase = "ready";
        return;
      case "store":
      case "timeout":
        return;
      case "locked": {
        // Recorded, but it does not lengthen the requests' backoff: a reset or
        // delete is asked for, not retried on its own.
        const now = this.clock.now();
        slot.phase = "locked";
        slot.lastError = outcome.message;
        if (slot.retryAt === null || slot.retryAt < now) slot.retryAt = now + backoffMs(Math.max(1, slot.failures));
        const retryAfterMs = slot.retryAt - now;
        throw new HostError(
          503,
          "locked",
          `Another process holds this workspace's store (its RocksDB LOCK); the host will not ${what} it.`,
          { state: "locked", retryAfterMs },
        );
      }
      default:
        throw unavailable(`Could not make sure no other process holds this workspace's store: ${outcome.message}`);
    }
  }

  private forgetStore(slot: Slot): void {
    slot.meta = null;
    slot.phase = "cold";
    slot.failures = 0;
    slot.openFailures = 0;
    slot.timeoutsInARow = 0;
    slot.retryAt = null;
    slot.lastError = null;
    slot.readyAt = null;
  }

  private async stopProcess(slot: Slot, reason: StopReason): Promise<void> {
    const proc = slot.proc;
    if (!proc) return;
    slot.stopping = true;
    try {
      await terminate(proc, this.deps, { force: reason === "stuck" });
    } finally {
      if (slot.proc === proc) slot.proc = null;
      slot.stopping = false;
    }
    if (slot.phase === "ready") slot.phase = "cold";
    if (reason === "idle" || reason === "evicted") slot.failures = 0;
    this.log(`workspace ${slot.ws}: engine pid ${proc.pid} stopped (${reason})`);
  }
}
