import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HostError, badRequest, message, tooLarge } from "./errors";
import type { EngineHost } from "./host";
import {
  ENGINE_BUSY_HEADER,
  ENGINE_JSON_BODY_LIMIT,
  INCARNATION_HEADER,
  LOAD_MEDIA_TYPES,
  REASONING_PROFILES,
  type LoadFormat,
  type ReasoningProfile,
} from "./types";

/**
 * The engine host's HTTP API. Every route but /health needs the bearer token.
 * A workspace is named by a positive integer and nothing else: no request can
 * name a path, a port or an engine.
 */

const MAX_SHAPES_BYTES = 16 * 1024 * 1024;
const MAX_REASON_BODY_BYTES = 64 * 1024;

export function workspaceId(raw: string | undefined): number {
  if (!raw || !/^[1-9][0-9]{0,15}$/.test(raw)) throw badRequest("A workspace id is a positive whole number.");
  const ws = Number(raw);
  if (!Number.isSafeInteger(ws)) throw badRequest("A workspace id is a positive whole number.");
  return ws;
}

function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0].trim().toLowerCase();
}

export function loadFormat(contentType: string | undefined): LoadFormat {
  const type = mediaType(contentType);
  const match = (Object.entries(LOAD_MEDIA_TYPES) as [LoadFormat, string][]).find(([, t]) => t === type);
  if (!match) {
    throw new HostError(
      415,
      "unsupported_media_type",
      `A load is ${Object.values(LOAD_MEDIA_TYPES).join(", ")}; not ${type || "a body without a content type"}.`,
    );
  }
  return match[0];
}

function requireType(c: Context, expected: string, what: string, optional = false): void {
  const type = mediaType(c.req.header("content-type"));
  if (type === expected || (optional && !type)) return;
  throw new HostError(415, "unsupported_media_type", `${what} is ${expected}, not ${type || "a body without a content type"}.`);
}

