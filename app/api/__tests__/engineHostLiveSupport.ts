/**
 * For the engine host's live tests: a host on the real open-ontologies
 * binary, served over HTTP on a free port with a data root of its own, and a
 * launcher that remembers every engine it started so none outlives a test.
 */
import type { AddressInfo } from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import { findEngineBinary, type HostConfig } from "../services/engineHost/config";
import { EngineHost } from "../services/engineHost/host";
import { ChildProcessLauncher, type EngineLauncher, type EngineProcess, type LaunchSpec } from "../services/engineHost/process";
import { createHostApp } from "../services/engineHost/server";

export const LIVE_TOKEN = "live-test-token-".padEnd(48, "0");

export function liveBinary(): string | null {
  try {
    return findEngineBinary(process.env, path.resolve(import.meta.dirname, "..", ".."));
  } catch {
    return null;
  }
}

/**
 * Whether to skip the live tests: locally, only when no binary is found. In CI
 * a missing binary is a broken pipeline, so the tests run and fail.
 */
export function skipLive(): boolean {
  if (liveBinary() || process.env.CI) return false;
  console.warn("[engine host] live tests skipped: no open-ontologies binary (set OPEN_ONTOLOGIES_BIN)");
  return true;
}

/** Starts real engines and remembers each, so a test can kill one and none outlives the suite. */
export class RecordingLauncher implements EngineLauncher {
  readonly started: EngineProcess[] = [];
  readonly lines: string[] = [];
  private readonly inner: ChildProcessLauncher;

  constructor(bin: string) {
    this.inner = new ChildProcessLauncher(bin, (line) => this.note(line));
  }

  note(line: string): void {
    this.lines.push(line);
    if (this.lines.length > 2000) this.lines.shift();
  }

  launch(spec: LaunchSpec): EngineProcess {
    const proc = this.inner.launch(spec);
    this.started.push(proc);
    return proc;
  }

  /** The running engine with this pid, through its own process handle. */
  byPid(pid: number): EngineProcess {
    const proc = this.started.find((p) => p.pid === pid && !p.exit());
    if (!proc) throw new Error(`no running engine with pid ${pid}`);
    return proc;
  }

  running(): EngineProcess[] {
    return this.started.filter((p) => !p.exit());
  }

  async killAll(): Promise<void> {
    for (const p of this.running()) p.signal("SIGKILL");
    await Promise.all(this.started.map((p) => Promise.race([p.exited, new Promise((r) => setTimeout(r, 5000))])));
  }
}

/** An answer from the host; `json` is its body parsed, or {} when it was not JSON. */
export type Answer = { status: number; headers: Headers; text: string; json: Record<string, unknown>; ms: number };

/** The answer's body, as the type the test expects of it. */
export function body<T>(answer: Answer): T {
  return answer.json as T;
}

export type LiveHost = {
  url: string;
  host: EngineHost;
  launcher: RecordingLauncher;
  call(method: string, route: string, body?: RequestInit["body"], headers?: Record<string, string>): Promise<Answer>;
  close(): Promise<void>;
};

export const JSON_TYPE = { "content-type": "application/json" };

export async function startLiveHost(dataDir: string, overrides: Partial<HostConfig> = {}): Promise<LiveHost> {
  const bin = liveBinary();
  if (!bin) throw new Error("no open-ontologies binary: set OPEN_ONTOLOGIES_BIN");
  const launcher = new RecordingLauncher(bin);
  const log = (line: string) => launcher.note(line);
  const config: HostConfig = {
    dataDir,
    token: LIVE_TOKEN,
    dev: false,
    bind: "127.0.0.1",
    port: 0,
    binPath: bin,
    maxEngines: 8,
    idleMs: 10 * 60_000,
    scratchEngines: 1,
    scratchWaitMs: 10_000,
    loadMaxBytes: 64 * 1024 * 1024,
    scratchMaxBytes: 16 * 1024 * 1024,
    startTimeoutMs: 30_000,
    timeouts: { query: 30_000, update: 30_000, load: 60_000, shacl: 60_000, reason: 60_000, scratch: 60_000 },
    ...overrides,
  };
  const host = await EngineHost.create(config, { launcher, log });
  const app = createHostApp(host, { token: LIVE_TOKEN, log });
  let server: ReturnType<typeof serve> | undefined;
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => resolve(info.port));
  });
  const url = `http://127.0.0.1:${port}`;
  let closed = false;
  return {
    url,
    host,
    launcher,
    async call(method, route, body, headers = {}) {
      const started = Date.now();
      const res = await fetch(url + route, {
        method,
        body,
        headers: { authorization: `Bearer ${LIVE_TOKEN}`, ...headers },
        duplex: "half",
      } as RequestInit);
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // not JSON: leave {}
      }
      return { status: res.status, headers: res.headers, text, json, ms: Date.now() - started };
    },
    async close() {
      if (closed) return;
      closed = true;
      await host.close(1000);
      await new Promise((r) => server!.close(() => r(undefined)));
      await launcher.killAll();
    },
  };
}

export async function waitFor<T>(what: string, probe: () => Promise<T>, done: (v: T) => boolean, withinMs = 15_000): Promise<T> {
  const until = Date.now() + withinMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Every triple in the store, named graphs included. */
export const COUNT_ALL = "SELECT (COUNT(*) AS ?n) WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }";

export function countOf(answer: Answer): number {
  const n = body<{ results?: Array<{ n?: string }> }>(answer).results?.[0]?.n;
  const m = n ? /(\d+)/.exec(n) : null;
  if (!m) throw new Error(`not a count: ${answer.status} ${answer.text.slice(0, 200)}`);
  return Number(m[1]);
}
