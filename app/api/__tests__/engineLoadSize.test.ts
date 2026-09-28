/**
 * A graph of any size loads. The engine refuses a request body over 2 MiB, and
 * a workspace was synced in one request, so above about 39k instance triples
 * it could not be synced at all. A graph is now cut between subjects into
 * documents that fit (packTurtle), each declaring the prefixes, and loaded one
 * after another.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  kgEdges,
  kgNodes,
  ontologyClasses,
  ontologyModules,
  ontologyProperties,
  type KgEdge,
  type KgNode,
  type OntologyClass,
  type OntologyProperty,
} from "@db/schema";
import {
  buildPrefixMap,
  datatypeRanges,
  knowledgeGraphSubjects,
  knowledgeGraphToTurtle,
  modulePrefixes,
  packTurtle,
  serializePrefixes,
  subjectToTurtle,
  type TurtleSubject,
} from "../services/rdfBridge";
import { EngineRequestError, SemanticEngineClient } from "../services/semanticEngine";
import { startPrivateEngine, type PrivateEngine } from "./privateEngine";
import { rdfModule } from "./rdfFixtures";

// syncWorkspace reads these rows; the filters are the database's business.
const rows = vi.hoisted(() => new Map<unknown, unknown[]>());
vi.mock("../queries/connection", () => ({
  getDb: () => ({ select: () => ({ from: (table: unknown) => ({ where: async () => rows.get(table) ?? [] }) }) }),
}));

/** Bytes a document takes in the request that carries it: in a JSON string, UTF-8. */
const bodyBytes = (doc: string) => Buffer.byteLength(JSON.stringify(doc), "utf8") - 2;
const ENGINE_LIMIT = 2 * 1024 * 1024;

const prefixes = buildPrefixMap([rdfModule(1, "hr", "hr")]);
const header = serializePrefixes(prefixes);
const people = (n: number, extra: (i: number) => string[] = () => []): TurtleSubject[] =>
  Array.from({ length: n }, (_, i) => ({
    subject: `hr:Person_${i}`,
    // Quotes, a backslash and characters of 2, 3 and 4 bytes: what escaping and UTF-8 make larger.
    statements: [`a hr:Person`, `rdfs:label "Pérson ${i} \\"№\\" 😀 \\\\"`, ...extra(i)],
  }));

describe("packTurtle", () => {
  it("keeps every document within the limit, each with the prefixes, every subject whole and in order", () => {
    const subjects = people(3000);
    const docs = packTurtle(prefixes, subjects, 20_000);
    expect(docs.length).toBeGreaterThan(5);
    expect(docs.length).toBeLessThan(subjects.length / 10);
    for (const doc of docs) {
      expect(bodyBytes(doc)).toBeLessThanOrEqual(20_000);
      expect(doc.startsWith(header)).toBe(true);
    }
    expect(docs.map((d) => d.slice(header.length + 1)).join("\n")).toBe(subjects.map(subjectToTurtle).join("\n"));
  });

  it("splits only a subject no document can hold, between its statements, repeating the subject", () => {
    const big: TurtleSubject = { subject: "hr:Big", statements: Array.from({ length: 4000 }, (_, i) => `hr:p${i} "value ${i}"`) };
    const subjects = [...people(10), big, ...people(10).map((s) => ({ ...s, subject: `${s.subject}_after` }))];
    const docs = packTurtle(prefixes, subjects, 20_000);
    for (const doc of docs) expect(bodyBytes(doc)).toBeLessThanOrEqual(20_000);
    const all = docs.join("");
    for (const s of subjects.filter((s) => s !== big)) expect(all.split(subjectToTurtle(s)).length - 1, s.subject).toBe(1);
    // Every statement of the big subject once, in order, each part a statement of its own subject.
    const said = docs.flatMap((d) => [...d.matchAll(/hr:p(\d+) "value \1"/g)].map((m) => Number(m[1])));
    expect(said).toEqual(big.statements.map((_, i) => i));
    expect(all.split("hr:Big hr:p").length - 1).toBeGreaterThan(1);
  });

  it("refuses a statement no request can carry, rather than load a graph without it", () => {
    const huge: TurtleSubject = { subject: "hr:Huge", statements: ["a hr:Person", `rdfs:comment "${"x".repeat(30_000)}"`] };
    expect(() => packTurtle(prefixes, [huge], 20_000)).toThrow(/^hr:Huge has a statement of 30017 bytes, more than one request/);
    expect(() => packTurtle(prefixes, people(1), 100)).toThrow(/prefixes alone/);
  });

  it("makes no document of nothing", () => {
    expect(packTurtle(prefixes, [], 20_000)).toEqual([]);
  });
});

