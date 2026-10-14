import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { SemanticEngineClient, type ShaclValidationResult, type ShaclViolation } from "../services/semanticEngine";
import { startPrivateEngine, type PrivateEngine } from "./privateEngine";
import {
  ACCEPTS,
  ADDITIONS,
  BASE,
  BASE_BODY,
  CONSTRAINT_CASES,
  RECORD_UNITS,
  REFUSALS,
  REFUSED_NAMES,
  SHAPES,
  UNITS,
  applyChanges,
  fixture,
  iri,
  parseTriples,
  serialize,
} from "./xfnFixtures";

// The tests of section 5 of docs/specs/2026-10-14-xfn-semantic-layer-cycle-1-rerun.md. The rules
// and the class axioms of spec 4.1 are found from this file, so the suite runs from any directory.
const SHAPES_PATH = fileURLToPath(new URL("../../../docs/semantic-layer/xfn-shapes.ttl", import.meta.url));
const CLASSES_PATH = fileURLToPath(new URL("../../../docs/semantic-layer/xfn-classes.ttl", import.meta.url));
const XFN = "https://ontos.dev/ontology/xfn/";
const SH = "PREFIX sh: <http://www.w3.org/ns/shacl#> ";

const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const sorted = (items: string[]) => [...new Set(items)].sort();

/** The unit a result belongs to: the ID its message begins with (T2). */
const unitOf = (v: ShaclViolation) => /^\[(XR-[0-9]{2}[a-z]?)\]/.exec(v.message ?? "")?.[1] ?? `(no unit: ${v.message ?? "no message"})`;

/** A query result's IRI, bare. */
const bare = (t: string) => t.replace(/^<|>$/g, "");

/** A query result's literal that the query passed through ENCODE_FOR_URI, decoded. */
function decoded(t: string): string {
  const m = /^"([^"]*)"(\^\^<[^>]*>)?$/.exec(t);
  if (!m) throw new Error(`not an encoded literal: ${t}`);
  return decodeURIComponent(m[1]);
}

function expectConforms(report: ShaclValidationResult): void {
  expect(report.violations).toEqual([]);
  expect(report.violationCount).toBe(0);
  expect(report.conforms).toBe(true);
}

