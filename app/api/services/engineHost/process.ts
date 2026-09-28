import { spawn } from "node:child_process";
import path from "node:path";

/**
 * One open-ontologies process. The supervisor starts engines only through an
 * EngineLauncher, so its policy can be tested with fake processes.
 */

export type EngineMode = "persistent" | "memory";

export type LaunchSpec = {
  /** For logs: ws-<id> or scratch-<n>. */
  label: string;
  dataDir: string;
  port: number;
  mode: EngineMode;
  /** The engine's own bearer token for /api and /mcp; /health needs none. */
  token: string;
};

export type EngineExit = { code: number | null; signal: string | null; spawnError?: string };

export interface EngineProcess {
  readonly pid: number | null;
  /** Settles once, when the process has exited (or could not be started at all). */
  readonly exited: Promise<EngineExit>;
  exit(): EngineExit | null;
  /**
   * Resolves once this process printed that it listens on its port. A probe of
   * the port alone could be answered by another process that holds it.
   */
  readonly listening: Promise<void>;
  /** The size the engine reported when it opened its persistent store. */
  openedTriples(): number | null;
  /** The last lines it printed. */
  output(): string;
  signal(sig: "SIGTERM" | "SIGKILL"): void;
}

export interface EngineLauncher {
  launch(spec: LaunchSpec): EngineProcess;
}

/**
 * `--data-dir` before the subcommand, a config path inside the data directory
 * (the file need not exist), and never `--idle-ttl-secs`: its evictor clears
 * the store, and a persistent store's clear deletes the data.
 */
export function engineArgs(spec: LaunchSpec): string[] {
  return [
    "--data-dir",
    spec.dataDir,
    "serve-http",
    "--config",
    path.join(spec.dataDir, "config.toml"),
    "--storage-mode",
    spec.mode,
    "--host",
    "127.0.0.1",
    "--port",
    String(spec.port),
  ];
}

// What an engine may inherit. Nothing else: not the host's token, not an
// OPEN_ONTOLOGIES_* setting that would change its storage, token or config.
const INHERITED = ["PATH", "SystemRoot", "windir", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ", "LD_LIBRARY_PATH", "RUST_LOG"];

/** HOME (and USERPROFILE) is the data directory, so `~` in the engine resolves inside it. */
export function engineEnv(spec: LaunchSpec, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  env.HOME = spec.dataDir;
  env.USERPROFILE = spec.dataDir;
  env.NO_COLOR = "1";
  env.OPEN_ONTOLOGIES_TOKEN = spec.token;
  return env;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const LISTENING = /listening on http:\/\/[^\s/]+:(\d+)\/mcp/;
const OPENED = /opened persistent triple store at .* \((\d+) triples\)/;

export type OpenFailure = "locked" | "port_in_use" | "store";

/**
 * Why an engine exited before it was ready, from what it printed.
 * - `locked`: RocksDB's LOCK is held by another process. On Linux "While lock
 *   file: …/LOCK: Resource temporarily unavailable"; on Windows "Failed to
 *   create lock file: …/LOCK: The process cannot access the file because it is
 *   being used by another process" (both observed on v1.3.0).
 * - `port_in_use`: another process took the port between the host picking it
 *   and the engine binding it: "Address already in use (os error 98)", or
 *   os error 10048 on Windows. The store was fine.
 * - `store`: anything else.
 */
export function classifyEarlyExit(output: string): OpenFailure {
  const text = output.replace(ANSI, "");
  if (
    /\bLOCK\b/.test(text) &&
    /(While lock file|Resource temporarily unavailable|being used by another process|lock hold by current process|No locks available)/i.test(
      text,
    )
  ) {
    return "locked";
  }
  if (/address already in use|os error (98|48|10048)\b|only one usage of each socket address/i.test(text)) {
    return "port_in_use";
  }
  return "store";
}

const TAIL_LINES = 40;
const MAX_LINE = 2000;

/** Splits a stream's text into lines, keeping the last few. */
class OutputTail {
  private lines: string[] = [];
  private partial = "";

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    const text = this.partial + chunk;
    const parts = text.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    if (this.partial.length > MAX_LINE) {
      this.add(this.partial);
      this.partial = "";
    }
    for (const line of parts) this.add(line);
  }

  flush(): void {
    if (this.partial) this.add(this.partial);
    this.partial = "";
  }

  private add(raw: string): void {
    const line = raw.replace(ANSI, "").slice(0, MAX_LINE);
    if (!line.trim()) return;
    this.lines.push(line);
    if (this.lines.length > TAIL_LINES) this.lines.shift();
    this.onLine(line);
  }

  text(): string {
    return this.lines.join("\n");
  }
}

class ChildEngine implements EngineProcess {
  readonly pid: number | null;
  readonly exited: Promise<EngineExit>;
  readonly listening: Promise<void>;
  private exitInfo: EngineExit | null = null;
  private opened: number | null = null;
  private readonly tail: OutputTail;
  private readonly child: ReturnType<typeof spawn>;

  constructor(binPath: string, spec: LaunchSpec, log: (line: string) => void) {
    let markListening!: () => void;
    this.listening = new Promise<void>((resolve) => (markListening = resolve));
    this.tail = new OutputTail((line) => {
      const listening = LISTENING.exec(line);
      if (listening && Number(listening[1]) === spec.port) markListening();
      const opened = OPENED.exec(line);
      if (opened) this.opened = Number(opened[1]);
      log(`[engine ${spec.label}] ${line}`);
    });

    this.child = spawn(binPath, engineArgs(spec), {
      env: engineEnv(spec),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.pid = this.child.pid ?? null;

    this.exited = new Promise<EngineExit>((resolve) => {
      let settled = false;
      const settle = (exit: EngineExit) => {
        if (settled) return;
        settled = true;
        this.tail.flush();
        this.exitInfo = exit;
        resolve(exit);
      };
      this.child.on("error", (err) => {
        // The process could not be started (ENOENT, EACCES); 'exit' may never come.
        if (this.child.pid === undefined) settle({ code: null, signal: null, spawnError: err.message });
      });
      this.child.on("exit", (code, signal) => {
        // 'close' follows once the pipes are drained, with the last of the
        // output; wait for it, but not for long.
        const timer = setTimeout(() => settle({ code, signal }), 1000);
        this.child.once("close", () => {
          clearTimeout(timer);
          settle({ code, signal });
        });
      });
    });

    this.child.stdout?.setEncoding("utf8").on("data", (chunk: string) => this.tail.push(chunk));
    this.child.stderr?.setEncoding("utf8").on("data", (chunk: string) => this.tail.push(chunk));
  }

  exit(): EngineExit | null {
    return this.exitInfo;
  }

  openedTriples(): number | null {
    return this.opened;
  }

  output(): string {
    return this.tail.text();
  }

  signal(sig: "SIGTERM" | "SIGKILL"): void {
    if (this.exitInfo) return;
    try {
      this.child.kill(sig);
    } catch {
      // already gone
    }
  }
}

export class ChildProcessLauncher implements EngineLauncher {
  constructor(
    private readonly binPath: string,
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  launch(spec: LaunchSpec): EngineProcess {
    return new ChildEngine(this.binPath, spec, this.log);
  }
}
