/**
 * The engine host's HTTP API, over fake engines that answer as
 * open-ontologies v1.3.0 does: the token, workspace ids, body limits,
 * incarnation fencing, and how the engine's answers and failures map to the
 * host's.
 */
import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOST_REASON } from "../services/engineHost/answers";
import type { HostConfig } from "../services/engineHost/config";
import { EngineHost } from "../services/engineHost/host";
import { createHostApp } from "../services/engineHost/server";
import { ENGINE_BUSY_HEADER, ENGINE_JSON_BODY_LIMIT, INCARNATION_HEADER } from "../services/engineHost/types";
import { HttpFakeLauncher, removeDir, tempDir } from "./engineHostFakes";

const TOKEN = "s".repeat(40);
const auth = { authorization: `Bearer ${TOKEN}` };

let dir: string;
let rootDir: string;
let launcher: HttpFakeLauncher;
let host: EngineHost;
let app: Hono;

async function makeHost(overrides: Partial<HostConfig> = {}): Promise<void> {
  if (host) await host.close(0);
  const config: HostConfig = {
    dataDir: rootDir,
    token: TOKEN,
    dev: false,
    bind: "127.0.0.1",
    port: 0,
    binPath: "unused: engines are fakes",
    maxEngines: 4,
    idleMs: 60_000,
    scratchEngines: 1,
    scratchWaitMs: 200,
    loadMaxBytes: 64 * 1024,
    scratchMaxBytes: 64 * 1024,
    startTimeoutMs: 5_000,
    timeouts: { query: 2_000, update: 2_000, load: 2_000, shacl: 2_000, reason: 2_000, scratch: 2_000 },
    ...overrides,
  };
  host = await EngineHost.create(config, { launcher, log: () => undefined });
  app = createHostApp(host, { token: config.token, log: () => undefined });
}

beforeEach(async () => {
  dir = tempDir("ontos-host-routes-");
  rootDir = path.join(dir, "root");
  launcher = new HttpFakeLauncher();
  await makeHost();
});

afterEach(async () => {
  await host.close(0);
  await launcher.stopAll();
  await removeDir(dir);
});

function call(method: string, route: string, body?: RequestInit["body"], headers: Record<string, string> = {}): Promise<Response> {
  const init = { method, body, headers: { ...auth, ...headers }, duplex: "half" } as RequestInit;
  return Promise.resolve(app.request(route, init));
}
const json = { "content-type": "application/json" };
const query = (ws: number | string, q: string) => call("POST", `/v1/workspaces/${ws}/query`, JSON.stringify({ query: q }), json);
const update = (ws: number, u: string, incarnation?: string) =>
  call("POST", `/v1/workspaces/${ws}/update`, JSON.stringify({ query: u }), {
    ...json,
    ...(incarnation ? { [INCARNATION_HEADER]: incarnation } : {}),
  });
const load = (ws: number, body: RequestInit["body"], incarnation: string, type = "text/turtle") =>
  call("POST", `/v1/workspaces/${ws}/load`, body, { "content-type": type, [INCARNATION_HEADER]: incarnation });
const shacl = (ws: number, shapes: string) => call("POST", `/v1/workspaces/${ws}/shacl`, shapes, { "content-type": "text/turtle" });

async function reset(ws: number): Promise<string> {
  const res = await call("POST", `/v1/workspaces/${ws}/reset`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { incarnation: string }).incarnation;
}

async function status(ws: number): Promise<Record<string, unknown>> {
  return (await (await call("GET", `/v1/workspaces/${ws}/status`)).json()) as Record<string, unknown>;
}

