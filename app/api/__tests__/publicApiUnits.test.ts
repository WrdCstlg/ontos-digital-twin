import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { createTtlCache } from "../services/publicApi/cache";
import { apiProperties, localName, pascal } from "../services/publicApi/model";
import { coerceDeclared } from "../services/publicApi/objects";
import { buildOpenApi } from "../services/publicApi/openapi";
import { NO_MODULES, narrowScopes } from "../services/publicApi/principal";
import { generateTypeScriptSdk } from "../services/publicApi/sdk";
import { authenticateToken, hashToken, newToken } from "../services/publicApi/tokens";
import { isUnavailable } from "../publicApiRoutes";
import { fixtureModel } from "./publicApiFixtures";

vi.mock("../queries/connection", () => ({
  getDb: vi.fn(() => {
    throw new Error("the database must not be asked");
  }),
}));

describe("createTtlCache", () => {
  it("keeps a value for its time to live, measured on the clock it is given", async () => {
    let t = 0;
    const load = vi.fn(async () => `a@${t}`);
    const cache = createTtlCache<string, string>({ ttlMs: 5_000, max: 10, now: () => t });
    await expect(cache.get("a", load)).resolves.toBe("a@0");
    t = 4_999;
    await expect(cache.get("a", load)).resolves.toBe("a@0");
    t = 5_000;
    await expect(cache.get("a", load)).resolves.toBe("a@5000");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent requests, and does not keep a failure", async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error("ECONNREFUSED");
      return "ok";
    });
    const cache = createTtlCache<string, string>({ ttlMs: 60_000, max: 10, now: () => 0 });
    const [a, b] = [cache.get("k", load), cache.get("k", load)];
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(1);
    fail = false;
    await expect(cache.get("k", load)).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("holds at most max keys, dropping the oldest", async () => {
    const cache = createTtlCache<number, number>({ ttlMs: 60_000, max: 3, now: () => 0 });
    for (let k = 0; k < 10; k++) await cache.get(k, async () => k);
    expect(cache.size).toBe(3);
  });
});

describe("narrowScopes", () => {
  it("lets an empty scope mean every module, and narrows two scopes to what both allow", () => {
    expect(narrowScopes([], [])).toEqual([]);
    expect(narrowScopes(["hr"], [])).toEqual(["hr"]);
    expect(narrowScopes([], ["legal"])).toEqual(["legal"]);
    expect(narrowScopes(["hr", "legal"], ["legal", "finance"])).toEqual(["legal"]);
  });

  it("allows no module when two scopes do not overlap, never every module", () => {
    expect(narrowScopes(["hr"], ["legal"])).toEqual([NO_MODULES]);
  });
});

describe("model helpers", () => {
  it("names types and keys for code", () => {
    expect(localName("hr:Person")).toBe("Person");
    expect(localName("https://acme.example/ont#Contract")).toBe("Contract");
    expect(pascal("hr", "Person")).toBe("HrPerson");
    expect(pascal("renew-contract")).toBe("RenewContract");
  });

  it("drops the object's own namespace from property keys, keeping foreign ones", () => {
    expect(apiProperties({ "hr:fullName": "Ada", "fin:costCenter": "CC-1", email: "a@b" }, ["hr"])).toEqual({ fullName: "Ada", "fin:costCenter": "CC-1", email: "a@b" });
  });

  it("types declared properties where the stored text allows, and leaves the rest as stored", () => {
    const person = fixtureModel.objectTypes[0];
    expect(coerceDeclared({ salary: "536000", fullName: "Ada", extra: "7" }, person)).toEqual({ salary: 536000, fullName: "Ada", extra: "7" });
    expect(coerceDeclared({ salary: "a lot" }, person)).toEqual({ salary: "a lot" });
  });
});

describe("API tokens", () => {
  it("have a fixed shape, are unique, and are stored only as a hash", () => {
    const tokens = Array.from({ length: 200 }, () => newToken());
    for (const t of tokens) {
      expect(t.token).toMatch(/^ontos_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
      expect(t.token.startsWith(t.prefix + "_")).toBe(true);
      expect(t.hash).toBe(hashToken(t.token));
      expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(tokens.map((t) => t.token)).size).toBe(200);
  });

  it("refuse a missing or malformed bearer header without asking the database", async () => {
    for (const header of [undefined, "", "Basic abc", "Bearer", "Bearer ontos_short", "Bearer ontos_abcdefgh_" + "x".repeat(31), "Bearer ontos_abcdefgh_" + "!".repeat(32)]) {
      await expect(authenticateToken(header)).resolves.toBeNull();
    }
  });
});

describe("isUnavailable", () => {
  it("recognises a lost database or network anywhere in the cause chain, and nothing else", () => {
    expect(isUnavailable(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isUnavailable(new Error("wrapped", { cause: Object.assign(new Error("y"), { code: "PROTOCOL_CONNECTION_LOST" }) }))).toBe(true);
    expect(isUnavailable(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }))).toBe(false);
    expect(isUnavailable(new TypeError("bug"))).toBe(false);
    expect(isUnavailable(null)).toBe(false);
  });
});

