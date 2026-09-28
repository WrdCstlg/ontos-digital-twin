import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { readBatchAnswer, readEngineAnswer } from "./answers";
import type { Clock } from "./clock";
import type { HostConfig } from "./config";
import { DataRoot } from "./dataRoot";
import { HttpConnectionError, HttpResponseTooLarge, HttpTimeoutError, httpRequest } from "./engineHttp";
import {
  HostError,
  badRequest,
  engineError,
  engineTimeout,
  incarnationMismatch,
  message,
  refused,
  shuttingDown,
  tooLarge,
  unavailable,
} from "./errors";
import { McpConnectionError, McpHttpError, McpProtocolError, type McpToolResult } from "./mcp";
import { ChildProcessLauncher, type EngineLauncher } from "./process";
import { ScratchPool, type ScratchLease } from "./scratch";
import { Supervisor, type EngineLease } from "./supervisor";
import {
  ENGINE_JSON_BODY_LIMIT,
  type LoadAnswer,
  type LoadFormat,
  type ReasonResult,
  type ReasoningProfile,
  type ScratchValidateAnswer,
  type ShaclReport,
  type UpdateAnswer,
  type WorkspaceEngineStatus,
} from "./types";

/**
 * The host's operations, one per route. Each workspace request holds a lease
 * on its engine while the engine works, so the engine counts as busy exactly
 * as long as it is.
 *
 * Timeouts. The engine keeps working on a request after the host stops
 * waiting (an aborted request is not cancelled; the engine answers nothing
 * else meanwhile). So a request that outlives its route's timeout is answered
 * 504 at once, and the host keeps waiting in the background, still counting
 * the engine busy. If the engine has not answered at twice the timeout, the
 * host stops it: it is stuck, and the next request starts it again.
 */

const KILL_AFTER_FACTOR = 2;
/** Loads streaming to disk at once, at most: each may be up to the load cap. */
const MAX_CONCURRENT_LOADS = 4;
const DRAIN_POLL_MS = 50;

const LOAD_EXTENSIONS: Record<LoadFormat, string> = { turtle: ".ttl", "n-triples": ".nt", trig: ".trig" };

/** The longest a request on a workspace engine is waited for: onEngine answers 504 well before. */
const hardTimeout = (timeoutMs: number) => timeoutMs * KILL_AFTER_FACTOR + 1000;

/** Errors of the host's own disk, as opposed to a body that stopped arriving. */
const DISK_ERRORS = new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EIO", "ENOENT", "EROFS", "EMFILE", "ENFILE"]);

export type EngineHostDeps = {
  launcher?: EngineLauncher;
  clock?: Clock;
  probeHealth?: (port: number, signal: AbortSignal) => Promise<boolean>;
  freePort?: () => Promise<number>;
  log?: (line: string) => void;
};

type EngineAddress = { port: number; token: string };

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

export class EngineHost {
  readonly supervisor: Supervisor;
  readonly scratch: ScratchPool;
  private readonly log: (line: string) => void;
  private closingFlag = false;
  private active = 0;
  private loads = 0;

  private constructor(
    readonly config: HostConfig,
    readonly root: DataRoot,
    deps: EngineHostDeps,
  ) {
    this.log = deps.log ?? ((line) => console.log(`[engine-host] ${line}`));
    const launcher = deps.launcher ?? new ChildProcessLauncher(config.binPath, this.log);
    this.supervisor = new Supervisor({
      root,
      launcher,
      maxEngines: config.maxEngines,
      idleMs: config.idleMs,
      startTimeoutMs: config.startTimeoutMs,
      clock: deps.clock,
      probeHealth: deps.probeHealth,
      freePort: deps.freePort,
      log: this.log,
    });
    this.scratch = new ScratchPool({
      size: config.scratchEngines,
      waitMs: config.scratchWaitMs,
      startTimeoutMs: config.startTimeoutMs,
      launcher,
      clock: deps.clock,
      probeHealth: deps.probeHealth,
      freePort: deps.freePort,
      log: this.log,
    });
  }

  /** Opens the data root (refusing one the host did not make) and starts the idle sweep. */
  static async create(config: HostConfig, deps: EngineHostDeps = {}): Promise<EngineHost> {
    const root = await DataRoot.open(config.dataDir);
    const host = new EngineHost(config, root, deps);
    host.supervisor.startSweeper();
    return host;
  }

  get closing(): boolean {
    return this.closingFlag;
  }