describe("Cross-Functional Core (xfn): the rules of xfn-shapes.ttl", () => {
  let shapesTtl: string;
  let classesTtl: string;
  // An engine of this file's own: semanticEngine.test.ts clears and loads the shared one, and the two
  // corrupt each other's store whenever vitest runs them at the same time.
  let engine: PrivateEngine;
  let semanticEngine: SemanticEngineClient;

  beforeAll(async () => {
    engine = await startPrivateEngine();
    const before = process.env.OPEN_ONTOLOGIES_URL;
    process.env.OPEN_ONTOLOGIES_URL = engine.url;
    semanticEngine = new SemanticEngineClient();
    if (before === undefined) delete process.env.OPEN_ONTOLOGIES_URL;
    else process.env.OPEN_ONTOLOGIES_URL = before;

    shapesTtl = fs.readFileSync(SHAPES_PATH, "utf8");
    classesTtl = fs.readFileSync(CLASSES_PATH, "utf8");
    // T1: every run logs the engine it validated with and the rules it validated against.
    const health = await semanticEngine.checkHealth();
    console.info(
      `[xfn] engine ${engine.binary} sha256=${sha256(fs.readFileSync(engine.binary))} version=${health.version ?? "unreported"}; ` +
        `xfn-shapes.ttl sha256=${sha256(shapesTtl)}; xfn-classes.ttl sha256=${sha256(classesTtl)}`,
    );
  }, 60_000);

  afterAll(async () => {
    await engine?.stop();
  });

  beforeEach(async () => {
    await semanticEngine.clearStore();
  });

  /** Loads the data, and the class axioms when asked (T3), and validates it against the rules. */
  async function validate(turtle: string, withClasses = false): Promise<ShaclValidationResult> {
    await semanticEngine.loadTurtle(turtle);
    if (withClasses) await semanticEngine.loadTurtle(classesTtl);
    return semanticEngine.validateShacl(shapesTtl);
  }

  // =========================================================================
  // The test's own machinery: refusal cases are built from BASE's triples
  // =========================================================================
  describe("Fixtures", () => {
    it("parses BASE and each addition into exactly the triples the engine reads from the same text", async () => {
      for (const body of [BASE_BODY, ...Object.values(ADDITIONS)]) {
        await semanticEngine.clearStore();
        await semanticEngine.loadTurtle(fixture(body));
        const { results } = await semanticEngine.querySparql("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");
        expect(sorted(parseTriples(body).map((t) => t.join(" ")))).toEqual(sorted(results.map((r) => `${r.s} ${r.p} ${r.o}`)));
        expect(results.length).toBe(parseTriples(body).length);
      }
      expect(BASE.length).toBeGreaterThan(0);
    });

    it("holds the 168 refusal cases of 5.4, each a change BASE can take", () => {
      const ids = REFUSALS.flatMap((r) => r.cases.map((c) => c.id));
      expect(ids).toHaveLength(168);
      expect(new Set(ids).size).toBe(168);
      for (const r of REFUSALS) for (const c of r.cases) expect(() => applyChanges(c.changes), c.id).not.toThrow();
    });

    it("holds the 129 constraints of 4.3, each listed against cases that expect its unit and component", () => {
      expect(CONSTRAINT_CASES).toHaveLength(129);
      expect(CONSTRAINT_CASES.filter((k) => k.component === "sparql")).toHaveLength(15);
      expect(sorted(CONSTRAINT_CASES.map((k) => k.unit))).toEqual(sorted([...UNITS]));
      const cases = new Map(REFUSALS.flatMap((r) => r.cases).map((c) => [c.id, c]));
      for (const k of CONSTRAINT_CASES) {
        for (const id of [...k.cases, ...(k.also ?? [])]) {
          const expected = cases.get(id)?.expected ?? [];
          expect(expected.some(([unit, , component]) => unit === k.unit && component === k.component), `${k.unit} ${k.component} in ${id}`).toBe(true);
        }
      }
    });
  });

  // =========================================================================
  // 5.3 Guards
  // =========================================================================
  describe("GUARD-01: BASE conforms", () => {
    it("alone", async () => {
      expectConforms(await validate(serialize(BASE)));
    });

    it("with the class axioms of xfn-classes.ttl", async () => {
      expectConforms(await validate(serialize(BASE), true));
    });
  });

  describe("GUARD-02: the structure of the rules file", () => {
    beforeEach(async () => {
      await semanticEngine.loadTurtle(shapesTtl);
    });

    /** Each node shape and its sh:targetClass values. */
    async function shapeTargets(): Promise<Map<string, string[]>> {
      const { results } = await semanticEngine.querySparql(`${SH} SELECT ?s ?t WHERE { ?s a sh:NodeShape . OPTIONAL { ?s sh:targetClass ?t } }`);
      const out = new Map<string, string[]>();
      for (const r of results) {
        const list = out.get(bare(r.s)) ?? [];
        if (r.t) list.push(bare(r.t));
        out.set(bare(r.s), list);
      }
      return out;
    }

    /** Each constraint node attached by sh:property or sh:sparql, with its shape and message. */
    async function constraintNodes(): Promise<Array<{ shape: string; node: string; message: string }>> {
      const { results } = await semanticEngine.querySparql(
        `${SH} SELECT ?shape ?n (ENCODE_FOR_URI(?msg) AS ?m) WHERE { ?shape ?kind ?n . FILTER (?kind IN (sh:property, sh:sparql)) ?n sh:message ?msg }`,
      );
      return results.map((r) => ({ shape: bare(r.shape), node: r.n, message: decoded(r.m) }));
    }

    const xfn = (names: readonly string[]) => sorted(names.map((n) => XFN + n));
    const idOf = (message: string) => /^\[([^\]]*)\]/.exec(message)?.[1];

    it("check 1: xfn:RecordShape targets exactly AttributedRecord and the 10 attributed classes", async () => {
      expect(sorted((await shapeTargets()).get(`${XFN}RecordShape`) ?? [])).toEqual(xfn(SHAPES.RecordShape));
    });

    it("check 2: xfn:RefusedClassShape targets exactly the 29 names refused this cycle", async () => {
      expect(sorted((await shapeTargets()).get(`${XFN}RefusedClassShape`) ?? [])).toEqual(xfn(REFUSED_NAMES));
    });

    it("check 3: each every-record unit is one constraint node, attached to xfn:RecordShape", async () => {
      const nodes = await constraintNodes();
      for (const unit of RECORD_UNITS) {
        const mine = nodes.filter((n) => idOf(n.message) === unit);
        expect(sorted(mine.map((n) => n.node)), unit).toHaveLength(1);
        expect(sorted(mine.map((n) => n.shape)), unit).toEqual([`${XFN}RecordShape`]);
      }
    });

    it("check 4: each of the 65 unit IDs begins exactly one message, and no message begins with another ID", async () => {
      const { results } = await semanticEngine.querySparql(`${SH} SELECT ?n (ENCODE_FOR_URI(?msg) AS ?m) WHERE { ?n sh:message ?msg }`);
      const ids = results.map((r) => idOf(decoded(r.m))).filter((id): id is string => id !== undefined);
      for (const unit of UNITS) expect(ids.filter((id) => id === unit), unit).toHaveLength(1);
      expect(ids.filter((id) => !(UNITS as readonly string[]).includes(id))).toEqual([]);
    });

    it("check 5: no sh:select uses MINUS, SERVICE, VALUES, a pre-bound variable bound with AS, or a subquery", async () => {
      const { results } = await semanticEngine.querySparql(`${SH} SELECT (ENCODE_FOR_URI(?q) AS ?e) WHERE { ?n sh:select ?q }`);
      const selects = results.map((r) => decoded(r.e));
      expect(selects).toHaveLength(15);
      for (const q of selects) {
        expect(q, "MINUS, SERVICE or VALUES").not.toMatch(/\b(MINUS|SERVICE|VALUES)\b/i);
        expect(q, "AS binding a pre-bound variable").not.toMatch(/\bAS\s*[$?](this|shapesGraph|currentShape)\b/i);
        expect(q.match(/\bSELECT\b/gi) ?? [], "SELECT keywords").toHaveLength(1);
      }
    });

    it("check 6: each of the 15 node shapes of 4.3 exists with the targets shown", async () => {
      const targets = await shapeTargets();
      for (const [shape, names] of Object.entries(SHAPES)) {
        expect(sorted(targets.get(XFN + shape) ?? ["(no such shape)"]), shape).toEqual(xfn(names));
      }
    });
  });

  // =========================================================================
  // 5.4 Refusal tests: BASE with one change; the (unit, focus node) pairs
  // reported equal the expected set (T4), each with the component it breaks (T2)
  // =========================================================================
  for (const refusal of REFUSALS) {
    describe(`${refusal.id}: ${refusal.title}`, () => {
      for (const kase of refusal.cases) {
        it(`${kase.id}: refused with ${kase.expected.map(([unit, focus]) => `${unit} @ ${focus}`).join(", ")}`, async () => {
          const report = await validate(serialize(applyChanges(kase.changes)));
          expect(sorted(report.violations.map((v) => `${unitOf(v)} @ ${v.focusNode}`))).toEqual(
            sorted(kase.expected.map(([unit, focus]) => `${unit} @ ${iri(focus)}`)),
          );
          expect(sorted(report.violations.map((v) => `${unitOf(v)} @ ${v.focusNode} : ${v.constraint}`))).toEqual(
            sorted(kase.expected.map(([unit, focus, component]) => `${unit} @ ${iri(focus)} : ${component}`)),
          );
          expect(report.conforms).toBe(false);
        });
      }
    });
  }

  // =========================================================================
  // 5.5 Acceptance tests: conforms with no violations, alone and with the
  // class axioms in the same data graph (T3)
  // =========================================================================
  for (const accept of ACCEPTS) {
    describe(`${accept.id}: ${accept.title}`, () => {
      it("conforms alone", async () => {
        expectConforms(await validate(fixture(accept.body)));
      });

      it("conforms with the class axioms of xfn-classes.ttl", async () => {
        expectConforms(await validate(fixture(accept.body), true));
      });
    });
  }
});
