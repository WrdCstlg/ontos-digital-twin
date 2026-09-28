/**
 * The engine host on the real open-ontologies binary (OPEN_ONTOLOGIES_BIN; CI
 * downloads the pinned Linux release). Each test has a data root of its own
 * and stops every engine it started. Stores stay small: 10^4 triples at most.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostConfig } from "../services/engineHost/config";
import {
  INCARNATION_HEADER,
  type ReasonResult,
  type ScratchValidateAnswer,
  type ShaclReport,
  type WorkspaceEngineStatus,
} from "../services/engineHost/types";
import { removeDir, tempDir } from "./engineHostFakes";
import {
  COUNT_ALL,
  JSON_TYPE,
  LIVE_TOKEN,
  body,
  countOf,
  liveBinary,
  skipLive,
  startLiveHost,
  waitFor,
  type LiveHost,
} from "./engineHostLiveSupport";

const EX = "https://ontos.dev/test/";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const PERSON_SHAPES = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <${EX}> .
ex:PersonShape a sh:NodeShape ; sh:targetClass ex:Person ;
  sh:property [ sh:path ex:email ; sh:minCount 1 ] .`;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const insertData = (triples: string[]) => `INSERT DATA {\n${triples.join("\n")}\n}`;

function person(i: number, withEmail = true): string[] {
  const s = `<${EX}person/${i}>`;
  return [`${s} a <${EX}Person> .`, `${s} <${EX}name> "Person ${i}" .`, ...(withEmail ? [`${s} <${EX}email> "p${i}@acme.com" .`] : [])];
}

let dir: string;
let root: string;
const hosts: LiveHost[] = [];

async function host(overrides: Partial<HostConfig> = {}, dataDir = root): Promise<LiveHost> {
  const h = await startLiveHost(dataDir, overrides);
  hosts.push(h);
  return h;
}

async function reset(h: LiveHost, ws: number): Promise<string> {
  const res = await h.call("POST", `/v1/workspaces/${ws}/reset`);
  expect(res.status, res.text).toBe(200);
  return body<{ incarnation: string }>(res).incarnation;
}

function update(h: LiveHost, ws: number, sparql: string, incarnation?: string) {
  return h.call("POST", `/v1/workspaces/${ws}/update`, JSON.stringify({ query: sparql }), {
    ...JSON_TYPE,
    ...(incarnation ? { [INCARNATION_HEADER]: incarnation } : {}),
  });
}

function query(h: LiveHost, ws: number, sparql: string) {
  return h.call("POST", `/v1/workspaces/${ws}/query`, JSON.stringify({ query: sparql }), JSON_TYPE);
}

async function count(h: LiveHost, ws: number): Promise<number> {
  const res = await query(h, ws, COUNT_ALL);
  expect(res.status, res.text).toBe(200);
  return countOf(res);
}

async function status(h: LiveHost, ws: number): Promise<WorkspaceEngineStatus> {
  return body<WorkspaceEngineStatus>(await h.call("GET", `/v1/workspaces/${ws}/status`));
}

/** The engine running for `ws` now, killed as if it crashed. */
async function killEngine(h: LiveHost, ws: number): Promise<number> {
  const { pid } = await status(h, ws);
  expect(pid).toEqual(expect.any(Number));
  h.launcher.byPid(pid!).signal("SIGKILL");
  return pid!;
}

/** Waits out a failed or locked engine's backoff. */
async function untilRetry(h: LiveHost, ws: number): Promise<void> {
  const { retryAt } = await status(h, ws);
  if (retryAt) await sleep(Math.max(0, Date.parse(retryAt) - Date.now()) + 50);
}

