/**
 * The engine host's typed client: how it splits failures (a refusal is an
 * EngineRequestError, anything that may pass later is not), its timeouts and
 * AbortSignal, against a canned server; then every call against a live host
 * on the real engine.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EngineRequestError } from "../services/engineErrors";
import { EngineHostClient, EngineHostRefusal, EngineHostUnavailable } from "../services/engineHostClient";
import { ENGINE_JSON_BODY_LIMIT } from "../services/engineHost/types";
import { removeDir, tempDir } from "./engineHostFakes";
import { LIVE_TOKEN, skipLive, startLiveHost, type LiveHost } from "./engineHostLiveSupport";

type Canned = { status: number; body?: string; headers?: Record<string, string>; delayMs?: number };
type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };

let server: http.Server;
let baseUrl: string;
let answer: (req: Seen) => Canned = () => ({ status: 200, body: "{}" });
const seen: Seen[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const request = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(request);
      const reply = answer(request);
      const send = () => {
        if (!res.destroyed) res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers }).end(reply.body ?? "");
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

afterEach(() => {
  seen.length = 0;
  answer = () => ({ status: 200, body: "{}" });
});

const client = (token: string | null = "tok") => new EngineHostClient({ baseUrl, token });
const hostError = (code: string, message = code, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ error: { code, message }, ...extra });

describe("the engine host client, against a canned server", () => {
  it("makes a 4xx answer a refusal: an EngineRequestError, with the host's code and message", async () => {
    answer = () => ({ status: 422, body: hostError("engine_refused", "error at 1:7: expected WHERE") });
    const err = await client().query(1, "SELECT").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineHostRefusal);
    expect(err).toBeInstanceOf(EngineRequestError);
    expect(err).toMatchObject({ status: 422, code: "engine_refused", message: "error at 1:7: expected WHERE" });

    answer = () => ({ status: 409, body: hostError("incarnation_mismatch", "reset since", { incarnation: "inc-2" }) });
    expect(await client().update(1, "INSERT DATA {}", { incarnation: "inc-1" }).catch((e: unknown) => e)).toMatchObject({
      status: 409,
      code: "incarnation_mismatch",
      incarnation: "inc-2",
    });

    answer = () => ({ status: 409, body: hostError("corrupt", "reset it", { state: "corrupt" }) });
    expect(await client().status(1).catch((e: unknown) => e)).toMatchObject({ code: "corrupt", state: "corrupt" });

    for (const status of [400, 401, 404, 413, 415]) {
      answer = () => ({ status, body: "not the host's JSON" });
      const e = await client().status(1).catch((x: unknown) => x);
      expect(e, String(status)).toBeInstanceOf(EngineHostRefusal);
      expect(e, String(status)).toMatchObject({ code: `http_${status}` });
    }
  });

  it("makes a 5xx, 408 or 429 a plain error a later try may get past, with retry-after", async () => {
    answer = () => ({ status: 503, body: hostError("locked", "held elsewhere", { state: "locked" }), headers: { "retry-after": "4" } });
    const err = await client().query(1, "ASK {}").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineHostUnavailable);
    expect(err).not.toBeInstanceOf(EngineRequestError);
    expect(err).toMatchObject({ status: 503, code: "locked", retryAfterMs: 4000, state: "locked" });

    for (const status of [500, 502, 504, 408, 429]) {
      answer = () => ({ status, body: "" });
      const e = await client().status(1).catch((x: unknown) => x);
      expect(e, String(status)).toBeInstanceOf(EngineHostUnavailable);
      expect(e, String(status)).not.toBeInstanceOf(EngineRequestError);
    }
  });

  it("gives up at its timeout, and when the host cannot be reached, with plain errors", async () => {
    answer = () => ({ status: 200, body: "{}", delayMs: 2000 });
    const started = Date.now();
    const slow = await client().status(1, { timeoutMs: 150 }).catch((e: unknown) => e);
    expect(slow).toBeInstanceOf(EngineHostUnavailable);
    expect(slow).toMatchObject({ code: "timeout", status: null });
    expect(Date.now() - started).toBeLessThan(1500);

    const nowhere = new EngineHostClient({ baseUrl: "http://127.0.0.1:1", token: "tok" });
    expect(await nowhere.health().catch((e: unknown) => e)).toMatchObject({ code: "unreachable" });
  });

  it("stops when its caller aborts, with the caller's reason", async () => {
    answer = () => ({ status: 200, body: "{}", delayMs: 2000 });
    const controller = new AbortController();
    const reason = new Error("the job was cancelled");
    setTimeout(() => controller.abort(reason), 50);
    expect(await client().status(1, { signal: controller.signal }).catch((e: unknown) => e)).toBe(reason);
  });

  it("refuses, without asking, a workspace id that is not a positive integer and an update over 2 MiB", async () => {
    for (const ws of [0, -1, 1.5, Number.NaN]) {
      expect(await client().status(ws).catch((e: unknown) => e), String(ws)).toBeInstanceOf(EngineHostRefusal);
    }
    const big = `INSERT DATA { <urn:a> <urn:b> "${"x".repeat(ENGINE_JSON_BODY_LIMIT)}" }`;
    expect(await client().update(1, big, { incarnation: "i" }).catch((e: unknown) => e)).toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
    expect(seen).toHaveLength(0);
  });

  it("sends the token, the incarnation and the content type each route wants, and reads the busy header", async () => {
    answer = (req) =>
      req.url.endsWith("/query")
        ? { status: 200, body: '{"result":true}', headers: { "x-engine-busy-ms": "250" } }
        : { status: 200, body: '{"affected":1,"incarnation":"inc"}' };
    const c = client();

    expect(await c.query(3, "ASK {}")).toEqual({ answer: { result: true }, engineBusyMs: 250 });
    await c.update(3, "INSERT DATA {}", { incarnation: "inc" });
    await c.load(3, "<urn:a> <urn:b> <urn:c> .", { incarnation: "inc", format: "n-triples" });
    await c.shacl(3, "@prefix sh: <http://www.w3.org/ns/shacl#> .");

    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST /v1/workspaces/3/query",
      "POST /v1/workspaces/3/update",
      "POST /v1/workspaces/3/load",
      "POST /v1/workspaces/3/shacl",
    ]);
    expect(seen.every((s) => s.headers.authorization === "Bearer tok")).toBe(true);
    expect(seen[1].headers["x-ontos-incarnation"]).toBe("inc");
    expect(seen[2].headers["content-type"]).toBe("application/n-triples");
    expect(seen[3].headers["content-type"]).toBe("text/turtle");
    expect(JSON.parse(seen[0].body)).toEqual({ query: "ASK {}" });

    await client(null).health();
    expect(seen.at(-1)?.headers.authorization).toBeUndefined();
  });

  it("reads its settings from ENGINE_HOST_URL and ENGINE_HOST_TOKEN", async () => {
    answer = () => ({ status: 200, body: '{"status":"ok"}' });
    const c = EngineHostClient.fromEnv({ ENGINE_HOST_URL: `${baseUrl}/`, ENGINE_HOST_TOKEN: "from-env" });
    expect(await c.health()).toEqual({ status: "ok" });
    expect(seen[0].headers.authorization).toBe("Bearer from-env");
  });
});

describe.skipIf(skipLive())("the engine host client, against a live host", { timeout: 90_000 }, () => {
  let dir: string;
  let live: LiveHost;
  let c: EngineHostClient;

  beforeAll(async () => {
    dir = tempDir("ontos-host-client-");
    live = await startLiveHost(path.join(dir, "root"));
    c = new EngineHostClient({ baseUrl: live.url, token: LIVE_TOKEN });
  });

  afterAll(async () => {
    await live?.close();
    if (dir) await removeDir(dir);
  });

  const EX = "https://ontos.dev/test/";
  const count = async (ws: number) => {
    const { answer } = await c.query(ws, "SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }");
    if (!("results" in answer)) throw new Error("not a SELECT answer");
    return Number(/(\d+)/.exec(answer.results[0].n)![1]);
  };

  it("reads status, resets, updates, loads (a string and a stream) and queries", async () => {
    expect(await c.health()).toEqual({ status: "ok" });
    expect(await c.status(4)).toMatchObject({ workspace: 4, state: "cold", incarnation: null });

    const { incarnation } = await c.reset(4);
    expect(await c.update(4, `INSERT DATA { <${EX}a> <${EX}p> "1" }`, { incarnation })).toMatchObject({ affected: 1, incarnation });
    expect(await c.load(4, `<${EX}b> <${EX}p> "2" .\n`, { incarnation, format: "n-triples" })).toMatchObject({ triplesLoaded: 1 });

    async function* lines() {
      for (let i = 0; i < 3000; i++) yield `<${EX}item/${i}> <${EX}p> "${i}" .\n`;
    }
    const streamed = await c.load(4, Readable.from(lines()), { incarnation, format: "n-triples" });
    expect(streamed).toMatchObject({ triplesLoaded: 3000, incarnation });
    expect(streamed.bytes).toBeGreaterThan(100_000);

    const { answer, engineBusyMs } = await c.query(4, `SELECT ?o WHERE { <${EX}a> <${EX}p> ?o }`);
    expect(answer).toEqual({ variables: ["o"], results: [{ o: '"1"' }] });
    expect(engineBusyMs).toBe(0);
    expect(await count(4)).toBe(3002);
    // The size as the host last saw it: what the store held when it opened, plus loads (not updates).
    expect(await c.status(4)).toMatchObject({ state: "ready", incarnation, triples: 3001 });
  });

  it("refuses a stale incarnation and a query the engine cannot parse, as EngineRequestErrors", async () => {
    const { incarnation } = await c.reset(5);
    const stale = await c.update(5, `INSERT DATA { <${EX}a> <${EX}p> "1" }`, { incarnation: "stale" }).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(EngineRequestError);
    expect(stale).toMatchObject({ code: "incarnation_mismatch", incarnation });

    const bad = await c.query(5, "SELEC nothing").catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(EngineHostRefusal);
    expect(bad).toMatchObject({ status: 422, code: "engine_refused" });
  });

  it("validates with SHACL, reasons as a dry run, validates on scratch, and deletes", async () => {
    const { incarnation } = await c.reset(6);
    await c.update(
      6,
      `INSERT DATA { <${EX}rex> a <${EX}Dog> . <${EX}Dog> <http://www.w3.org/2000/01/rdf-schema#subClassOf> <${EX}Animal> . }`,
      { incarnation },
    );
    const shapes = `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <${EX}> .
ex:DogShape a sh:NodeShape ; sh:targetClass ex:Dog ; sh:property [ sh:path ex:chip ; sh:minCount 1 ] .`;

    const { report } = await c.shacl(6, shapes);
    expect(report).toMatchObject({ conforms: false, violation_count: 1 });

    const { result } = await c.reason(6, { profile: "rdfs" });
    expect(result).toMatchObject({ dry_run: true, profile_used: "rdfs" });
    expect(result.inferred_count).toBeGreaterThanOrEqual(1);
    expect(await count(6)).toBe(2);

    const scratch = await c.scratchValidate({ data: `<${EX}fido> a <${EX}Dog> .`, shapes });
    expect(scratch).toMatchObject({ triplesLoaded: 1, report: { conforms: false, focus_nodes: 1 } });

    await c.deleteWorkspace(6);
    expect(await c.status(6)).toMatchObject({ state: "cold", incarnation: null, pid: null });
  });
});
