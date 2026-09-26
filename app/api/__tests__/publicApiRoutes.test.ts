import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { Principal, PrincipalResult } from "../services/publicApi/principal";
import { fixtureModel, fixtureObject } from "./publicApiFixtures";
import { mockWorkspace } from "./testHarness";

const state = vi.hoisted(() => ({
  principal: null as unknown as PrincipalResult,
  wheres: [] as unknown[],
  rows: [] as unknown[][],
}));

vi.mock("../services/publicApi/principal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/publicApi/principal")>()),
  resolvePrincipal: vi.fn(async () => state.principal),
}));
vi.mock("../services/publicApi/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/publicApi/model")>()),
  loadOntologyModel: vi.fn(async () => fixtureModel),
}));
vi.mock("../services/publicApi/objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/publicApi/objects")>()),
  listObjects: vi.fn(),
  getObject: vi.fn(),
}));
vi.mock("../services/actions/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/actions/service")>()),
  loadActionType: vi.fn(),
  prepareSubmission: vi.fn(),
  submitAction: vi.fn(),
}));
vi.mock("../queries/connection", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      from: self,
      limit: self,
      orderBy: self,
      where: (w: unknown) => {
        state.wheres.push(w);
        return c;
      },
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(state.rows.shift() ?? []).then(resolve, reject),
    });
    return c;
  };
  return { getDb: vi.fn(() => ({ select: () => chain() })) };
});

import { BadQuery, getObject, listObjects } from "../services/publicApi/objects";
import { loadOntologyModel } from "../services/publicApi/model";
import { SubmissionConflict, loadActionType, prepareSubmission, submitAction } from "../services/actions/service";
import { ontologyModels, publicApi } from "../publicApiRoutes";

let tokenId = 0;
function token(over: Partial<Principal> = {}): PrincipalResult {
  tokenId++;
  return {
    ok: true,
    principal: {
      kind: "token",
      workspace: mockWorkspace,
      role: "editor",
      moduleScope: [],
      scopes: ["read", "actions"],
      actor: "API token 'CI' (ontos_abcdefgh…)",
      userId: 7,
      limitKey: `token:${tokenId}`,
      ...over,
    },
  };
}

const get = (path: string) => publicApi.request(path);
const post = (path: string, body: unknown, raw = false) =>
  publicApi.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string; problems?: unknown[] } }).error;

const prepared = (problems: { code: string; message: string }[] = []) => ({
  loaded: {},
  values: {},
  objects: new Map(),
  criteria: [],
  plan: { creates: [], modifies: [], deletes: [], linkAdds: [], linkRemoves: [] },
  shacl: { status: "skipped", violations: [] },
  problems,
});

beforeEach(() => {
  state.principal = token();
  state.wheres.length = 0;
  state.rows.length = 0;
  ontologyModels.forget(mockWorkspace.id);
  vi.mocked(loadActionType).mockResolvedValue({ actionType: {}, module: { key: "legal" }, definition: {} } as never);
});
afterEach(() => vi.clearAllMocks());

