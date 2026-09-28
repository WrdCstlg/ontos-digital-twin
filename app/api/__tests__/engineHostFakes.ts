/**
 * Fakes for the engine host's tests: a clock the test moves, engine processes
 * the test drives, an engine that answers over HTTP like open-ontologies
 * v1.3.0 does, and an MCP server with rmcp's session behaviour.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Clock } from "../services/engineHost/clock";
import type { EngineExit, EngineLauncher, EngineProcess, LaunchSpec } from "../services/engineHost/process";

// ─── Clock ─────────────────────────────────────────────────────────────────

type Sleeper = { at: number; ms: number; resolve: () => void };

/** Time moves only when the test says. */
export class FakeClock implements Clock {
  private t = 1_700_000_000_000;
  private sleepers: Sleeper[] = [];

  now(): number {
    return this.t;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const sleeper: Sleeper = { at: this.t + ms, ms, resolve };
      this.sleepers.push(sleeper);
      signal?.addEventListener(
        "abort",
        () => {
          this.sleepers = this.sleepers.filter((s) => s !== sleeper);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** The lengths of the sleeps not yet over. */
  pending(): number[] {
    return this.sleepers.map((s) => s.ms);
  }

  /** Waits (in real time, briefly) until code under test is asleep for `ms`. */
  async waitForSleep(ms: number, withinMs = 3000): Promise<void> {
    const until = Date.now() + withinMs;
    while (!this.sleepers.some((s) => s.ms === ms)) {
      if (Date.now() > until) throw new Error(`nothing slept for ${ms} ms; pending: ${this.pending().join(", ")}`);
      await new Promise((r) => setTimeout(r, 2));
    }
  }

  /** Moves time on, waking each sleeper in turn and letting its code run. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      this.sleepers.sort((a, b) => a.at - b.at);
      const next = this.sleepers[0];
      if (!next || next.at > target) break;
      this.sleepers.shift();
      this.t = next.at;
      next.resolve();
      await settle();
    }
    this.t = target;
    await settle();
  }
}

/** Lets pending callbacks, and the file I/O they start, run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

// ─── Processes the test drives ─────────────────────────────────────────────

export class FakeProcess implements EngineProcess {
  readonly exited: Promise<EngineExit>;
  readonly listening: Promise<void>;
  readonly signals: string[] = [];
  /** When true the process ignores SIGTERM (but not SIGKILL). */
  stubborn = false;
  private exitInfo: EngineExit | null = null;
  private triples: number | null = null;
  private lines: string[] = [];
  private markListening!: () => void;
  private markExited!: (exit: EngineExit) => void;

  constructor(
    readonly spec: LaunchSpec,
    readonly pid: number,
  ) {
    this.listening = new Promise((r) => (this.markListening = r));
    this.exited = new Promise((r) => (this.markExited = r));
  }

  becomeReady(triples: number | null = 0): void {
    this.triples = triples;
    if (triples !== null) this.lines.push(`opened persistent triple store at ${this.spec.dataDir}/triplestore (${triples} triples)`);
    this.lines.push(`Open Ontologies MCP server listening on http://127.0.0.1:${this.spec.port}/mcp`);
    this.markListening();
  }

  exitWith(code: number | null, output?: string, signal: string | null = null): void {
    if (this.exitInfo) return;
    if (output) this.lines.push(...output.split("\n"));
    this.exitInfo = { code, signal };
    this.markExited(this.exitInfo);
  }

  /** As a missing or unrunnable binary: the process never started. */
  failToSpawn(reason: string): void {
    if (this.exitInfo) return;
    this.exitInfo = { code: null, signal: null, spawnError: reason };
    this.markExited(this.exitInfo);
  }

  exit(): EngineExit | null {
    return this.exitInfo;
  }

  openedTriples(): number | null {
    return this.triples;
  }

  output(): string {
    return this.lines.join("\n");
  }

  signal(sig: "SIGTERM" | "SIGKILL"): void {
    this.signals.push(sig);
    if (sig === "SIGTERM" && this.stubborn) return;
    this.exitWith(null, undefined, sig);
  }
}

export class FakeLauncher implements EngineLauncher {
  readonly launched: FakeProcess[] = [];
  /** What each new process does; by default it becomes ready at once, with an empty store. */
  behavior: (proc: FakeProcess) => void = (p) => p.becomeReady(0);

  launch(spec: LaunchSpec): EngineProcess {
    const proc = new FakeProcess(spec, 10_000 + this.launched.length);
    this.launched.push(proc);
    const behave = this.behavior;
    queueMicrotask(() => behave(proc));
    return proc;
  }

  running(): FakeProcess[] {
    return this.launched.filter((p) => !p.exit());
  }

  /** The processes launched for a workspace, oldest first. */
  of(ws: number): FakeProcess[] {
    return this.launched.filter((p) => p.spec.label === `ws-${ws}`);
  }

  latest(ws: number): FakeProcess {
    const all = this.of(ws);
    if (!all.length) throw new Error(`no process was launched for workspace ${ws}`);
    return all[all.length - 1];
  }
}

export function portCounter(start = 40_000): () => Promise<number> {
  let next = start;
  return async () => next++;
}

// ─── An MCP server with rmcp 1.4's session behaviour ───────────────────────

export type ToolAnswer = { text: string; isError?: boolean } | { rpcError: { code: number; message: string } };

export type FakeMcpOptions = {
  /** Answers a tools/call. */
  tool?: (name: string, args: Record<string, unknown>) => ToolAnswer | Promise<ToolAnswer>;
  /** Answer as plain JSON rather than server-sent events. */
  json?: boolean;
  /** Write each SSE answer in pieces this small, to exercise the parser. */
  chunkBytes?: number;
  token?: string;
  /** Answer every tools/call "Session not found", as an engine that keeps restarting. */
  forgetOnCall?: boolean;
};

export class FakeMcp {
  readonly sessions = new Set<string>();
  initializeCount = 0;
  readonly calls: Array<{ session: string | null; protocolVersion: string | null; name: string; args: Record<string, unknown> }> = [];

  constructor(public opts: FakeMcpOptions = {}) {}

  /** The engine restarted: every session is gone. */
  restart(): void {
    this.sessions.clear();
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse, body: string): Promise<void> {
    if (this.opts.token && req.headers.authorization !== `Bearer ${this.opts.token}`) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    const accept = String(req.headers.accept ?? "");
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      res.writeHead(406).end("Not Acceptable: Client must accept both application/json and text/event-stream");
      return;
    }
    const msg = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
    const session = (req.headers["mcp-session-id"] as string | undefined) ?? null;
    if (msg.method === "initialize") {
      this.initializeCount++;
      const id = randomUUID();
      this.sessions.add(id);
      await this.answer(res, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rmcp", version: "1.4.0" } } }, { "mcp-session-id": id });
      return;
    }
    if (!session || !this.sessions.has(session)) {
      res.writeHead(404).end("Not Found: Session not found");
      return;
    }
    if (msg.method === "notifications/initialized") {
      res.writeHead(202).end();
      return;
    }
    if (msg.method === "tools/call") {
      if (this.opts.forgetOnCall) {
        this.sessions.delete(session);
        res.writeHead(404).end("Not Found: Session not found");
        return;
      }
      const params = msg.params as { name: string; arguments: Record<string, unknown> };
      this.calls.push({ session, protocolVersion: (req.headers["mcp-protocol-version"] as string) ?? null, name: params.name, args: params.arguments });
      const answer = this.opts.tool ? await this.opts.tool(params.name, params.arguments) : { text: "{}" };
      const payload =
        "rpcError" in answer
          ? { jsonrpc: "2.0", id: msg.id, error: answer.rpcError }
          : { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: answer.text }], isError: answer.isError ?? false } };
      await this.answer(res, payload);
      return;
    }
    res.writeHead(400).end("unsupported");
  }

