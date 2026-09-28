/**
 * The pure parts of a copy's catch-up (services/graphProjection.ts): reading
 * what a copy says it holds, deciding when to rebuild, and cutting a catch-up
 * into fenced requests. graphCopy.mysql.test.ts runs them on a real engine.
 */
import { describe, expect, it } from "vitest";
import { buildPrefixMap } from "../services/rdfBridge";
import { planUpdates, readCopyMeta, rebuildReason, rebuiltMeta, termValue, type SubjectChange } from "../services/graphProjection";

const prefixMap = buildPrefixMap();
const bodyBytes = (request: string) => Buffer.byteLength(JSON.stringify(request), "utf8") - 2;
const head = { version: 12, epoch: "e-1", minRetainedVersion: 4 };

describe("what a copy says it holds", () => {
  it("reads the engine's terms: typed, plain, escaped, or bare", () => {
    expect(termValue('"12"^^<http://www.w3.org/2001/XMLSchema#integer>')).toBe("12");
    expect(termValue('"e-1"')).toBe("e-1");
    expect(termValue('"a \\"quoted\\" \\\\ value"')).toBe('a "quoted" \\ value');
    expect(termValue('"hi"@en')).toBe("hi");
    expect(termValue("12")).toBe("12");
    expect(termValue(undefined)).toBeNull();
  });

  it("is nothing when the copy holds no version, and refuses a copy with two", () => {
    expect(readCopyMeta([])).toBeNull();
    expect(readCopyMeta([{ version: '"7"^^<x>', epoch: '"e"' }])).toEqual({ version: 7, epoch: "e", writer: null });
    expect(() => readCopyMeta([{ version: '"7"' }, { version: '"8"' }])).toThrow(/2 versions/);
    expect(() => readCopyMeta([{ version: '"7"', writer: '"a"' }, { version: '"7"', writer: '"b"' }])).toThrow(/2 writers/);
    expect(() => readCopyMeta([{ version: '"seven"' }])).toThrow(/version reads/);
  });
});

describe("when a copy is rebuilt rather than caught up", () => {
  it("when it holds no version, another epoch, a version ahead of MySQL or older than the changes kept, or everything changed", () => {
    expect(rebuildReason(null, head)).toBe("it holds no version");
    expect(rebuildReason({ version: 5, epoch: "e-0", writer: null }, head)).toBe("it was built from another epoch");
    expect(rebuildReason({ version: 13, epoch: "e-1", writer: null }, head)).toBe("it holds version 13, ahead of MySQL's 12");
    expect(rebuildReason({ version: 3, epoch: "e-1", writer: null }, head)).toBe("it holds version 3, older than the changes kept (4)");
    expect(rebuildReason({ version: 5, epoch: "e-1", writer: "w" }, head, true)).toBe("a change since reaches every subject");
    expect(rebuildReason({ version: 5, epoch: "e-1", writer: "w" }, head)).toBeNull();
    expect(rebuildReason({ version: 4, epoch: "e-1", writer: null }, head)).toBeNull();
  });

  it("starts a rebuilt copy with its version and epoch, and no writer", () => {
    expect(rebuiltMeta(12, 'e"1')).toContain('<urn:ontos:version> 12 ; <urn:ontos:epoch> "e\\"1"');
  });
});

describe("a catch-up's requests", () => {
  const subjects = (n: number, size = 1): SubjectChange[] =>
    Array.from({ length: n }, (_, i) => ({ subject: `hr:P${i}`, statements: ["a hr:Person", ...Array.from({ length: size }, (_, j) => `hr:note${j} "${"x".repeat(40)}"`)] }));
  const plan = (s: SubjectChange[], maxBytes = 1_500_000) => planUpdates({ prefixMap, subjects: s, from: 7, to: 9, writer: "w-1", maxBytes });

  it("take the copy over in the first, fence every one on the version and writer, and set the version in the last", () => {
    const requests = plan(subjects(300), 8_000);
    expect(requests.length).toBeGreaterThan(3);
    requests.forEach((r, i) => {
      expect(bodyBytes(r), `request ${i}`).toBeLessThanOrEqual(8_000);
      expect(r.startsWith("PREFIX rdf: <")).toBe(true);
      expect(r).toContain('FILTER(?v = 7 && ?w = "w-1")');
      expect(r).toContain("DROP GRAPH <urn:ontos:fence>");
      expect(r.includes('<urn:ontos:writer> "w-1"'), `request ${i}`).toBe(i === 0);
      expect(r.includes("<urn:ontos:version> 9"), `request ${i}`).toBe(i === requests.length - 1);
    });
    // Fenced before anything changes.
    expect(requests[1].indexOf("DROP GRAPH")).toBeLessThan(requests[1].indexOf("DELETE WHERE { hr:P"));
  });

  it("remove each subject before writing it, in the same request, and write every subject once", () => {
    const all = plan(subjects(300), 8_000).join("\n");
    for (let i = 0; i < 300; i++) {
      expect(all.split(`DELETE WHERE { hr:P${i} ?p ?o }`).length - 1, `hr:P${i}`).toBe(1);
      expect(all.split(`INSERT DATA { hr:P${i} a hr:Person`).length - 1, `hr:P${i}`).toBe(1);
    }
    for (const r of plan(subjects(300), 8_000)) {
      for (const [, i] of r.matchAll(/INSERT DATA \{ hr:P(\d+) /g)) expect(r).toContain(`DELETE WHERE { hr:P${i} ?p ?o }`);
    }
  });

  it("only remove a subject that left the graph", () => {
    const [request] = plan([{ subject: "hr:Gone", statements: null }]);
    expect(request).toContain("DELETE WHERE { hr:Gone ?p ?o }");
    expect(request).not.toContain("INSERT DATA { hr:Gone");
  });

  it("split a subject too large for one request over several, the first part beside its removal", () => {
    const requests = plan(subjects(1, 400), 6_000);
    expect(requests.length).toBeGreaterThan(2);
    for (const r of requests) expect(bodyBytes(r)).toBeLessThanOrEqual(6_000);
    expect(requests[0]).toContain("DELETE WHERE { hr:P0 ?p ?o }");
    expect(requests[0]).toContain("INSERT DATA { hr:P0 a hr:Person");
    const notes = requests.join("\n").match(/hr:note\d+ /g)!;
    expect(notes).toHaveLength(400);
    expect(new Set(notes).size).toBe(400);
  });

  it("refuse a statement no request can carry, and a request too small for the fence", () => {
    expect(() => plan([{ subject: "hr:Big", statements: [`hr:note "${"x".repeat(10_000)}"`] }], 6_000)).toThrow(/hr:Big has a statement of/);
    expect(() => plan(subjects(1), 500)).toThrow(/cannot hold even the fence/);
  });

  it("with nothing to change, still move the copy to the new version, fenced", () => {
    const requests = plan([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('FILTER(?v = 7 && ?w = "w-1")');
    expect(requests[0]).toContain("<urn:ontos:version> 9");
  });
});