const tempFiles = () => fs.readdirSync(path.join(rootDir, ".tmp"));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("access", () => {
  it("needs the bearer token on every route but /health, and starts nothing for a refused request", async () => {
    expect((await app.request("/health")).status).toBe(200);

    const none = await app.request("/v1/workspaces/1/status");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(await none.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
    for (const authorization of [`Bearer ${"x".repeat(40)}`, TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, "Bearer"]) {
      const res = await app.request("/v1/workspaces/1/query", { method: "POST", headers: { authorization, ...json }, body: "{}" });
      expect(res.status, authorization).toBe(401);
    }
    expect((await app.request("/v1/scratch/validate", { method: "POST" })).status).toBe(401);
    expect(launcher.engines).toHaveLength(0);

    expect((await call("GET", "/v1/workspaces/1/status")).status).toBe(200);
  });

  it("needs no token in development, when started without one", async () => {
    await makeHost({ token: null, dev: true });
    expect((await app.request("/v1/workspaces/1/status")).status).toBe(200);
  });

  it("names a workspace by a positive whole number only, so no request reaches a path", async () => {
    for (const ws of ["0", "-3", "abc", "1.5", "01", "9007199254740993", "%2e%2e", "..%2f..%2fetc", "1%00", "1%2F..%2F.."]) {
      const res = await call("POST", `/v1/workspaces/${ws}/reset`);
      expect([400, 404], ws).toContain(res.status);
    }
    expect(launcher.engines).toHaveLength(0);
    expect(fs.readdirSync(rootDir).sort()).toEqual([".ontos-engine-root", ".tmp", ".trash"]);
    expect(fs.readdirSync(dir)).toEqual(["root"]);
  });

  it("answers an unknown route 404, in JSON", async () => {
    const res = await call("GET", "/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    expect((await call("PUT", "/v1/workspaces/1/query")).status).toBe(404);
  });

  it("answers /health 503 once shutting down, and refuses requests", async () => {
    await host.close(0);
    expect((await app.request("/health")).status).toBe(503);
    const res = await query(1, "ASK {}");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "shutting_down" } });
  });
});

describe("queries and updates", () => {
  it("proxies a query to the workspace's own engine, started on demand, and returns the engine's answer", async () => {
    const res = await query(3, "SELECT ?s WHERE { ?s ?p ?o }");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ variables: ["s"], results: [{ s: "<urn:a>" }] });
    expect(res.headers.get(ENGINE_BUSY_HEADER)).toBe("0");
    expect(launcher.paths("/api/")).toEqual(["ws-3 /api/query"]);
    expect(await status(3)).toMatchObject({ state: "ready", inFlight: 0 });
  });

  it("refuses a query or update over 2 MiB with 413 before it reaches the engine", async () => {
    const incarnation = await reset(1);
    const big = `INSERT DATA { <urn:a> <urn:b> "${"x".repeat(ENGINE_JSON_BODY_LIMIT)}" }`;

    const res = await update(1, big, incarnation);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "payload_too_large" } });
    expect((await query(1, `SELECT * WHERE { ?s ?p "${"y".repeat(ENGINE_JSON_BODY_LIMIT)}" }`)).status).toBe(413);
    expect(launcher.paths("/api/")).toEqual([]);

    const justUnder = `INSERT DATA { <urn:a> <urn:b> "${"x".repeat(ENGINE_JSON_BODY_LIMIT - 200)}" }`;
    expect((await update(1, justUnder, incarnation)).status).toBe(200);
    expect(launcher.paths("/api/update")).toHaveLength(1);
  });

  it("refuses a query that is not {query}, or not JSON", async () => {
    expect((await call("POST", "/v1/workspaces/1/query", "SELECT * {}", { "content-type": "application/sparql-query" })).status).toBe(415);
    expect((await call("POST", "/v1/workspaces/1/query", "{", json)).status).toBe(400);
    expect((await call("POST", "/v1/workspaces/1/query", JSON.stringify({ q: "ASK {}" }), json)).status).toBe(400);
    expect(launcher.engines).toHaveLength(0);
  });

  it("refuses a write without the store's current incarnation, 409, before it reaches the engine", async () => {
    let res = await update(1, "INSERT DATA { <urn:a> <urn:b> <urn:c> }");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "incarnation_mismatch" }, incarnation: null });

    const first = await reset(1);
    res = await update(1, "INSERT DATA { <urn:a> <urn:b> <urn:c> }", "stale");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ incarnation: first });
    expect((await load(1, "<urn:a> <urn:b> <urn:c> .", "stale")).status).toBe(409);
    expect(launcher.paths("/api/update")).toEqual([]);
    expect(launcher.paths("/api/load")).toEqual([]);

    res = await update(1, "INSERT DATA { <urn:a> <urn:b> <urn:c> }", first);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ affected: 1, incarnation: first });

    const second = await reset(1);
    expect(second).not.toBe(first);
    res = await update(1, "INSERT DATA { <urn:a> <urn:b> <urn:c> }", first);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ incarnation: second });
  });
});

