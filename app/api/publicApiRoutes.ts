import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { actionSubmissions, type ActionSubmission, type Workspace } from "@db/schema";
import { actionKeySchema, type ActionRole } from "@contracts/actions";
import { getDb } from "./queries/connection";
import { RateLimiter, type RateLimitStatus } from "./lib/rateLimit";
import { checkSubmitter } from "./services/actions/engine";
import {
  InvalidStoredDefinition,
  SubmissionConflict,
  loadActionType,
  prepareSubmission,
  submitAction,
  summarisePlan,
  type Prepared,
  type SubmitterInfo,
} from "./services/actions/service";
import { createTtlCache } from "./services/publicApi/cache";
import { loadOntologyModel, type ObjectTypeModel, type OntologyModel } from "./services/publicApi/model";
import { BadQuery, MAX_PAGE, getObject, listObjects } from "./services/publicApi/objects";
import { buildOpenApi } from "./services/publicApi/openapi";
import { resolvePrincipal, type Principal } from "./services/publicApi/principal";
import { generateTypeScriptSdk } from "./services/publicApi/sdk";
import type { TokenScope } from "./services/publicApi/tokens";

/**
 * The public Ontology API, mounted at /api/v1: the contract other systems bind
 * to. Every request goes through one pipeline: who is calling (an API token,
 * or a session for reads), their rate limit, and the workspace's ontology
 * model, which shapes every answer and whose version every response carries
 * (x-ontos-ontology-version), so a generated client can tell when it is stale.
 *
 * Errors are JSON, { error: { code, message, problems? } }, with the status
 * that says what to do: 400 fix the request, 401 get a valid token, 403 this
 * token or role may not, 404 no such thing, 409 submit again, 429 slow down
 * (retry-after), 503 retry shortly. Internals never appear in a message.
 */

type Env = { Variables: { principal: Principal; model: OntologyModel } };
type Ctx = Context<Env>;

/** Per token (or person), across every workspace route and every replica. */
export const publicApiRateLimiter = new RateLimiter("api", { windowMs: 60_000, max: 300 });

const modelCache = createTtlCache<number, OntologyModel>({ ttlMs: 5_000, max: 100 });

/** A workspace's ontology model, loaded at most every few seconds. */
export const ontologyModels = {
  get: (ws: Workspace) => modelCache.get(ws.id, () => loadOntologyModel(ws)),
  forget: (workspaceId: number) => modelCache.forget(workspaceId),
};

const MAX_QUERY = 200;
const MAX_FILTERS = 20;
const MAX_FILTER_VALUE = 500;
const MAX_IRI = 512;

const paramsInput = z
  .record(z.string().max(64), z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]))
  .refine((p) => Object.keys(p).length <= 50, "at most 50 parameters");
const actionBody = z.object({ params: paramsInput.default({}) });

function fail(c: Ctx, status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503, code: string, message: string, problems?: unknown[]) {
  return c.json({ error: { code, message, ...(problems && problems.length ? { problems } : {}) } }, status);
}

/** A database or network failure: the request may well succeed if retried. */
export function isUnavailable(err: unknown): boolean {
  const transient = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR", "ER_LOCK_WAIT_TIMEOUT"]);
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && transient.has(code)) return true;
  }
  return false;
}

function needScope(c: Ctx, scope: TokenScope) {
  const p = c.var.principal;
  if (p.scopes.includes(scope)) return null;
  return p.kind === "session"
    ? fail(c, 401, "token_required", "Writes need an API token: Authorization: Bearer ontos_…")
    : fail(c, 403, "insufficient_scope", `This token lacks the "${scope}" scope.`);
}

/** Whether classIri is typeIri or one of its subclasses, by the model's parent links. */
function isA(model: OntologyModel, classIri: string, typeIri: string): boolean {
  const parent = new Map(model.objectTypes.map((t) => [t.iri, t.parent]));
  const seen = new Set<string>();
  for (let cur: string | null | undefined = classIri; cur && !seen.has(cur); cur = parent.get(cur)) {
    if (cur === typeIri) return true;
    seen.add(cur);
  }
  return false;
}

function typeAt(model: OntologyModel, prefix: string, localName: string): ObjectTypeModel | undefined {
  return model.objectTypes.find((t) => t.prefix === prefix && t.localName === localName);
}

function submitterOf(p: Principal): SubmitterInfo {
  // Never "admin" as the account role: that would pass over the module scope.
  return { name: p.actor, userId: p.userId, userRole: "api", memberRole: p.role, moduleScope: p.moduleScope };
}

export function submissionView(s: ActionSubmission) {
  return {
    id: s.id,
    actionKey: s.actionKey,
    actionVersion: s.actionVersion,
    status: s.status,
    submittedBy: s.submittedBy,
    params: (s.paramsJson ?? {}) as Record<string, unknown>,
    changes: s.status === "applied" ? (s.resultJson ?? null) : null,
    problems: s.status === "rejected" && Array.isArray(s.errorsJson) ? s.errorsJson : [],
    createdAt: s.createdAt.toISOString(),
  };
}