/** The body as text, refused (413) once it passes `limit` bytes, before it is all read. */
async function readText(c: Context, limit: number, what: string): Promise<string> {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(`${what} is at most ${limit} bytes.`);
  const body = c.req.raw.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw tooLarge(`${what} is at most ${limit} bytes.`);
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(c: Context, limit: number, what: string, emptyAllowed = false): Promise<Record<string, unknown>> {
  const text = await readText(c, limit, what);
  if (!text.trim() && emptyAllowed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest(`${what} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw badRequest(`${what} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Compares digests in constant time, so the answer's timing says nothing about the token. */
export function bearer(token: string | null): MiddlewareHandler {
  const expected = token === null ? null : digest(token);
  return async (c, next) => {
    if (expected) {
      const m = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("authorization") ?? "");
      if (!m || !timingSafeEqual(digest(m[1]), expected)) {
        const err = new HostError(401, "unauthorized", "A valid bearer token is required.");
        return c.json(err.body(), 401, { "www-authenticate": 'Bearer realm="engine-host"' });
      }
    }
    await next();
  };
}

function failure(c: Context, err: HostError): Response {
  const headers: Record<string, string> = {};
  if (err.extra.retryAfterMs !== undefined) headers["retry-after"] = String(Math.max(1, Math.ceil(err.extra.retryAfterMs / 1000)));
  return c.json(err.body(), err.status as ContentfulStatusCode, headers);
}

export function createHostApp(host: EngineHost, opts: { token: string | null; log?: (line: string) => void }): Hono {
  const log = opts.log ?? ((line: string) => console.error(`[engine-host] ${line}`));
  const app = new Hono();
  const busy = (ms: number) => ({ [ENGINE_BUSY_HEADER]: String(ms) });

  // The host's own liveness. Never proxied, so a busy engine cannot hold it up.
  app.get("/health", (c) => (host.closing ? c.json({ status: "stopping" }, 503) : c.json({ status: "ok" })));

  app.use("/v1/*", bearer(opts.token));

  app.get("/v1/workspaces/:ws/status", async (c) => c.json(await host.status(workspaceId(c.req.param("ws")))));

  app.post("/v1/workspaces/:ws/query", async (c) => {
    const ws = workspaceId(c.req.param("ws"));
    requireType(c, "application/json", "A query");
    const body = await readJson(c, ENGINE_JSON_BODY_LIMIT, "A query");
    if (typeof body.query !== "string" || !body.query.trim()) throw badRequest('A query is {"query": "<SPARQL>"}.');
    const { json, busyMs } = await host.query(ws, body.query);
    return c.body(json, 200, { "content-type": "application/json; charset=UTF-8", ...busy(busyMs) });
  });

  app.post("/v1/workspaces/:ws/update", async (c) => {
    const ws = workspaceId(c.req.param("ws"));
    requireType(c, "application/json", "An update");
    const body = await readJson(c, ENGINE_JSON_BODY_LIMIT, "An update");
    if (typeof body.query !== "string" || !body.query.trim()) throw badRequest('An update is {"query": "<SPARQL UPDATE>"}.');
    const { busyMs, ...answer } = await host.update(ws, body.query, c.req.header(INCARNATION_HEADER));
    return c.json(answer, 200, busy(busyMs));
  });

  app.post("/v1/workspaces/:ws/load", async (c) => {
    const ws = workspaceId(c.req.param("ws"));
    const format = loadFormat(c.req.header("content-type"));
    const declared = Number(c.req.header("content-length"));
    const { busyMs, ...answer } = await host.load(
      ws,
      c.req.raw.body,
      format,
      c.req.header(INCARNATION_HEADER),
      Number.isFinite(declared) ? declared : null,
    );
    return c.json(answer, 200, busy(busyMs));
  });

  app.post("/v1/workspaces/:ws/shacl", async (c) => {
    const ws = workspaceId(c.req.param("ws"));
    requireType(c, "text/turtle", "Shapes");
    const shapes = await readText(c, MAX_SHAPES_BYTES, "Shapes");
    if (!shapes.trim()) throw badRequest("The shapes are empty.");
    const { report, busyMs } = await host.shacl(ws, shapes);
    return c.json({ report }, 200, busy(busyMs));
  });

  app.post("/v1/workspaces/:ws/reason", async (c) => {
    const ws = workspaceId(c.req.param("ws"));
    requireType(c, "application/json", "A reasoning request", true);
    const body = await readJson(c, MAX_REASON_BODY_BYTES, "A reasoning request", true);
    const profile = body.profile ?? "owl-rl";
    if (typeof profile !== "string" || !REASONING_PROFILES.includes(profile as ReasoningProfile)) {
      throw badRequest(`profile is one of ${REASONING_PROFILES.join(", ")}.`);
    }
    const { result, busyMs } = await host.reason(ws, profile as ReasoningProfile);
    return c.json({ result }, 200, busy(busyMs));
  });

  app.post("/v1/workspaces/:ws/reset", async (c) => c.json(await host.reset(workspaceId(c.req.param("ws")))));

  app.delete("/v1/workspaces/:ws", async (c) => {
    await host.remove(workspaceId(c.req.param("ws")));
    return c.json({ deleted: true });
  });

  app.post("/v1/scratch/validate", async (c) => {
    requireType(c, "application/json", "A scratch validation");
    const body = await readJson(c, host.config.scratchMaxBytes, "A scratch validation");
    if (typeof body.data !== "string" || typeof body.shapes !== "string") {
      throw badRequest('A scratch validation is {"data": "<Turtle>", "shapes": "<Turtle>"}.');
    }
    if (!body.shapes.trim()) throw badRequest("The shapes are empty.");
    return c.json(await host.scratchValidate(body.data, body.shapes));
  });

  app.notFound((c) => failure(c, new HostError(404, "not_found", "No such route.")));

  app.onError((err, c) => {
    if (err instanceof HostError) return failure(c, err);
    log(`request ${c.req.method} ${new URL(c.req.url).pathname} failed: ${err instanceof Error ? (err.stack ?? message(err)) : String(err)}`);
    return failure(c, new HostError(500, "internal", "The engine host failed unexpectedly."));
  });

  return app;
}