describe("the engine's answers", () => {
  it("answers the engine's refusal 422, with its message, or a generic one when the engine lost it", async () => {
    launcher.script.query = () => ({ text: JSON.stringify({ error: "error at 1:10: expected WHERE" }) });
    let res = await query(1, "SELECT");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "engine_refused", message: "error at 1:10: expected WHERE" } });

    launcher.script.query = () => ({ text: "null" });
    res = await query(1, 'SELECT * WHERE { ?s ?p "x }');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "engine_refused", message: LOST_REASON } });

    launcher.script.batch = () => ({
      text: JSON.stringify([{ seq: 0, command: "shacl", result: { raw: '{"error":"Turtle error: unexpected "sh""}' } }]),
    });
    res = await shacl(1, "@prefix sh: <http://www.w3.org/ns/shacl#> .");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { message: 'Turtle error: unexpected "sh"' } });
  });

  it("tells a refusal from an engine that failed (502) or went away (503)", async () => {
    launcher.script.query = () => ({ status: 500, text: "internal error" });
    let res = await query(1, "ASK {}");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "engine_error" } });

    launcher.script.query = () => ({ text: "<html>" });
    expect((await query(1, "ASK {}")).status).toBe(502);

    launcher.script.query = () => ({ text: "", destroy: true });
    res = await query(1, "ASK {}");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "engine_unavailable" } });
  });

  it("answers 504 at the route's timeout, keeps the engine busy until it answers, and stops it at twice the timeout", async () => {
    await makeHost({ timeouts: { query: 300, update: 300, load: 300, shacl: 300, reason: 300, scratch: 300 } });
    launcher.script.query = (q) => ({ text: '{"variables":[],"results":[]}', delayMs: q.includes("stuck") ? 10_000 : 450 });

    const started = Date.now();
    let res = await query(1, "SELECT slow");
    expect(res.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(440);
    expect(await status(1)).toMatchObject({ state: "busy", inFlight: 1 });
    await wait(300);
    expect(await status(1)).toMatchObject({ state: "ready", inFlight: 0 });

    res = await query(1, "SELECT stuck");
    expect(res.status).toBe(504);
    const engine = launcher.engines[0];
    await wait(600);
    expect(engine.exit()).not.toBeNull();
    expect(await status(1)).toMatchObject({ state: "cold", inFlight: 0, pid: null });

    // The next request starts it again.
    launcher.script.query = () => ({ text: '{"result":true}' });
    expect((await query(1, "ASK {}")).status).toBe(200);
    expect(launcher.engines).toHaveLength(2);
  });

  it("says how long the engine had been busy when a request reached it", async () => {
    launcher.script.query = (q) => ({ text: '{"variables":[],"results":[]}', delayMs: q.includes("slow") ? 500 : 0 });
    await query(1, "ASK {}"); // started
    const slow = query(1, "SELECT slow");
    await wait(200);
    expect(await status(1)).toMatchObject({ state: "busy", inFlight: 1, busySince: expect.any(String) });

    const fast = await query(1, "SELECT fast");

    expect(Number(fast.headers.get(ENGINE_BUSY_HEADER))).toBeGreaterThanOrEqual(150);
    expect((await slow).headers.get(ENGINE_BUSY_HEADER)).toBe("0");
  });
});