describe.skipIf(skipLive())("the engine host on the real engine", { timeout: 90_000 }, () => {
  beforeEach(() => {
    dir = tempDir("ontos-host-live-");
    root = path.join(dir, "root");
  });

  afterEach(async () => {
    for (const h of hosts.splice(0)) await h.close();
    await removeDir(dir);
  });

  it("starts an engine on demand, and its store outlives the host", async () => {
    const first = await host();
    expect(await status(first, 1)).toMatchObject({ state: "cold", incarnation: null, pid: null });
    const incarnation = await reset(first, 1);
    expect((await update(first, 1, insertData([...person(1), ...person(2)]), incarnation)).status).toBe(200);
    expect(await count(first, 1)).toBe(6);
    expect((await status(first, 1)).pid).toEqual(expect.any(Number));

    await first.close();
    expect(first.launcher.running()).toHaveLength(0);

    const second = await host();
    expect(await status(second, 1)).toMatchObject({ state: "cold", incarnation, pid: null });
    expect(await count(second, 1)).toBe(6);
    expect(await status(second, 1)).toMatchObject({ state: "ready", incarnation, triples: 6 });
  });

  it("stops an idle engine, and opens it again with its data on the next request", async () => {
    const h = await host({ idleMs: 500 });
    const incarnation = await reset(h, 1);
    await update(h, 1, insertData(person(1)), incarnation);
    const { pid } = await status(h, 1);

    await waitFor("the idle engine to stop", () => status(h, 1), (s) => s.state === "cold");
    expect(h.launcher.running()).toHaveLength(0);

    expect(await count(h, 1)).toBe(3);
    const after = await status(h, 1);
    expect(after).toMatchObject({ state: "ready", incarnation });
    expect(after.pid).not.toBe(pid);
  });

  it("starts a killed engine again on the next request after its backoff, with its data", async () => {
    const h = await host();
    const incarnation = await reset(h, 1);
    await update(h, 1, insertData(person(1)), incarnation);

    const pid = await killEngine(h, 1);
    const failed = await waitFor("the host to see the engine exit", () => status(h, 1), (s) => s.state === "failed");
    expect(failed.lastError).toMatch(/exited unexpectedly/);
    const early = await query(h, 1, COUNT_ALL);
    expect(early.status).toBe(503);
    expect(early.headers.get("retry-after")).toBe("1");

    await untilRetry(h, 1);
    expect(await count(h, 1)).toBe(3);
    const after = await status(h, 1);
    expect(after).toMatchObject({ state: "ready", incarnation });
    expect(after.pid).not.toBe(pid);
  });

  it("a second host on the same data root finds the store locked, never corrupt, and deletes nothing", async () => {
    const first = await host();
    const incarnation = await reset(first, 1);
    await update(first, 1, insertData([...person(1), ...person(2)]), incarnation);
    const second = await host();

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await query(second, 1, COUNT_ALL);
      expect(res.status, res.text).toBe(503);
      expect(res.json).toMatchObject({ error: { code: "locked" } });
      expect((await status(second, 1)).state).toBe("locked");
      if (attempt < 2) await untilRetry(second, 1);
    }
    const resetRes = await second.call("POST", "/v1/workspaces/1/reset");
    expect(resetRes.status).toBe(503);
    expect(resetRes.json).toMatchObject({ error: { code: "locked" } });
    const deleteRes = await second.call("DELETE", "/v1/workspaces/1");
    expect(deleteRes.status).toBe(503);
    expect(deleteRes.json).toMatchObject({ error: { code: "locked" } });
    expect((await status(second, 1)).state).toBe("locked");
    expect(JSON.parse(fs.readFileSync(path.join(root, "ws-1", "host.json"), "utf8"))).toMatchObject({ incarnation, corrupt: null });

    // The first host's store is untouched, and still serves.
    expect(await count(first, 1)).toBe(6);
    expect(await status(first, 1)).toMatchObject({ state: "ready", incarnation });

    // Another workspace is the second host's to use.
    expect(await reset(second, 2)).toEqual(expect.any(String));

    // Once the first host lets go, the second opens the store as it was.
    await first.close();
    await untilRetry(second, 1);
    expect(await count(second, 1)).toBe(6);
    expect((await status(second, 1)).incarnation).toBe(incarnation);
  });

  it("answers /health and status at once while an engine is busy, and stops an engine stuck past twice the timeout", async () => {
    const h = await host({ timeouts: { query: 3_000, update: 30_000, load: 60_000, shacl: 60_000, reason: 60_000, scratch: 60_000 } });
    const incarnation = await reset(h, 1);
    await update(h, 1, insertData(range(1000).map((i) => `<${EX}s/${i}> <${EX}p> "v${i}" .`)), incarnation);
    await reset(h, 2);

    // 10^9 rows to count: far longer than the timeout.
    const long = query(h, 1, "SELECT (COUNT(*) AS ?n) WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i }");
    await waitFor("the engine to be busy", () => status(h, 1), (s) => s.state === "busy");

    for (let i = 0; i < 5; i++) {
      const started = Date.now();
      const res = await fetch(`${h.url}/health`);
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(500);
    }
    const busy = await h.call("GET", "/v1/workspaces/1/status");
    expect(busy.ms).toBeLessThan(500);
    expect(busy.json).toMatchObject({ state: "busy", inFlight: 1, busySince: expect.any(String) });
    const other = await query(h, 2, "ASK { ?s ?p ?o }");
    expect(other.status).toBe(200);
    expect(other.ms).toBeLessThan(1_000);

    const res = await long;
    expect(res.status).toBe(504);
    await waitFor("the stuck engine to be stopped", () => status(h, 1), (s) => s.state === "cold", 20_000);
    expect(await count(h, 1)).toBe(1000);
  });

  it("loads a body over 2 MiB, streamed to a file, and deletes the file", async () => {
    const h = await host();
    const incarnation = await reset(h, 1);
    const lines = range(8000).map((i) => `<${EX}item/${i}> <${EX}note> "${"n".repeat(260)} ${i}" .\n`);
    const bytes = lines.reduce((sum, l) => sum + Buffer.byteLength(l), 0);
    expect(bytes).toBeGreaterThan(2 * 1024 * 1024);
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (next >= lines.length) return controller.close();
        controller.enqueue(new TextEncoder().encode(lines.slice(next, next + 500).join("")));
        next += 500;
      },
    });

    const res = await h.call("POST", "/v1/workspaces/1/load", body, {
      "content-type": "application/n-triples",
      [INCARNATION_HEADER]: incarnation,
    });

    expect(res.status, res.text).toBe(200);
    expect(res.json).toEqual({ triplesLoaded: 8000, bytes, incarnation });
    expect(await count(h, 1)).toBe(8000);
    expect(fs.readdirSync(path.join(root, ".tmp"))).toEqual([]);
    expect((await status(h, 1)).triples).toBe(8000);
  });

  it("refuses an update or a load with a wrong incarnation, and it changes nothing", async () => {
    const h = await host();
    const incarnation = await reset(h, 1);
    expect((await update(h, 1, insertData(person(1)), incarnation)).status).toBe(200);
    expect(await count(h, 1)).toBe(3);

    for (const wrong of ["not-the-incarnation", randomUUID(), undefined]) {
      const res = await update(h, 1, insertData(person(2)), wrong);
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({ error: { code: "incarnation_mismatch" }, incarnation });
    }
    const load = await h.call("POST", "/v1/workspaces/1/load", person(3).join("\n"), {
      "content-type": "application/n-triples",
      [INCARNATION_HEADER]: randomUUID(),
    });
    expect(load.status).toBe(409);
    expect(await count(h, 1)).toBe(3);
  });

  it("reasons as a dry run that leaves the store as it was, and again after the engine was killed, through a new MCP session", async () => {
    const h = await host();
    const incarnation = await reset(h, 1);
    const triples = [`<${EX}Dog> <${RDFS_SUBCLASS}> <${EX}Animal> .`, ...range(50).map((i) => `<${EX}dog/${i}> a <${EX}Dog> .`)];
    await update(h, 1, insertData(triples), incarnation);
    const before = await count(h, 1);
    expect(before).toBe(51);

    const reason = () => h.call("POST", "/v1/workspaces/1/reason", JSON.stringify({ profile: "owl-rl" }), JSON_TYPE);
    let res = await reason();
    expect(res.status, res.text).toBe(200);
    const first = body<{ result: ReasonResult }>(res).result;
    expect(first).toMatchObject({ dry_run: true, profile_used: "owl-rl" });
    expect(first.inferred_count).toBeGreaterThanOrEqual(50);
    expect(await count(h, 1)).toBe(before);
    const mcp = h.host.supervisor.mcpClient(1)!;
    const session = mcp.session;
    expect(session).toEqual(expect.any(String));
    expect(mcp.reinitializations).toBe(0);

    await killEngine(h, 1);
    await waitFor("the host to see the engine exit", () => status(h, 1), (s) => s.state === "failed");
    await untilRetry(h, 1);

    res = await reason();
    expect(res.status, res.text).toBe(200);
    expect(body<{ result: ReasonResult }>(res).result.inferred_count).toBeGreaterThanOrEqual(50);
    expect(mcp.reinitializations).toBe(1);
    expect(mcp.session).not.toBe(session);
    expect(await count(h, 1)).toBe(before);
  });

  it("finds a planted SHACL violation, and deletes the shapes file", async () => {
    const h = await host();
    const incarnation = await reset(h, 1);
    await update(h, 1, insertData(range(100).flatMap((i) => person(i, i !== 42))), incarnation);

    const res = await h.call("POST", "/v1/workspaces/1/shacl", PERSON_SHAPES, { "content-type": "text/turtle" });

    expect(res.status, res.text).toBe(200);
    const { report } = body<{ report: ShaclReport }>(res);
    expect(report).toMatchObject({ conforms: false, focus_nodes: 100, violation_count: 1 });
    expect(report.violations?.[0]).toMatchObject({ focus_node: `${EX}person/42`, constraint: "minCount" });
    expect(fs.readdirSync(path.join(root, ".tmp"))).toEqual([]);
  });

  it("validates on a scratch engine, and leaves nothing behind for the next request", async () => {
    const h = await host({ scratchEngines: 1 });
    const validate = (data: string) =>
      h.call("POST", "/v1/scratch/validate", JSON.stringify({ data, shapes: PERSON_SHAPES }), JSON_TYPE);

    let res = await validate([...person(1, false), ...person(2)].join("\n"));
    expect(res.status, res.text).toBe(200);
    expect(res.json).toMatchObject({ triplesLoaded: 5, report: { conforms: false, focus_nodes: 2, violation_count: 1 } });
    expect(body<ScratchValidateAnswer>(res).report.violations?.[0]?.focus_node).toBe(`${EX}person/1`);

    // The same engine, emptied: with no data, it finds no one, and says conformance is undetermined.
    res = await validate("");
    expect(res.json).toMatchObject({ triplesLoaded: 0, report: { conforms: null, focus_nodes: 0, violation_count: 0 } });
    res = await validate(person(3).join("\n"));
    expect(res.json).toMatchObject({ triplesLoaded: 3, report: { conforms: true, focus_nodes: 1 } });

    expect(h.launcher.started).toHaveLength(1);
    expect(fs.readdirSync(root).filter((e) => e.startsWith("ws-"))).toEqual([]);
    expect(fs.readdirSync(path.join(root, ".tmp"))).toEqual([]);
  });

  it("reset leaves an empty store with a new incarnation that fences the old one out; delete removes it", async () => {
    const h = await host();
    const first = await reset(h, 1);
    await update(h, 1, insertData(person(1)), first);
    expect(await count(h, 1)).toBe(3);

    const second = await reset(h, 1);
    expect(second).not.toBe(first);
    expect(await count(h, 1)).toBe(0);
    expect((await update(h, 1, insertData(person(2)), first)).status).toBe(409);
    expect(await count(h, 1)).toBe(0);
    expect((await update(h, 1, insertData(person(2)), second)).status).toBe(200);
    expect(await count(h, 1)).toBe(3);
    expect(await status(h, 1)).toMatchObject({ state: "ready", incarnation: second });

    const deleted = await h.call("DELETE", "/v1/workspaces/1");
    expect(deleted.status).toBe(200);
    expect(fs.existsSync(path.join(root, "ws-1"))).toBe(false);
    expect(await status(h, 1)).toMatchObject({ state: "cold", incarnation: null, pid: null });
    expect(h.launcher.running()).toHaveLength(0);
  });
});