describe("loading a large graph into the engine", () => {
  let engine: PrivateEngine;
  let client: SemanticEngineClient;

  beforeAll(async () => {
    engine = await startPrivateEngine();
    const before = process.env.OPEN_ONTOLOGIES_URL;
    process.env.OPEN_ONTOLOGIES_URL = engine.url;
    client = new SemanticEngineClient();
    if (before === undefined) delete process.env.OPEN_ONTOLOGIES_URL;
    else process.env.OPEN_ONTOLOGIES_URL = before;
  }, 60_000);

  afterAll(async () => {
    await engine?.stop();
  });

  const count = async () => {
    const r = await client.querySparql("SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }");
    return Number(/\d+/.exec(r.results[0]?.n ?? "")?.[0]);
  };

  it("syncs a workspace far over the old single-request limit, every triple of it", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const modules = [rdfModule(1, "finance", "fin")];
    const klass = (id: number, iri: string, parentId: number | null): OntologyClass => ({
      id, moduleId: 1, iri, label: iri, parentId, definition: null, isCustom: false, deprecated: false, shaclJson: null, createdAt: at,
    });
    const property = (id: number, iri: string, kind: "object" | "datatype", range: { classId?: number; datatype?: string }): OntologyProperty => ({
      id, moduleId: 1, iri, label: iri, kind, domainClassId: 2, rangeClassId: range.classId ?? null, rangeDatatype: range.datatype ?? null,
      cardinality: null, definition: null, createdAt: at,
    });
    const classes = [klass(1, "fin:Account", null), klass(2, "fin:LedgerAccount", 1)];
    const properties = [property(1, "fin:balance", "datatype", { datatype: "xsd:decimal" }), property(2, "fin:parentAccount", "object", { classId: 2 })];
    const N = 10_000;
    const nodes: KgNode[] = Array.from({ length: N }, (_, i) => ({
      id: i + 1, workspaceId: 1, moduleKey: "finance", classIri: "fin:LedgerAccount", iri: `fin:LedgerAccount/A-${i}`, label: `Ledger account ${i}`,
      propsJson: { balance: "1234.50", owner: `Owner of ledger account number ${i}`, openedOn: "2024-01-31", code: `A-${i}` },
      sourceMappingId: null, sourceSubmissionId: null, createdAt: at, updatedAt: at, deletedAt: null,
    }));
    const edges: KgEdge[] = nodes.map((n, i) => ({
      id: i + 1, workspaceId: 1, moduleKey: "finance", fromNodeId: n.id, toNodeId: ((i + 1) % N) + 1, predicateIri: "fin:parentAccount",
      sourceMappingId: null, sourceSubmissionId: null, createdAt: at, deletedAt: null,
    }));
    rows.set(ontologyModules, modules);
    rows.set(ontologyClasses, classes);
    rows.set(ontologyProperties, properties);
    rows.set(kgNodes, nodes);
    rows.set(kgEdges, edges);
    // Schema: 2 + 3 for the classes, 4 + 4 for the properties. Each node: its
    // type, label, 4 properties and 1 link.
    const expected = 13 + N * 7;

    // One request, as the sync used to send, is over the limit and refused:
    // with 413, or, while the body is still being sent, a dropped connection.
    const whole = knowledgeGraphToTurtle(nodes, edges, buildPrefixMap(modules), datatypeRanges(properties), modulePrefixes(modules));
    expect(bodyBytes(whole)).toBeGreaterThan(ENGINE_LIMIT);
    const refused = await client.exclusive(() => client.loadTurtle(whole)).catch((e: unknown) => e);
    expect(refused instanceof EngineRequestError || (refused instanceof TypeError && refused.message === "fetch failed"), String(refused)).toBe(true);

    const synced = await client.exclusive(() => client.syncWorkspace(1));
    expect(synced).toEqual({ classesLoaded: 2, propertiesLoaded: 2, instancesLoaded: N, triplesLoaded: expected });
    expect(await count()).toBe(expected);
  }, 120_000);

  it("changes none of a graph's triples by cutting it, a subject split in parts included", async () => {
    const subjects = [
      ...people(300, (i) => [`hr:reportsTo hr:Person_${(i + 1) % 300}`, `hr:age ${20 + (i % 40)}`]),
      { subject: "hr:Big", statements: ["a hr:Person", ...Array.from({ length: 2000 }, (_, i) => `hr:note${i} "note ${i}"`)] },
    ];
    const triples = async () => {
      const r = await client.querySparql("SELECT ?s ?p ?o WHERE { ?s ?p ?o }");
      return r.results.map((t) => `${t.s} ${t.p} ${t.o}`).sort();
    };
    const [whole, cut] = await client.exclusive(async () => {
      await client.clearStore();
      await client.loadTurtle([header, ...subjects.map(subjectToTurtle)].join("\n"));
      const w = await triples();
      await client.clearStore();
      const docs = packTurtle(prefixes, subjects, 8_000);
      expect(docs.length).toBeGreaterThan(5);
      for (const doc of docs) await client.loadTurtle(doc);
      return [w, await triples()];
    });
    expect(whole).toHaveLength(300 * 4 + 2001);
    expect(cut).toEqual(whole);
  }, 60_000);

  it("loads through loadSubjects in as few requests as fit", async () => {
    const subjects = knowledgeGraphSubjects([], []);
    expect(await client.exclusive(() => client.loadSubjects(prefixes, subjects))).toEqual({ triplesLoaded: 0, requests: 0 });
    const some = people(50);
    const result = await client.exclusive(async () => {
      await client.clearStore();
      return client.loadSubjects(prefixes, some);
    });
    expect(result).toEqual({ triplesLoaded: 100, requests: 1 });
  });
});