describe("loads, SHACL and reasoning", () => {
  it("streams a load to a file under the data root, has the engine load it, and deletes it", async () => {
    const incarnation = await reset(1);
    let seen = "";
    let existed = false;
    launcher.script.load = (file) => {
      seen = file;
      existed = fs.existsSync(file);
      return { text: JSON.stringify({ ok: true, triples_loaded: 2 }) };
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<urn:a> <urn:b> <urn:c> .\n"));
        controller.enqueue(new TextEncoder().encode("<urn:a> <urn:b> <urn:d> .\n"));
        controller.close();
      },
    });

    const res = await load(1, body, incarnation, "application/n-triples");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ triplesLoaded: 2, bytes: 52, incarnation });
    expect(existed).toBe(true);
    expect(path.dirname(seen)).toBe(path.join(rootDir, ".tmp"));
    expect(seen.endsWith(".nt")).toBe(true);
    expect(fs.existsSync(seen)).toBe(false);
    expect((await status(1)).triples).toBe(2);
  });

  it("deletes the file when the engine refuses it, refuses other formats (415) and bodies over the cap (413)", async () => {
    const incarnation = await reset(1);
    launcher.script.load = () => ({ text: JSON.stringify({ error: "Turtle error: expected '.'" }) });
    let res = await load(1, "<urn:a> <urn:b>", incarnation, "text/turtle; charset=utf-8");
    expect(res.status).toBe(422);
    expect(tempFiles()).toEqual([]);

    res = await load(1, "{}", incarnation, "application/ld+json");
    expect(res.status).toBe(415);

    res = await load(1, "x".repeat(64 * 1024 + 1), incarnation, "application/trig");
    expect(res.status).toBe(413);
    expect(tempFiles()).toEqual([]);
    expect(launcher.paths("/api/load")).toHaveLength(1);
  });

  it("writes the shapes to a file for SHACL, returns the report, and deletes the file", async () => {
    let shapesFile = "";
    launcher.script.batch = (commands) => {
      shapesFile = commands[0].args[0];
      return {
        text: JSON.stringify([{ seq: 0, command: "shacl", result: { conforms: false, violation_count: 1, focus_nodes: 1, scope: "all_graphs" } }]),
      };
    };
    const res = await shacl(2, "@prefix sh: <http://www.w3.org/ns/shacl#> .");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: { conforms: false, violation_count: 1, focus_nodes: 1, scope: "all_graphs" } });
    expect(launcher.received.find((r) => r.path === "/api/batch")?.body).toBe(JSON.stringify([{ command: "shacl", args: [shapesFile] }]));
    expect(fs.existsSync(shapesFile)).toBe(false);

    expect((await call("POST", "/v1/workspaces/2/shacl", "x", json)).status).toBe(415);
    expect((await shacl(2, "   ")).status).toBe(400);
  });

  it("passes on a report whose conformance is undetermined (no target matched), and calls one without conforms an engine error", async () => {
    const undetermined = { conforms: null, focus_nodes: 0, violation_count: 0, violations: [], warning: "no focus nodes matched" };
    launcher.script.batch = () => ({ text: JSON.stringify([{ seq: 0, command: "shacl", result: undetermined }]) });
    let res = await shacl(2, "@prefix sh: <http://www.w3.org/ns/shacl#> .");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: undetermined });

    launcher.script.batch = () => ({ text: JSON.stringify([{ seq: 0, command: "shacl", result: { focus_nodes: 0 } }]) });
    res = await shacl(2, "@prefix sh: <http://www.w3.org/ns/shacl#> .");
    expect(res.status).toBe(502);
  });

  it("runs a reasoning dry run over MCP, owl-rl unless asked otherwise", async () => {
    let res = await call("POST", "/v1/workspaces/1/reason");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: { dry_run: true, inferred_count: 1 } });
    res = await call("POST", "/v1/workspaces/1/reason", JSON.stringify({ profile: "rdfs" }), json);
    expect(res.status).toBe(200);
    expect(launcher.engines[0].mcp.calls.map((c) => c.args)).toEqual([
      { profile: "owl-rl", materialize: false },
      { profile: "rdfs", materialize: false },
    ]);
    expect(launcher.engines[0].mcp.initializeCount).toBe(1);

    expect((await call("POST", "/v1/workspaces/1/reason", JSON.stringify({ profile: "hermit" }), json)).status).toBe(400);
    launcher.script.tool = () => ({ text: JSON.stringify({ error: "the owl-dl tableaux path does not yet write to it" }) });
    res = await call("POST", "/v1/workspaces/1/reason", JSON.stringify({ profile: "owl-dl" }), json);
    expect(res.status).toBe(422);
  });
});