function outcome(prep: Prepared) {
  return { problems: prep.problems, criteria: prep.criteria, changes: summarisePlan(prep.plan), shacl: prep.shacl };
}

async function readAction(c: Ctx) {
  const key = actionKeySchema.safeParse(c.req.param("key"));
  if (!key.success) return { error: fail(c, 404, "not_found", "No such action type.") } as const;
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { error: fail(c, 400, "invalid_json", 'The body must be JSON: { "params": { … } }.') } as const;
  }
  const body = actionBody.safeParse(raw);
  if (!body.success) {
    const problems = body.error.issues.map((i) => ({ code: "invalid_body", message: i.message, path: i.path.join(".") }));
    return { error: fail(c, 400, "invalid_body", 'The body must be { "params": { name: value } }.', problems) } as const;
  }
  const loaded = await loadActionType(c.var.principal.workspace.id, key.data);
  if (!loaded) return { error: fail(c, 404, "not_found", `No action type "${key.data}".`) } as const;
  return { loaded, params: body.data.params } as const;
}

export const publicApi = new Hono<Env>();

publicApi.use("*", async (c, next) => {
  const who = await resolvePrincipal(c.req.raw.headers);
  if (!who.ok) {
    if (who.status === 401) c.header("www-authenticate", 'Bearer realm="ontos"');
    if (who.status === 503) c.header("retry-after", "5");
    return fail(c, who.status, who.code, who.message);
  }
  let limit: RateLimitStatus;
  try {
    limit = await publicApiRateLimiter.check(who.principal.limitKey);
  } catch (err) {
    // Not counted, so neither refused nor let through: retry shortly.
    if (!isUnavailable(err)) console.error("[api/v1] the rate limit could not be checked:", err);
    c.header("retry-after", "5");
    return fail(c, 503, "unavailable", "The rate limit could not be checked just now. Retry in a moment.");
  }
  c.header("x-ratelimit-remaining", String(limit.remaining));
  if (!limit.allowed) {
    c.header("retry-after", String(Math.max(1, Math.ceil(limit.resetMs / 1000))));
    return fail(c, 429, "rate_limited", "Too many requests. Slow down and retry after the time in retry-after.");
  }
  let model: OntologyModel;
  try {
    model = await ontologyModels.get(who.principal.workspace);
  } catch (err) {
    if (!isUnavailable(err)) console.error("[api/v1] loading the ontology model failed:", err);
    c.header("retry-after", "5");
    return fail(c, 503, "unavailable", "The ontology could not be loaded just now. Retry in a moment.");
  }
  c.set("principal", who.principal);
  c.set("model", model);
  c.header("x-ontos-ontology-version", model.version);
  c.header("cache-control", "no-store");
  await next();
});

publicApi.get("/ontology", (c) => needScope(c, "read") ?? c.json(c.var.model));

publicApi.get("/openapi.json", (c) => needScope(c, "read") ?? c.json(buildOpenApi(c.var.model)));

publicApi.get("/sdk.ts", (c) => {
  const refused = needScope(c, "read");
  if (refused) return refused;
  c.header("content-type", "text/plain; charset=utf-8");
  c.header("content-disposition", 'attachment; filename="ontos-client.ts"');
  return c.body(generateTypeScriptSdk(c.var.model));
});

publicApi.get("/objects", async (c) => {
  const refused = needScope(c, "read");
  if (refused) return refused;
  const iri = c.req.query("iri");
  if (!iri || iri.length > MAX_IRI) return fail(c, 400, "invalid_query", `Give the object's IRI: ?iri=… (at most ${MAX_IRI} characters).`);
  const object = await getObject(c.var.model, iri);
  return object ? c.json(object) : fail(c, 404, "not_found", `No object ${iri}.`);
});