describe("buildOpenApi", () => {
  const doc = buildOpenApi(fixtureModel) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> }; info: Record<string, unknown> };

  it("describes a list and a get per object type, and a preview and a submit per action type", () => {
    for (const p of ["/objects/hr/Person", "/objects/hr/Person/{id}", "/objects/lgl/Contract", "/actions/renew-contract/preview", "/actions/renew-contract/submit", "/openapi.json", "/sdk.ts"]) {
      expect(doc.paths).toHaveProperty([p]);
    }
    expect(doc.info["x-ontology-version"]).toBe(fixtureModel.version);
  });

  it("resolves every $ref it uses", () => {
    const refs = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          if (k === "$ref" && typeof x === "string") refs.add(x);
          else walk(x);
        }
      }
    };
    walk(doc);
    expect(refs.size).toBeGreaterThan(5);
    for (const r of refs) expect(doc.components.schemas).toHaveProperty([r.replace("#/components/schemas/", "")]);
  });

  it("types action parameters, required ones included, and refuses unknown ones", () => {
    const params = doc.components.schemas.RenewContractParams as { required: string[]; additionalProperties: boolean; properties: Record<string, { type: string; enum?: string[] }> };
    expect(params.required).toEqual(["contract", "newEndDate"]);
    expect(params.additionalProperties).toBe(false);
    expect(params.properties.reason.enum).toEqual(["renewal", "extension"]);
  });
});

/** Type-checks TypeScript source in memory, strictly, as a consumer's build would. */
function typeCheck(source: string): string[] {
  const fileName = "/virtual/ontos-client.ts";
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) => (name === fileName ? ts.createSourceFile(name, source, lang) : getSourceFile(name, lang, ...rest));
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === fileName || fileExists(name);
  const program = ts.createProgram([fileName], options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => `${d.start ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}

describe("generateTypeScriptSdk", () => {
  const sdk = generateTypeScriptSdk(fixtureModel, new Date("2026-09-26T00:00:00Z"));

  it("is checked by a checker that does report errors", () => {
    expect(typeCheck("const n: number = \"text\";")).not.toEqual([]);
  });

  it("compiles under strict TypeScript, with no dependencies", () => {
    expect(typeCheck(sdk)).toEqual([]);
    expect(sdk).not.toMatch(/^import /m);
  });

  it("gives callers types that catch mistakes at compile time", () => {
    const usage = `
const client = new OntosClient({ baseUrl: "https://ontos.example", token: "t" });
export async function use() {
  const page = await client.objects("hr:Person").list({ limit: 10, filter: { fullName: "Ada" } });
  const name: string | undefined = page.data[0]?.properties.fullName;
  const salary: number | undefined = page.data[0]?.properties.salary;
  const start: string | undefined = page.data[0]?.properties["start-date"];
  const skills: string[] | undefined = page.data[0]?.properties.skill;
  // @ts-expect-error salary is a number
  const wrong: string | undefined = page.data[0]?.properties.salary;
  await client.actions.submit("renew-contract", { contract: "lgl:Contract/C-1", newEndDate: "2027-01-01", reason: "renewal" });
  // @ts-expect-error newEndDate is required
  await client.actions.submit("renew-contract", { contract: "lgl:Contract/C-1" });
  // @ts-expect-error reason is one of its options
  await client.actions.submit("renew-contract", { contract: "c", newEndDate: "2027-01-01", reason: "whim" });
  // @ts-expect-error no such action type
  await client.actions.submit("no-such-action", {});
  // @ts-expect-error no such object type
  client.objects("hr:Nobody");
  return [name, salary, start, skills, wrong];
}`;
    expect(typeCheck(sdk + usage)).toEqual([]);
  });

  it("keeps ontology text inside its comments: a description cannot end one and inject code", () => {
    expect(sdk).not.toContain("*/ console.log('escaped') /*");
    expect(sdk).toContain("*\\/ console.log('escaped') /*");
  });

  it("records the ontology version it was generated from", () => {
    expect(sdk).toContain(`export const ONTOLOGY_VERSION = "${fixtureModel.version}";`);
  });
});
