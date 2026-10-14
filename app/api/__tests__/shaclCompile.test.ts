/**
 * The SHACL compiler writes every constraint key a class's rules store, or
 * refuses to compile. A stored key it cannot write must never be dropped without a word: the rule
 * would look present (the UI shows the stored form) and never be enforced, as
 * the HR date rule was (docs/DECISIONS.md, D-020 and D-032).
 */
import { describe, expect, it } from "vitest";
import type { OntologyClass } from "@db/schema";
import { SEED_SHACL } from "../../db/seedShacl";
import { shaclJsonToTurtle } from "../services/rdfBridge";
import { TWIN_SHACL } from "../services/twinModels";

const shaped = (iri: string, shaclJson: unknown): OntologyClass => ({
  id: 1,
  moduleId: 1,
  iri,
  label: iri,
  parentId: null,
  definition: null,
  isCustom: false,
  deprecated: false,
  shaclJson,
  createdAt: new Date(),
});

describe("shaclJsonToTurtle", () => {
  it("refuses a stored key it cannot write, naming the class, the path and the key", () => {
    const stored = shaped("hr:EmploymentContract", {
      shape: "hr:EmploymentContractShape",
      constraints: [{ path: "hr:endDate", sparql: "endDate >= startDate", severity: "Violation" }],
    });
    expect(() => shaclJsonToTurtle([stored])).toThrow(/hr:EmploymentContract.*hr:endDate.*"sparql"/);
  });

  it("refuses any key it cannot write, not only sparql", () => {
    const stored = shaped("hr:Person", { constraints: [{ path: "hr:email", minCount: 1, nodeKind: "sh:Literal" }] });
    expect(() => shaclJsonToTurtle([stored])).toThrow(/hr:Person.*hr:email.*"nodeKind"/);
  });

  it("writes sh:lessThanOrEquals", () => {
    const turtle = shaclJsonToTurtle([shaped("hr:EmploymentContract", { constraints: [{ path: "hr:startDate", lessThanOrEquals: "hr:endDate" }] })]);
    expect(turtle).toContain("sh:path hr:startDate ;");
    expect(turtle).toContain("sh:lessThanOrEquals hr:endDate");
  });

  it("compiles every rule the seeds store", () => {
    const stored = [...Object.entries(SEED_SHACL), ...Object.entries(TWIN_SHACL)].map(([iri, shacl]) => shaped(iri, shacl));
    const turtle = shaclJsonToTurtle(stored);
    // One shape per stored class, none dropped, and the HR date rule among them.
    expect(turtle.match(/ a sh:NodeShape ;/g) ?? []).toHaveLength(stored.length);
    expect(stored.length).toBeGreaterThan(0);
    expect(turtle).toContain("sh:lessThanOrEquals hr:endDate");
  });
});
