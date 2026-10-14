/**
 * The HR date rule as the seed stores it, compiled as the product compiles it,
 * on data written as the product writes it, against a real engine: an
 * employment contract's start date is not after its end date. It used to be
 * stored as a `sparql` key holding no query, which the compiler dropped without
 * saying so, so no contract was ever refused (docs/DECISIONS.md, D-020, D-032).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KgNode, OntologyClass } from "@db/schema";
import { SEED_SHACL } from "../../db/seedShacl";
import { buildPrefixMap, expandIri, knowledgeGraphToTurtle, shaclJsonToTurtle } from "../services/rdfBridge";
import { SemanticEngineClient } from "../services/semanticEngine";
import { startPrivateEngine, type PrivateEngine } from "./privateEngine";

const prefixMap = buildPrefixMap();
const CONTRACT = "hr:EmploymentContract/EC-1";

const employmentContract: OntologyClass = {
  id: 1,
  moduleId: 1,
  iri: "hr:EmploymentContract",
  label: "EmploymentContract",
  parentId: null,
  definition: null,
  isCustom: false,
  deprecated: false,
  shaclJson: SEED_SHACL["hr:EmploymentContract"],
  createdAt: new Date(),
};

/** A contract that meets the shape's other rule (a hire date), with the dates given. */
function contract(dates: { startDate: string; endDate?: string }): KgNode {
  return {
    id: 1,
    workspaceId: 1,
    moduleKey: "hr",
    classIri: "hr:EmploymentContract",
    iri: CONTRACT,
    label: "Employment",
    propsJson: { hireDate: "2024-01-02", ...dates },
    sourceMappingId: null,
    sourceSubmissionId: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("the HR date rule", () => {
  let engine: PrivateEngine;
  let semanticEngine: SemanticEngineClient;

  beforeAll(async () => {
    engine = await startPrivateEngine();
    const before = process.env.OPEN_ONTOLOGIES_URL;
    process.env.OPEN_ONTOLOGIES_URL = engine.url;
    semanticEngine = new SemanticEngineClient();
    if (before === undefined) delete process.env.OPEN_ONTOLOGIES_URL;
    else process.env.OPEN_ONTOLOGIES_URL = before;
  }, 60_000);

  afterAll(async () => {
    await engine?.stop();
  });

  beforeEach(async () => {
    await semanticEngine.clearStore();
  });

  async function validate(node: KgNode) {
    await semanticEngine.loadTurtle(knowledgeGraphToTurtle([node], [], prefixMap));
    return semanticEngine.validateShacl(shaclJsonToTurtle([employmentContract], prefixMap));
  }

  it("refuses a contract whose end date is before its start date", async () => {
    const report = await validate(contract({ startDate: "2024-06-01", endDate: "2024-05-31" }));
    expect(report.violations.map((v) => ({ constraint: v.constraint, focusNode: v.focusNode, path: v.path }))).toEqual([
      { constraint: "lessThanOrEquals", focusNode: expandIri(CONTRACT, prefixMap), path: expandIri("hr:startDate", prefixMap) },
    ]);
    expect(report.conforms).toBe(false);
  });

  it.each([
    ["ends on the day it starts", { startDate: "2024-06-01", endDate: "2024-06-01" }],
    ["ends after it starts", { startDate: "2024-06-01", endDate: "2025-05-31" }],
    ["has no end date", { startDate: "2024-06-01" }],
  ])("accepts a contract that %s", async (_, dates) => {
    const report = await validate(contract(dates));
    expect(report.violations).toEqual([]);
    expect(report.conforms).toBe(true);
  });
});
