/**
 * A workspace graph the engine can parse: every prefixed name in the Turtle
 * the renderer writes is declared. The seeded workspace's modules have keys
 * that differ from their prefixes (finance and fin, twin and dtwin), and its
 * nodes store properties without a prefix. Written under the module's key,
 * they named prefixes nobody declared, and the engine refused the whole graph.
 */
import { describe, expect, it } from "vitest";
import { buildPrefixMap, datatypeRanges, expandIri, formatIri, knowledgeGraphToTurtle, modulePrefixes } from "../services/rdfBridge";
import { rdfModule as module, seedShaped } from "./rdfFixtures";

/** The prefixes a Turtle document uses, outside its strings and <IRIs>, that it does not declare. */
function undeclaredPrefixes(turtle: string): string[] {
  const declared = new Set([...turtle.matchAll(/^@prefix ([A-Za-z][\w-]*): /gm)].map((m) => m[1]));
  const body = turtle
    .split("\n")
    .filter((line) => !line.startsWith("@prefix") && !line.startsWith("#"))
    .join("\n")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/<[^>]*>/g, "<>");
  const used = new Set([...body.matchAll(/(?<![\w:<-])([A-Za-z][\w-]*):(?=[A-Za-z0-9_])/g)].map((m) => m[1]));
  return [...used].filter((p) => !declared.has(p)).sort();
}

describe("the workspace graph's Turtle", () => {
  const { modules, nodes, edges } = seedShaped;

  it("declares every prefix it writes, for a workspace whose module keys differ from their prefixes", () => {
    const turtle = knowledgeGraphToTurtle(nodes, edges, buildPrefixMap(modules), undefined, modulePrefixes(modules));
    expect(undeclaredPrefixes(turtle)).toEqual([]);
  });

  it("writes a property a node stores bare in its module's namespace, typed as the module declares it", () => {
    const ranges = datatypeRanges([
      { iri: "fin:amount", kind: "datatype", rangeDatatype: "xsd:decimal" },
      { iri: "dtwin:batteryLevel", kind: "datatype", rangeDatatype: "xsd:integer" },
    ]);
    const turtle = knowledgeGraphToTurtle(nodes, edges, buildPrefixMap(modules), ranges, modulePrefixes(modules));
    expect(turtle).toContain('fin:amount "12.50"^^xsd:decimal');
    expect(turtle).toContain('dtwin:batteryLevel "50"^^xsd:integer');
    expect(turtle).toContain('hr:title "Engineer"^^xsd:string');
    expect(turtle).not.toMatch(/\b(finance|twin):/);
  });

  it("without the modules' prefixes, still writes no undeclared prefix: a name it cannot declare becomes its full IRI", () => {
    const turtle = knowledgeGraphToTurtle(nodes, edges, buildPrefixMap(modules));
    expect(undeclaredPrefixes(turtle)).toEqual([]);
    expect(turtle).toContain("<https://ontos.dev/ontology/finance/amount>");
  });

  it("the checker above does find an undeclared prefix", () => {
    expect(undeclaredPrefixes('@prefix hr: <https://ontos.dev/ontology/hr/> .\nhr:a finance:amount "x:y" .')).toEqual(["finance"]);
  });
});

describe("formatIri", () => {
  const prefixes = buildPrefixMap([module(2, "finance", "fin")]);

  it("keeps a prefixed name whose prefix is declared and whose local name Turtle takes", () => {
    expect(formatIri("fin:amount", prefixes)).toBe("fin:amount");
    expect(formatIri("fin:v1.2", prefixes)).toBe("fin:v1.2");
  });

  it("writes the full IRI for a prefix the document does not declare", () => {
    expect(formatIri("finance:amount", prefixes)).toBe("<https://ontos.dev/ontology/finance/amount>");
    expect(formatIri("dtwin:eq", prefixes)).toBe("<https://ontos.dev/ontology/dtwin/eq>");
  });

  it("and for a local name Turtle does not take", () => {
    expect(formatIri("fin:Invoice/INV-1", prefixes)).toBe("<https://ontos.dev/ontology/fin/Invoice/INV-1>");
    expect(formatIri("fin:ends.", prefixes)).toBe("<https://ontos.dev/ontology/fin/ends.>");
    expect(formatIri("fin:-lead", prefixes)).toBe("<https://ontos.dev/ontology/fin/-lead>");
  });

  it("leaves a full IRI as it is", () => {
    expect(formatIri("https://example.com/x", prefixes)).toBe("<https://example.com/x>");
  });
});

describe("expandIri", () => {
  it("names the IRI formatIri writes, so what the engine reports (a SHACL focus node) matches it", () => {
    const prefixes = buildPrefixMap([module(2, "finance", "fin")]);
    for (const iri of ["fin:amount", "fin:Invoice/INV-1", "finance:INV1", "finance:txn/1", "https://example.com/x", "bare"]) {
      const written = formatIri(iri, prefixes);
      const colon = written.indexOf(":");
      const full = written.startsWith("<") ? written.slice(1, -1) : `${prefixes.get(written.slice(0, colon))}${written.slice(colon + 1)}`;
      expect(expandIri(iri, prefixes), iri).toBe(full);
    }
  });
});