describe("who may call", () => {
  it("refuses a caller without a valid token or session: 401, with how to authenticate", async () => {
    state.principal = { ok: false, status: 401, code: "invalid_token", message: "The API token is missing, malformed, unknown, revoked or expired." };
    const res = await get("/ontology");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="ontos"');
    expect((await errorOf(res)).code).toBe("invalid_token");
  });

  it("answers 503 with retry-after when the token could not be checked, never 401", async () => {
    state.principal = { ok: false, status: 503, code: "unavailable", message: "…" };
    const res = await get("/ontology");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("lets a session read, and asks it for a token to write", async () => {
    state.principal = token({ kind: "session", scopes: ["read"] });
    expect((await get("/ontology")).status).toBe(200);
    const res = await post("/actions/renew-contract/submit", { params: {} });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("token_required");
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("holds a token to its scopes: no read, no objects; no actions, no submissions", async () => {
    state.principal = token({ scopes: ["actions"] });
    const res = await get("/objects/hr/Person");
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("insufficient_scope");
    state.principal = token({ scopes: ["read"] });
    expect((await post("/actions/renew-contract/preview", { params: {} })).status).toBe(403);
    expect(prepareSubmission).not.toHaveBeenCalled();
  });

  it("limits each token to 300 requests a minute, then says when to retry", async () => {
    state.principal = token();
    for (let i = 0; i < 300; i++) expect((await get("/ontology")).status).toBe(200);
    const res = await get("/ontology");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    state.principal = token(); // another token is not held back
    expect((await get("/ontology")).status).toBe(200);
  });
});

describe("every answer", () => {
  it("carries the ontology version and is not cached", async () => {
    const res = await get("/ontology");
    expect(res.headers.get("x-ontos-ontology-version")).toBe(fixtureModel.version);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("loads the ontology model once per workspace across requests", async () => {
    await get("/ontology");
    await get("/actions");
    await get("/openapi.json");
    expect(loadOntologyModel).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the ontology cannot be loaded, and 404 as JSON for unknown paths", async () => {
    vi.mocked(loadOntologyModel).mockRejectedValueOnce(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }));
    expect((await get("/ontology")).status).toBe(503);
    const res = await get("/no/such/thing");
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("not_found");
  });

  it("turns a lost database into 503 and any other failure into a 500 that names no internals", async () => {
    vi.mocked(getObject).mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
    expect((await get("/objects?iri=hr:Person/E-1")).status).toBe(503);
    vi.mocked(getObject).mockRejectedValueOnce(new Error("Unknown column 'secretColumn' in 'field list'"));
    const res = await get("/objects?iri=hr:Person/E-1");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secretColumn");
  });
});

describe("GET /objects/{prefix}/{type}", () => {
  it("passes a page request through, parsed", async () => {
    vi.mocked(listObjects).mockResolvedValue({ data: [fixtureObject("hr:Person/E-1")], nextCursor: "41" });
    const res = await get("/objects/hr/Person?limit=2&cursor=40&q=ada&filter[fullName]=Ada%20Byron&filter[salary]=1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nextCursor: "41" });
    const [model, type, query] = vi.mocked(listObjects).mock.calls[0];
    expect(model).toBe(fixtureModel);
    expect(type.iri).toBe("hr:Person");
    expect(query).toEqual({ limit: 2, cursor: 40, q: "ada", filters: { fullName: "Ada Byron", salary: "1" } });
  });

  it("refuses a bad page request with 400 and says why", async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `filter[p${i}]=x`).join("&");
    for (const qs of ["limit=0", "limit=201", "limit=ten", "limit=-1", "cursor=abc", "cursor=1e9", `q=${"x".repeat(201)}`, tooMany, `filter[a]=${"x".repeat(501)}`]) {
      const res = await get(`/objects/hr/Person?${qs}`);
      expect(res.status, qs).toBe(400);
      expect((await errorOf(res)).code).toBe("invalid_query");
    }
    expect(listObjects).not.toHaveBeenCalled();
  });

  it("says 400 for a filter on something that is not a property name", async () => {
    vi.mocked(listObjects).mockRejectedValueOnce(new BadQuery(`"a b" is not a property name`));
    const res = await get("/objects/hr/Person?filter[a%20b]=1");
    expect(res.status).toBe(400);
  });

  it("says 404 for a type the ontology does not have", async () => {
    expect((await get("/objects/hr/Nobody")).status).toBe(404);
  });
});

describe("GET /objects/{prefix}/{type}/{id}", () => {
  it("finds the object at the type's IRI, a subclass's object included", async () => {
    vi.mocked(getObject).mockResolvedValue(fixtureObject("hr:Person/E-1", "hr:Employee"));
    const res = await get("/objects/hr/Person/E-1");
    expect(res.status).toBe(200);
    expect(vi.mocked(getObject).mock.calls[0][1]).toBe("hr:Person/E-1");
  });

  it("is 404 for an object of another type at that IRI", async () => {
    vi.mocked(getObject).mockResolvedValue(fixtureObject("hr:Person/E-1", "lgl:Contract"));
    expect((await get("/objects/hr/Person/E-1")).status).toBe(404);
  });
});

describe("actions", () => {
  it("lists action types with whether this token may submit each", async () => {
    state.principal = token({ role: "editor" });
    const list = (await (await get("/actions")).json()) as { key: string; canSubmit: boolean; deniedBecause: string | null }[];
    expect(list.find((a) => a.key === "renew-contract")).toMatchObject({ canSubmit: true, deniedBecause: null });
    expect(list.find((a) => a.key === "record-termination")?.canSubmit).toBe(false);
  });

  it("submits as the token, never as a system administrator, so the module scope holds", async () => {
    state.principal = token({ role: "admin", moduleScope: ["hr"] });
    vi.mocked(prepareSubmission).mockResolvedValue(prepared() as never);
    await post("/actions/renew-contract/preview", { params: { newEndDate: "2027-01-01" } });
    const submitter = vi.mocked(prepareSubmission).mock.calls[0][2];
    expect(submitter).toMatchObject({ name: "API token 'CI' (ontos_abcdefgh…)", userId: 7, memberRole: "admin", moduleScope: ["hr"] });
    expect(submitter.userRole).not.toBe("admin");
  });

  it("previews without applying", async () => {
    vi.mocked(prepareSubmission).mockResolvedValue(prepared([{ code: "criterion_failed", message: "The contract is not active" }]) as never);
    const res = await post("/actions/renew-contract/preview", { params: { contract: "lgl:Contract/C-1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ canApply: false, problems: [{ code: "criterion_failed" }] });
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("returns an applied submission", async () => {
    vi.mocked(submitAction).mockResolvedValue({
      submission: { id: 9, actionKey: "renew-contract", actionVersion: 3, status: "applied", submittedBy: "API token 'CI'", paramsJson: { a: 1 }, resultJson: { created: [] }, errorsJson: null, createdAt: new Date("2026-09-26T00:00:00Z") },
      prepared: prepared(),
    } as never);
    const res = await post("/actions/renew-contract/submit", { params: { a: 1 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ submission: { id: 9, status: "applied", params: { a: 1 }, changes: { created: [] }, problems: [], createdAt: "2026-09-26T00:00:00.000Z" } });
  });

  it("answers a permission refusal 403 with its reasons, an inactive action 400, and a conflict 409", async () => {
    vi.mocked(submitAction).mockResolvedValueOnce({ submission: null, prepared: prepared([{ code: "forbidden_role", message: "needs ontologist" }]) } as never);
    const res = await post("/actions/renew-contract/submit", { params: {} });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ code: "forbidden_role", problems: [{ code: "forbidden_role" }] });
    vi.mocked(submitAction).mockResolvedValueOnce({ submission: null, prepared: prepared([{ code: "action_inactive", message: "draft" }]) } as never);
    expect((await post("/actions/renew-contract/submit", { params: {} })).status).toBe(400);
    vi.mocked(submitAction).mockRejectedValueOnce(new SubmissionConflict("changed"));
    expect((await post("/actions/renew-contract/submit", { params: {} })).status).toBe(409);
  });

  it("refuses a malformed body or key before touching anything", async () => {
    expect((await post("/actions/renew-contract/submit", "{not json", true)).status).toBe(400);
    expect((await post("/actions/renew-contract/submit", { params: { x: { nested: true } } })).status).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}`, 1]));
    expect((await post("/actions/renew-contract/submit", { params: many })).status).toBe(400);
    expect((await post("/actions/Not_A_Key!/submit", { params: {} })).status).toBe(404);
    vi.mocked(loadActionType).mockResolvedValueOnce(null);
    expect((await post("/actions/no-such-action/submit", { params: {} })).status).toBe(404);
    expect(submitAction).not.toHaveBeenCalled();
  });
});

describe("GET /submissions/{id}", () => {
  it("looks only in the caller's workspace", async () => {
    const res = await get("/submissions/9");
    expect(res.status).toBe(404);
    const { sql, params } = new MySqlDialect().sqlToQuery(state.wheres[0] as SQL);
    expect(sql).toContain("`action_submissions`.`workspaceId`");
    expect(params).toEqual([9, mockWorkspace.id]);
  });

  it("is 404 for an id that is not a number", async () => {
    expect((await get("/submissions/9%20OR%201=1")).status).toBe(404);
    expect(state.wheres).toHaveLength(0);
  });
});

describe("the generated artefacts", () => {
  it("serves the OpenAPI document and the TypeScript client for the caller's ontology", async () => {
    const doc = (await (await get("/openapi.json")).json()) as { openapi: string; info: { "x-ontology-version": string } };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info["x-ontology-version"]).toBe(fixtureModel.version);
    const sdk = await get("/sdk.ts");
    expect(sdk.headers.get("content-disposition")).toContain("ontos-client.ts");
    expect(await sdk.text()).toContain(`ONTOLOGY_VERSION = "${fixtureModel.version}"`);
  });
});