  private async answer(res: http.ServerResponse, payload: unknown, headers: Record<string, string> = {}): Promise<void> {
    if (this.opts.json) {
      res.writeHead(200, { "content-type": "application/json", ...headers }).end(JSON.stringify(payload));
      return;
    }
    // As rmcp does: a priming event with empty data, then the answer.
    const text = `data: \nid: 0\nretry: 3000\n\ndata: ${JSON.stringify(payload)}\nid: 0/0\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream", ...headers });
    const size = this.opts.chunkBytes ?? text.length;
    for (let i = 0; i < text.length; i += size) {
      res.write(text.slice(i, i + size));
      if (size < text.length) await new Promise((r) => setTimeout(r, 1));
    }
    res.end();
  }
}

// ─── An engine that answers over HTTP ──────────────────────────────────────

export type Reply = { status?: number; text: string; delayMs?: number; destroy?: boolean };

/** How the fake engines answer; tests replace entries as they need. */
export type EngineScript = {
  query: (query: string) => Reply;
  update: (query: string) => Reply;
  load: (file: string) => Reply;
  batch: (commands: Array<{ command: string; args: string[] }>) => Reply;
  tool: (name: string, args: Record<string, unknown>) => ToolAnswer;
};

export function defaultScript(): EngineScript {
  return {
    query: () => ({ text: JSON.stringify({ variables: ["s"], results: [{ s: "<urn:a>" }] }) }),
    update: () => ({ text: JSON.stringify({ ok: true, affected: 1 }) }),
    load: (file) => {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).length;
      return { text: JSON.stringify({ ok: true, triples_loaded: lines }) };
    },
    batch: () => ({ text: JSON.stringify([{ seq: 0, command: "shacl", result: { conforms: true, focus_nodes: 0, violation_count: 0, violations: [] } }]) }),
    tool: () => ({ text: JSON.stringify({ dry_run: true, inferred_count: 1, initial_triples: 3, final_triples: 4, profile_used: "rdfs" }) }),
  };
}

/** Every request a fake engine received: route and body. */
export type Received = { label: string; path: string; body: string; at: number };

export class HttpFakeEngine implements EngineProcess {
  readonly exited: Promise<EngineExit>;
  readonly listening: Promise<void>;
  readonly pid: number;
  private exitInfo: EngineExit | null = null;
  private markExited!: (exit: EngineExit) => void;
  private readonly server: http.Server;
  private readonly sockets = new Set<net.Socket>();
  readonly mcp: FakeMcp;

  constructor(
    readonly spec: LaunchSpec,
    pid: number,
    private readonly script: () => EngineScript,
    private readonly received: Received[],
  ) {
    this.pid = pid;
    this.exited = new Promise((r) => (this.markExited = r));
    this.mcp = new FakeMcp({ token: spec.token, tool: (n, a) => this.script().tool(n, a) });
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => void this.route(req, res, Buffer.concat(chunks).toString("utf8")));
    });
    this.server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
    this.listening = new Promise((resolve) => this.server.listen(spec.port, "127.0.0.1", () => resolve()));
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse, body: string): Promise<void> {
    const url = req.url ?? "";
    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", version: "1.3.0" }));
      return;
    }
    this.received.push({ label: this.spec.label, path: url, body, at: Date.now() });
    if (url === "/mcp") return this.mcp.handle(req, res, body);
    if (req.headers.authorization !== `Bearer ${this.spec.token}`) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    const script = this.script();
    const parsed = JSON.parse(body) as { query?: string; path?: string } & Array<{ command: string; args: string[] }>;
    const reply =
      url === "/api/query"
        ? script.query(parsed.query ?? "")
        : url === "/api/update"
          ? script.update(parsed.query ?? "")
          : url === "/api/load"
            ? script.load(parsed.path ?? "")
            : url === "/api/batch"
              ? script.batch(parsed)
              : { status: 404, text: "not found" };
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    if (reply.destroy) {
      req.socket.destroy();
      return;
    }
    if (!res.writableEnded && !res.destroyed) {
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" }).end(reply.text);
    }
  }

  exit(): EngineExit | null {
    return this.exitInfo;
  }

  openedTriples(): number | null {
    return 0;
  }

  output(): string {
    return "";
  }

  signal(sig: "SIGTERM" | "SIGKILL"): void {
    this.die({ code: null, signal: sig });
  }

  /** As if the process crashed. */
  crash(): void {
    this.die({ code: 101, signal: null });
  }

  private die(exit: EngineExit): void {
    if (this.exitInfo) return;
    this.exitInfo = exit;
    for (const s of this.sockets) s.destroy();
    this.server.close(() => this.markExited(exit));
  }
}

export class HttpFakeLauncher implements EngineLauncher {
  readonly engines: HttpFakeEngine[] = [];
  readonly received: Received[] = [];
  script: EngineScript = defaultScript();

  launch(spec: LaunchSpec): EngineProcess {
    const engine = new HttpFakeEngine(spec, 20_000 + this.engines.length, () => this.script, this.received);
    this.engines.push(engine);
    return engine;
  }

  paths(prefix = ""): string[] {
    return this.received.filter((r) => r.path.startsWith(prefix)).map((r) => `${r.label} ${r.path}`);
  }

  async stopAll(): Promise<void> {
    for (const e of this.engines) e.signal("SIGKILL");
    await Promise.all(this.engines.map((e) => e.exited));
  }
}

// ─── Temporary directories ─────────────────────────────────────────────────

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
