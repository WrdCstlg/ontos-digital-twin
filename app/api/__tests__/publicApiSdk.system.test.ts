import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import type { PrincipalResult } from "../services/publicApi/principal";
import { fixtureModel, fixtureObject } from "./publicApiFixtures";
import { mockWorkspace } from "./testHarness";

/**
 * The generated client against the real routes: the SDK is generated from the
 * model, compiled, loaded, and pointed at the /api/v1 app, whose services are
 * replaced at their edges (database, action engine). What the client sends
 * must be what the routes accept, and what they answer what it expects.
 */

const edge = vi.hoisted(() => ({ principal: null as unknown as PrincipalResult, pages: new Map<string, unknown>() }));

vi.mock("../services/publicApi/principal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/publicApi/principal")>()),
  resolvePrincipal: vi.fn(async () => edge.principal),
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
  loadActionType: vi.fn(async () => ({ actionType: {}, module: { key: "legal" }, definition: {} })),
  prepareSubmission: vi.fn(),
  submitAction: vi.fn(),
}));
vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));

import { getObject, listObjects } from "../services/publicApi/objects";
import { prepareSubmission, submitAction } from "../services/actions/service";
import { ontologyModels, publicApi } from "../publicApiRoutes";
import { generateTypeScriptSdk } from "../services/publicApi/sdk";

type Sdk = {
  ONTOLOGY_VERSION: string;
  OntosApiError: new (...a: unknown[]) => Error & { status: number; code: string; problems: unknown[] };
  OntosClient: new (opts: { baseUrl: string; token: string; fetch?: typeof fetch; onVersionMismatch?: (s: string, c: string) => void }) => {
    objects(type: string): { list(o?: Record<string, unknown>): Promise<{ data: { iri: string }[]; nextCursor: string | null }>; get(id: string): Promise<{ iri: string }> };
    iterate(type: string, o?: Record<string, unknown>): AsyncGenerator<{ iri: string }>;
    object(iri: string): Promise<{ iri: string }>;
    actions: { preview(key: string, params: unknown): Promise<{ canApply: boolean }>; submit(key: string, params: unknown): Promise<{ submission: { id: number; status: string } }> };
    checkVersion(): Promise<{ matches: boolean; server: string; client: string }>;
  };
};

let dir: string;
let sdk: Sdk;
const seen: { url: string; method: string; auth: string | null; body: unknown }[] = [];