describe("reset, delete and scratch validation", () => {
  it("reset answers a new incarnation, and delete removes the store", async () => {
    const incarnation = await reset(5);
    expect(incarnation).toMatch(/^[0-9a-f-]{36}$/);
    expect(fs.existsSync(path.join(rootDir, "ws-5", "host.json"))).toBe(true);

    const res = await call("DELETE", "/v1/workspaces/5");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(fs.existsSync(path.join(rootDir, "ws-5"))).toBe(false);
    expect(await status(5)).toMatchObject({ state: "cold", incarnation: null });
  });

  it("validates on a scratch engine emptied before and after, and deletes both files", async () => {
    const res = await call("POST", "/v1/scratch/validate", JSON.stringify({ data: "<urn:a> <urn:b> <urn:c> .", shapes: "@prefix sh: <http://www.w3.org/ns/shacl#> ." }), json);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ triplesLoaded: 1, report: { conforms: true } });
    const updates = launcher.received.filter((r) => r.path === "/api/update").map((r) => JSON.parse(r.body).query);
    expect(updates).toEqual(["DROP ALL", "DROP ALL"]);
    expect(launcher.engines.map((e) => e.spec.mode)).toEqual(["memory"]);
    expect(tempFiles()).toEqual([]);
  });

  it("refuses a scratch validation that is not {data, shapes}", async () => {
    expect((await call("POST", "/v1/scratch/validate", JSON.stringify({ data: "" }), json)).status).toBe(400);
    expect((await call("POST", "/v1/scratch/validate", JSON.stringify({ data: 1, shapes: "x" }), json)).status).toBe(400);
    expect((await call("POST", "/v1/scratch/validate", "x".repeat(64 * 1024 + 1), json)).status).toBe(413);
  });

  it("queues a validation while every scratch engine is busy, for a bounded time, then answers 503", async () => {
    launcher.script.batch = () => ({
      delayMs: 600,
      text: JSON.stringify([{ seq: 0, command: "shacl", result: { conforms: true } }]),
    });
    const body = JSON.stringify({ data: "", shapes: "@prefix sh: <http://www.w3.org/ns/shacl#> ." });
    const first = call("POST", "/v1/scratch/validate", body, json);
    await wait(100);
    const started = Date.now();
    const second = await call("POST", "/v1/scratch/validate", body, json);
    expect(second.status).toBe(503);
    expect(await second.json()).toMatchObject({ error: { code: "scratch_busy" } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(180);
    expect(second.headers.get("retry-after")).toBe("1");
    expect((await first).status).toBe(200);
  });

  it("replaces a scratch engine that stopped answering, so the next request gets an empty one", async () => {
    await makeHost({ timeouts: { query: 2_000, update: 2_000, load: 2_000, shacl: 2_000, reason: 2_000, scratch: 300 } });
    launcher.script.batch = () => ({ delayMs: 2_000, text: "[]" });
    const body = JSON.stringify({ data: "", shapes: "@prefix sh: <http://www.w3.org/ns/shacl#> ." });
    expect((await call("POST", "/v1/scratch/validate", body, json)).status).toBe(504);
    expect(launcher.engines[0].exit()).not.toBeNull();

    launcher.script.batch = () => ({ text: JSON.stringify([{ seq: 0, command: "shacl", result: { conforms: true } }]) });
    expect((await call("POST", "/v1/scratch/validate", body, json)).status).toBe(200);
    expect(launcher.engines).toHaveLength(2);
  });
});