// ─── The built entry point, as a process of its own ────────────────────────

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function bundle(outDir: string): Promise<string> {
  const { build } = await import("esbuild");
  const outfile = path.join(outDir, "engineHost.mjs");
  await build({
    entryPoints: [path.resolve(import.meta.dirname, "..", "engineHost.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
    banner: { js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);" },
  });
  return outfile;
}

async function spawnHost(script: string, dataDir: string) {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: "does-not-exist.env",
      ENGINE_HOST_TOKEN: LIVE_TOKEN,
      ENGINE_HOST_DATA_DIR: dataDir,
      ENGINE_HOST_PORT: String(port),
      ENGINE_HOST_BIN: liveBinary()!,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout!.on("data", (d) => (log += d));
  child.stderr!.on("data", (d) => (log += d));
  const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
  const url = `http://127.0.0.1:${port}`;
  await waitFor("the host to listen", () => fetch(`${url}/health`).then((r) => r.status, () => 0), (s) => s === 200);
  const call = (method: string, route: string, body?: string, headers: Record<string, string> = {}) =>
    fetch(url + route, { method, body, headers: { authorization: `Bearer ${LIVE_TOKEN}`, ...headers } });
  return { child, exited, call, log: () => log };
}

describe.skipIf(skipLive() || process.platform === "win32")("dist/engineHost.js", { timeout: 90_000 }, () => {
  // Windows cannot deliver SIGTERM to a process: it would only be killed.
  let work: string;
  const children: ChildProcess[] = [];

  beforeEach(() => {
    work = tempDir("ontos-host-process-");
  });

  afterEach(async () => {
    for (const c of children.splice(0)) if (c.exitCode === null) c.kill("SIGKILL");
    await removeDir(work);
  });

  it("on SIGTERM stops taking requests, stops its engines and exits 0; the next start reopens the stores", async () => {
    const script = await bundle(work);
    const dataDir = path.join(work, "root");

    const first = await spawnHost(script, dataDir);
    children.push(first.child);
    const { incarnation } = (await (await first.call("POST", "/v1/workspaces/1/reset")).json()) as { incarnation: string };
    const updated = await first.call("POST", "/v1/workspaces/1/update", JSON.stringify({ query: insertData(person(1)) }), {
      ...JSON_TYPE,
      [INCARNATION_HEADER]: incarnation,
    });
    expect(updated.status).toBe(200);
    const { pid } = (await (await first.call("GET", "/v1/workspaces/1/status")).json()) as { pid: number };
    expect(alive(pid)).toBe(true);

    first.child.kill("SIGTERM");
    expect(await first.exited).toBe(0);
    expect(alive(pid)).toBe(false);
    expect(first.log()).toMatch(/SIGTERM/);

    const second = await spawnHost(script, dataDir);
    children.push(second.child);
    const res = await second.call("POST", "/v1/workspaces/1/query", JSON.stringify({ query: COUNT_ALL }), JSON_TYPE);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toMatch(/"\\"3\\"/);
    second.child.kill("SIGTERM");
    expect(await second.exited).toBe(0);
  });
});