  /**
   * Stops taking requests, lets those in flight finish for up to `drainMs`,
   * then stops every engine. Each store stays on disk for the next start.
   */
  async close(drainMs = 5000): Promise<void> {
    this.closingFlag = true;
    const deadline = Date.now() + drainMs;
    while (this.active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
    await this.supervisor.close(0);
    await this.scratch.close();
  }

  status(ws: number): Promise<WorkspaceEngineStatus> {
    return this.supervisor.status(ws);
  }

  /** The engine's own JSON, as text: checked for a refusal, not re-encoded. */
  query(ws: number, query: string): Promise<{ json: string; busyMs: number }> {
    return this.track(async () => {
      const t = this.config.timeouts.query;
      const { value, busyMs } = await this.onEngine(ws, t, async (lease, signal) => {
        const text = await this.post(lease, "/api/query", { query }, hardTimeout(t), signal);
        const answer = readEngineAnswer(text);
        if (!answer.ok) throw refused(answer.message);
        return text;
      });
      return { json: value, busyMs };
    });
  }

  update(ws: number, update: string, incarnation: string | undefined): Promise<UpdateAnswer & { busyMs: number }> {
    return this.track(async () => {
      await this.checkIncarnation(ws, incarnation);
      const payload = { query: update };
      if (Buffer.byteLength(JSON.stringify(payload)) > ENGINE_JSON_BODY_LIMIT) {
        throw tooLarge(`An update is at most ${ENGINE_JSON_BODY_LIMIT} bytes, the most the engine accepts; use /load for more.`);
      }
      const t = this.config.timeouts.update;
      const { value, busyMs } = await this.onEngine(ws, t, async (lease, signal) => {
        if (lease.incarnation !== incarnation) throw incarnationMismatch(lease.incarnation);
        const answer = readEngineAnswer(await this.post(lease, "/api/update", payload, hardTimeout(t), signal));
        if (!answer.ok) throw refused(answer.message);
        return { affected: Number(answer.body.affected ?? 0), incarnation: lease.incarnation };
      });
      return { ...value, busyMs };
    });
  }

  /**
   * Streams the body to a file under the data root, then has the engine load
   * that file: no body limit but the configured cap. The file is deleted
   * whatever happens.
   */
  load(
    ws: number,
    body: ReadableStream<Uint8Array> | null,
    format: LoadFormat,
    incarnation: string | undefined,
    declaredBytes: number | null,
  ): Promise<LoadAnswer & { busyMs: number }> {
    return this.track(async () => {
      await this.checkIncarnation(ws, incarnation);
      const cap = this.config.loadMaxBytes;
      if (declaredBytes !== null && declaredBytes > cap) throw tooLarge(`A load is at most ${cap} bytes.`);
      if (this.loads >= MAX_CONCURRENT_LOADS) {
        throw new HostError(503, "at_capacity", `${MAX_CONCURRENT_LOADS} loads are already under way; try again shortly.`, {
          retryAfterMs: 1000,
        });
      }
      this.loads++;
      const file = await this.root.tempFile(LOAD_EXTENSIONS[format]);
      try {
        const bytes = await this.receive(body, file, cap);
        const t = this.config.timeouts.load;
        const { value, busyMs } = await this.onEngine(ws, t, async (lease, signal) => {
          if (lease.incarnation !== incarnation) throw incarnationMismatch(lease.incarnation);
          const answer = readEngineAnswer(await this.post(lease, "/api/load", { path: file }, hardTimeout(t), signal));
          if (!answer.ok) throw refused(answer.message);
          const loaded = Number(answer.body.triples_loaded ?? 0);
          lease.recordLoad(loaded);
          return { triplesLoaded: loaded, bytes, incarnation: lease.incarnation };
        });
        return { ...value, busyMs };
      } finally {
        this.loads--;
        await this.root.removeTemp(file);
      }
    });
  }

  /** SHACL over the whole store, with shapes written to a file for the engine to read. */
  shacl(ws: number, shapes: string): Promise<{ report: ShaclReport; busyMs: number }> {
    return this.track(async () => {
      const file = await this.root.tempFile(".ttl");
      try {
        await this.writeTemp(file, shapes);
        const t = this.config.timeouts.shacl;
        const { value, busyMs } = await this.onEngine(ws, t, (lease, signal) =>
          this.runShacl(lease, file, hardTimeout(t), signal),
        );
        return { report: value, busyMs };
      } finally {
        await this.root.removeTemp(file);
      }
    });
  }

  /** A reasoning dry run over the MCP endpoint: counts and samples; the store is left as it was. */
  reason(ws: number, profile: ReasoningProfile): Promise<{ result: ReasonResult; busyMs: number }> {
    return this.track(async () => {
      const t = this.config.timeouts.reason;
      const { value, busyMs } = await this.onEngine(ws, t, async (lease, signal) => {
        const res = await lease.mcp.callTool(
          { url: `http://127.0.0.1:${lease.port}/mcp`, token: lease.token },
          "onto_reason",
          { profile, materialize: false },
          signal,
        );
        return this.reasonResult(res);
      });
      return { result: value, busyMs };
    });
  }

  reset(ws: number): Promise<{ incarnation: string }> {
    return this.track(async () => ({ incarnation: await this.supervisor.reset(ws) }));
  }

  remove(ws: number): Promise<void> {
    return this.track(() => this.supervisor.remove(ws));
  }

  /**
   * Validates `data` against `shapes` on a scratch engine: emptied, loaded
   * with the data from a file, validated, and emptied again. One that cannot
   * be emptied is replaced, so no request sees another's data.
   */
  scratchValidate(data: string, shapes: string): Promise<ScratchValidateAnswer> {
    return this.track(async () => {
      const dataFile = await this.root.tempFile(".ttl");
      const shapesFile = await this.root.tempFile(".ttl");
      try {
        await this.writeTemp(dataFile, data);
        await this.writeTemp(shapesFile, shapes);
        return await this.scratch.use(async (engine) => {
          const deadline = Date.now() + this.config.timeouts.scratch;
          const left = () => Math.max(1, deadline - Date.now());
          let clean = false;
          let broken = false;
          try {
            await this.dropAll(engine, left());
            const loaded = readEngineAnswer(await this.post(engine, "/api/load", { path: dataFile }, left()));
            if (!loaded.ok) throw refused(loaded.message);
            const report = await this.runShacl(engine, shapesFile, left());
            await this.dropAll(engine, left());
            clean = true;
            return { triplesLoaded: Number(loaded.body.triples_loaded ?? 0), report };
          } catch (err) {
            const mapped = this.transportError(err, this.config.timeouts.scratch);
            // Timed out, gone, or answering nonsense: not an engine to trust with the next request.
            broken = mapped.status >= 500;
            throw mapped;
          } finally {
            if (broken) await engine.discard();
            else if (!clean) await this.emptyOrDiscard(engine);
          }
        });
      } finally {
        await this.root.removeTemp(dataFile);
        await this.root.removeTemp(shapesFile);
      }
    });
  }

  private async track<T>(op: () => Promise<T>): Promise<T> {
    if (this.closingFlag) throw shuttingDown();
    this.active++;
    try {
      return await op();
    } finally {
      this.active--;
    }
  }

  private async checkIncarnation(ws: number, given: string | undefined): Promise<void> {
    let current: string | null;
    try {
      current = await this.supervisor.incarnation(ws);
    } catch (err) {
      throw unavailable(`The store's incarnation could not be read: ${message(err)}`);
    }
    if (!given || given !== current) throw incarnationMismatch(current);
  }

  /**
   * Runs `work` on the workspace's engine under a lease: answers 504 after
   * `timeoutMs`, releases the lease only when the engine is done, and stops
   * the engine if that takes more than twice `timeoutMs`.
   */
  private async onEngine<T>(
    ws: number,
    timeoutMs: number,
    work: (lease: EngineLease, signal: AbortSignal) => Promise<T>,
  ): Promise<{ value: T; busyMs: number }> {
    const lease = await this.supervisor.acquire(ws);
    const hardMs = timeoutMs * KILL_AFTER_FACTOR;
    const hard = new AbortController();
    const hardTimer = setTimeout(() => hard.abort(new HttpTimeoutError(hardMs)), hardMs);
    hardTimer.unref();
    const done = (async () => work(lease, hard.signal))().finally(() => {
      clearTimeout(hardTimer);
      lease.release();
    });
    done.catch(() => {
      if (hard.signal.aborted && lease.current()) {
        void lease.abandon(`a request was still running after ${hardMs} ms, twice its timeout`);
      }
    });
    let softTimer: ReturnType<typeof setTimeout> | undefined;
    const soft = new Promise<null>((resolve) => {
      softTimer = setTimeout(() => resolve(null), timeoutMs);
      softTimer.unref();
    });
    try {
      const outcome = await Promise.race([done.then((value) => ({ value })), soft]);
      if (!outcome) throw engineTimeout(timeoutMs);
      return { value: outcome.value, busyMs: lease.busyMs };
    } catch (err) {
      throw this.transportError(err, timeoutMs);
    } finally {
      clearTimeout(softTimer);
    }
  }

  /** POSTs JSON to an engine and returns its HTTP 200 body; anything else is a HostError. */
  private async post(
    engine: EngineAddress,
    path: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await httpRequest({
      method: "POST",
      url: `http://127.0.0.1:${engine.port}${path}`,
      headers: { "content-type": "application/json", authorization: `Bearer ${engine.token}` },
      body: JSON.stringify(body),
      timeoutMs,
      signal,
    });
    if (res.status === 200) return res.text;
    if (res.status === 413) throw tooLarge("The engine refused the body as too large.");
    throw engineError(`The engine answered HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  }

  private async runShacl(engine: EngineAddress, shapesFile: string, timeoutMs: number, signal?: AbortSignal): Promise<ShaclReport> {
    const answer = readBatchAnswer(await this.post(engine, "/api/batch", [{ command: "shacl", args: [shapesFile] }], timeoutMs, signal));
    if (!answer.ok) throw refused(answer.message);
    // null is an answer: no shape's target selected anything, so conformance is undetermined.
    const { conforms } = answer.body;
    if (typeof conforms !== "boolean" && conforms !== null) throw engineError("The engine's SHACL report has no conforms.");
    return answer.body as ShaclReport;
  }

  private reasonResult(res: McpToolResult): ReasonResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      if (res.isError) throw refused(res.text || "The engine refused the reasoning run.");
      throw engineError(`The engine's reasoning answer is not JSON: ${res.text.slice(0, 200)}`);
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (record.error !== undefined && record.error !== null) {
        throw refused(typeof record.error === "string" ? record.error : JSON.stringify(record.error));
      }
      if (res.isError) throw refused(res.text);
      return record as ReasonResult;
    }
    throw engineError("The engine's reasoning answer is not an object.");
  }

  private async dropAll(engine: ScratchLease, timeoutMs: number): Promise<void> {
    const answer = readEngineAnswer(await this.post(engine, "/api/update", { query: "DROP ALL" }, timeoutMs));
    if (!answer.ok) throw engineError(`A scratch engine refused DROP ALL: ${answer.message}`);
  }

  private async emptyOrDiscard(engine: ScratchLease): Promise<void> {
    try {
      await this.dropAll(engine, 5000);
    } catch (err) {
      this.log(`${engine.label} could not be emptied (${message(err)}); replacing it`);
      await engine.discard();
    }
  }

  private async receive(body: ReadableStream<Uint8Array> | null, file: string, cap: number): Promise<number> {
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > cap) done(tooLarge(`A load is at most ${cap} bytes.`));
        else done(null, chunk);
      },
    });
    const source = body ? Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>) : Readable.from([]);
    try {
      await pipeline(source, counter, createWriteStream(file, { flags: "wx" }));
    } catch (err) {
      if (err instanceof HostError) throw err;
      throw this.diskError(err) ?? badRequest(`The body could not be read: ${message(err)}`);
    }
    return bytes;
  }

  private async writeTemp(file: string, text: string): Promise<void> {
    try {
      await fs.writeFile(file, text, { flag: "wx" });
    } catch (err) {
      throw this.diskError(err) ?? err;
    }
  }

  private diskError(err: unknown): HostError | null {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (!code || !DISK_ERRORS.has(code)) return null;
    this.log(`could not write a temporary file under ${this.root.tempDir}: ${message(err)}`);
    return new HostError(500, "internal", `The engine host could not store the body (${code}).`);
  }

  /** Maps a failure on the way to or from an engine to what the host answers. */
  private transportError(err: unknown, timeoutMs: number): HostError {
    if (err instanceof HostError) return err;
    if (err instanceof HttpTimeoutError || isAbort(err)) return engineTimeout(timeoutMs);
    if (err instanceof HttpConnectionError || err instanceof McpConnectionError) {
      return unavailable(`The engine could not be reached, or dropped the request: ${err.message}`);
    }
    if (err instanceof HttpResponseTooLarge || err instanceof McpHttpError || err instanceof McpProtocolError) {
      return engineError(err.message);
    }
    this.log(`unexpected failure: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return new HostError(500, "internal", "The engine host failed unexpectedly.");
  }
}