publicApi.get("/objects/:prefix/:localName", async (c) => {
  const refused = needScope(c, "read");
  if (refused) return refused;
  const type = typeAt(c.var.model, c.req.param("prefix"), c.req.param("localName"));
  if (!type) return fail(c, 404, "not_found", "No such object type. GET /api/v1/ontology lists them.");

  const url = new URL(c.req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? 50 : /^\d{1,3}$/.test(limitRaw) ? Number(limitRaw) : NaN;
  if (!(limit >= 1 && limit <= MAX_PAGE)) return fail(c, 400, "invalid_query", `limit must be a whole number from 1 to ${MAX_PAGE}.`);
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw === null || cursorRaw === "" ? null : /^\d{1,15}$/.test(cursorRaw) ? Number(cursorRaw) : NaN;
  if (Number.isNaN(cursor)) return fail(c, 400, "invalid_query", "cursor must be the nextCursor of a previous page.");
  const q = url.searchParams.get("q");
  if (q !== null && q.length > MAX_QUERY) return fail(c, 400, "invalid_query", `q is at most ${MAX_QUERY} characters.`);
  const filters: Record<string, string> = {};
  for (const [name, value] of url.searchParams) {
    const m = /^filter\[(.*)\]$/.exec(name);
    if (!m) continue;
    if (value.length > MAX_FILTER_VALUE) return fail(c, 400, "invalid_query", `A filter value is at most ${MAX_FILTER_VALUE} characters.`);
    filters[m[1]] = value;
  }
  if (Object.keys(filters).length > MAX_FILTERS) return fail(c, 400, "invalid_query", `At most ${MAX_FILTERS} filters.`);

  try {
    return c.json(await listObjects(c.var.model, type, { limit, cursor, q: q || null, filters }));
  } catch (err) {
    if (err instanceof BadQuery) return fail(c, 400, "invalid_query", err.message);
    throw err;
  }
});

publicApi.get("/objects/:prefix/:localName/:id", async (c) => {
  const refused = needScope(c, "read");
  if (refused) return refused;
  const type = typeAt(c.var.model, c.req.param("prefix"), c.req.param("localName"));
  if (!type) return fail(c, 404, "not_found", "No such object type. GET /api/v1/ontology lists them.");
  const iri = `${type.iri}/${c.req.param("id")}`;
  if (iri.length > MAX_IRI) return fail(c, 404, "not_found", "No such object.");
  const object = await getObject(c.var.model, iri);
  // An object of another type at that IRI is not one of these.
  if (!object || !isA(c.var.model, object.objectType, type.iri)) return fail(c, 404, "not_found", `No ${type.label} ${iri}.`);
  return c.json(object);
});

publicApi.get("/actions", (c) => {
  const refused = needScope(c, "read");
  if (refused) return refused;
  const me = submitterOf(c.var.principal);
  return c.json(
    c.var.model.actionTypes.map((a) => {
      const denied = checkSubmitter(me, a.minRole as ActionRole, a.module);
      return { ...a, canSubmit: !denied && c.var.principal.scopes.includes("actions"), deniedBecause: denied?.message ?? null };
    }),
  );
});

publicApi.post("/actions/:key/preview", async (c) => {
  const refused = needScope(c, "actions");
  if (refused) return refused;
  const read = await readAction(c);
  if ("error" in read) return read.error;
  const prep = await prepareSubmission(c.var.principal.workspace.id, read.loaded, submitterOf(c.var.principal), read.params);
  return c.json({ canApply: prep.problems.length === 0, ...outcome(prep) });
});

publicApi.post("/actions/:key/submit", async (c) => {
  const refused = needScope(c, "actions");
  if (refused) return refused;
  const read = await readAction(c);
  if ("error" in read) return read.error;
  let result: Awaited<ReturnType<typeof submitAction>>;
  try {
    result = await submitAction(c.var.principal.workspace.id, read.loaded, submitterOf(c.var.principal), read.params);
  } catch (err) {
    if (err instanceof SubmissionConflict) return fail(c, 409, "conflict", "The objects changed while the action was being applied. Preview it again and resubmit.");
    throw err;
  }
  if (!result.submission) {
    const why = result.prepared.problems[0];
    return why?.code === "action_inactive"
      ? fail(c, 400, "action_inactive", why.message)
      : fail(c, 403, why?.code ?? "forbidden", why?.message ?? "Not allowed.", result.prepared.problems);
  }
  return c.json({ submission: submissionView(result.submission), ...outcome(result.prepared) });
});

publicApi.get("/submissions/:id", async (c) => {
  const refused = needScope(c, "read");
  if (refused) return refused;
  const id = c.req.param("id");
  if (!/^\d{1,15}$/.test(id)) return fail(c, 404, "not_found", "No such submission.");
  const [row] = await getDb()
    .select()
    .from(actionSubmissions)
    .where(and(eq(actionSubmissions.id, Number(id)), eq(actionSubmissions.workspaceId, c.var.principal.workspace.id)))
    .limit(1);
  return row ? c.json(submissionView(row)) : fail(c, 404, "not_found", `No submission ${id}.`);
});

publicApi.all("*", (c) => fail(c, 404, "not_found", "No such endpoint. GET /api/v1/openapi.json describes them."));

publicApi.onError((err, c) => {
  if (isUnavailable(err)) {
    c.header("retry-after", "5");
    return fail(c, 503, "unavailable", "Ontos could not answer just now. Retry in a moment.");
  }
  if (err instanceof InvalidStoredDefinition) console.error("[api/v1] invalid stored action definition:", err.message);
  else console.error(`[api/v1] ${c.req.method} ${new URL(c.req.url).pathname} failed:`, err);
  return fail(c, 500, "internal", "Something went wrong on our side.");
});