/** The app, reached as the client's fetch: every request recorded, then answered by the routes. */
const appFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  seen.push({ url: url.pathname + url.search, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
  expect(url.pathname.startsWith("/api/v1/")).toBe(true);
  return publicApi.request(url.pathname.slice("/api/v1".length) + url.search, init);
};

async function loadSdk(model = fixtureModel): Promise<Sdk> {
  const js = ts.transpileModule(generateTypeScriptSdk(model), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(dir, `ontos-client-${model.version}-${Date.now()}.mjs`);
  writeFileSync(file, js);
  return (await import(pathToFileURL(file).href)) as Sdk;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ontos-sdk-"));
  sdk = await loadSdk();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
beforeEach(() => {
  seen.length = 0;
  ontologyModels.forget(mockWorkspace.id);
  edge.principal = {
    ok: true,
    principal: { kind: "token", workspace: mockWorkspace, role: "editor", moduleScope: [], scopes: ["read", "actions"], actor: "API token 'SDK'", userId: 7, limitKey: `sdk:${++n}` },
  };
  vi.clearAllMocks();
});

const client = (opts: Partial<ConstructorParameters<Sdk["OntosClient"]>[0]> = {}) =>
  new sdk.OntosClient({ baseUrl: "https://ontos.example/", token: "ontos_abcdefgh_" + "A".repeat(32), fetch: appFetch, ...opts });

describe("the generated client against the Ontology API", () => {
  it("lists objects of a type with its filters, sending the token", async () => {
    vi.mocked(listObjects).mockResolvedValue({ data: [fixtureObject("hr:Person/E-1")], nextCursor: null });
    const page = await client().objects("hr:Person").list({ limit: 25, q: "ada", filter: { fullName: "Ada Byron" } });
    expect(page.data.map((o) => o.iri)).toEqual(["hr:Person/E-1"]);
    expect(seen[0]).toMatchObject({ method: "GET", auth: "Bearer ontos_abcdefgh_" + "A".repeat(32) });
    expect(vi.mocked(listObjects).mock.calls[0][2]).toEqual({ limit: 25, cursor: null, q: "ada", filters: { fullName: "Ada Byron" } });
  });

  it("follows the cursor through every page", async () => {
    vi.mocked(listObjects)
      .mockResolvedValueOnce({ data: [fixtureObject("hr:Person/E-1"), fixtureObject("hr:Person/E-2")], nextCursor: "2" })
      .mockResolvedValueOnce({ data: [fixtureObject("hr:Person/E-3")], nextCursor: null });
    const iris: string[] = [];
    for await (const o of client().iterate("hr:Person")) iris.push(o.iri);
    expect(iris).toEqual(["hr:Person/E-1", "hr:Person/E-2", "hr:Person/E-3"]);
    expect(vi.mocked(listObjects).mock.calls.map((c) => c[2].cursor)).toEqual([null, 2]);
  });

  it("gets one object by type and id, and any object by IRI", async () => {
    vi.mocked(getObject).mockImplementation(async (_m, iri) => fixtureObject(iri, "hr:Employee"));
    expect((await client().objects("hr:Person").get("E-0173")).iri).toBe("hr:Person/E-0173");
    expect((await client().object("hr:Person/E 1")).iri).toBe("hr:Person/E 1");
    expect(seen[1].url).toBe("/api/v1/objects?iri=hr%3APerson%2FE%201");
  });

  it("previews and submits an action with its parameters", async () => {
    const plan = { creates: [], modifies: [], deletes: [], linkAdds: [], linkRemoves: [] };
    vi.mocked(prepareSubmission).mockResolvedValue({ problems: [], criteria: [], plan, shacl: { status: "skipped", violations: [] } } as never);
    vi.mocked(submitAction).mockResolvedValue({
      submission: { id: 12, actionKey: "renew-contract", actionVersion: 3, status: "applied", submittedBy: "API token 'SDK'", paramsJson: {}, resultJson: {}, errorsJson: null, createdAt: new Date() },
      prepared: { problems: [], criteria: [], plan, shacl: { status: "skipped", violations: [] } },
    } as never);
    const params = { contract: "lgl:Contract/C-1", newEndDate: "2027-01-01" };
    expect((await client().actions.preview("renew-contract", params)).canApply).toBe(true);
    const result = await client().actions.submit("renew-contract", params);
    expect(result.submission).toMatchObject({ id: 12, status: "applied" });
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ["POST", "/api/v1/actions/renew-contract/preview", { params }],
      ["POST", "/api/v1/actions/renew-contract/submit", { params }],
    ]);
    expect(vi.mocked(submitAction).mock.calls[0][3]).toEqual(params);
  });

  it("raises a typed error with the server's code and reasons", async () => {
    vi.mocked(submitAction).mockResolvedValue({ submission: null, prepared: { problems: [{ code: "forbidden_role", message: "needs ontologist" }] } } as never);
    const err = await client().actions.submit("renew-contract", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(sdk.OntosApiError);
    expect(err).toMatchObject({ status: 403, code: "forbidden_role", problems: [{ code: "forbidden_role" }] });
    edge.principal = { ok: false, status: 401, code: "invalid_token", message: "revoked" };
    await expect(client().objects("hr:Person").list()).rejects.toMatchObject({ status: 401, code: "invalid_token" });
  });

  it("notices, once, when the server's ontology is not the one it was generated from", async () => {
    const stale = await loadSdk({ ...fixtureModel, version: "000000000000" });
    const mismatch = vi.fn();
    const c = new stale.OntosClient({ baseUrl: "https://ontos.example", token: "t", fetch: appFetch, onVersionMismatch: mismatch });
    expect(await c.checkVersion()).toEqual({ matches: false, server: fixtureModel.version, client: "000000000000" });
    await c.checkVersion();
    expect(mismatch).toHaveBeenCalledTimes(1);
    expect(mismatch).toHaveBeenCalledWith(fixtureModel.version, "000000000000");
    expect(await client().checkVersion()).toMatchObject({ matches: true });
  });
});
