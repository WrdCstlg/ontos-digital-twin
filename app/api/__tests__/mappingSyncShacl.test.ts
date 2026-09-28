/**
 * A mapping's SHACL mode: `warn` imports rows that fail the class's shapes and
 * records the violations; `block` imports nothing that fails them, and nothing
 * unchecked. Run through the import itself against an in-memory database,
 * with the semantic engine replaced.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { connectors, kgNodes, mappings, ontologyClasses, ontologyModules, ontologyProperties, syncJobs } from "@db/schema";
import { runMappingSync } from "../services/mappingSync";
import { PermanentJobError } from "../services/jobs/worker";
import { writeAudit } from "../services/audit";
import { EngineRequestError, semanticEngine } from "../services/semanticEngine";
import { appRouter } from "../router";
import { createMockContext, mockOntologistUser, mockViewerUser, mockWorkspace } from "./testHarness";

const store = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>() }));
vi.mock("../queries/connection", async () => ({ getDb: (await import("./memoryDb")).memoryDbFor(store.tables) }));
vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  writeAudit: vi.fn(async () => undefined),
}));
vi.mock("../services/semanticEngine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/semanticEngine")>()),
  semanticEngine: {
    ensureEngineRunning: vi.fn(async () => true),
    exclusive: vi.fn(async (f: () => unknown) => f()),
    clearStore: vi.fn(async () => undefined),
    loadTurtle: vi.fn(async () => undefined),
    validateShacl: vi.fn(),
  },
}));

const WS = mockWorkspace.id;
const at = new Date("2026-01-01T00:00:00Z");
const rows = (t: Table) => store.tables.get(getTableName(t)) ?? [];
const put = (t: Table, r: Record<string, unknown>[]) => store.tables.set(getTableName(t), r.map((x) => ({ ...x })));
const SHAPES = { constraints: [{ path: "hr:manager", minCount: 1 }] };
const conforming = { conforms: true, focusNodes: 2, violationCount: 0, violations: [] };
const failing = {
  conforms: false,
  focusNodes: 2,
  violationCount: 1,
  violations: [{ constraint: "sh:MinCountConstraintComponent", focusNode: "hr:person/1", path: "hr:manager", severity: "Violation" as const, message: "Less than 1 values" }],
};

function setUp(shaclMode: "warn" | "block", shaclJson: unknown = SHAPES) {
  store.tables.clear();
  put(connectors, [{ id: 1, workspaceId: WS, name: "HRIS", type: "csv", configJson: { filename: "p.csv", csvText: "id,name,manager\n1,Ada,\n2,Grace,1\n" }, status: "connected", createdAt: at }]);
  put(ontologyModules, [{ id: 10, workspaceId: WS, key: "hr", name: "HR", status: "active" }]);
  put(ontologyClasses, [{ id: 50, moduleId: 10, iri: "hr:Person", label: "Person", shaclJson }]);
  put(mappings, [
    { id: 100, connectorId: 1, moduleId: 10, name: "People", sourceTable: "p", classIri: "hr:Person", status: "active", shaclMode, createdAt: at,
      columnMapJson: { subject: "hr:person/{id}", label: "name", fields: { manager: "hr:manager" } } },
  ]);
  put(syncJobs, [{ id: 7, mappingId: 100, status: "queued", rowsProcessed: 0, createdAt: at }]);
}
const run = () => runMappingSync(WS, { syncJobId: 7, mappingId: 100 }, "Amara Okafor", new AbortController().signal);

beforeEach(() => {
  vi.mocked(semanticEngine.ensureEngineRunning).mockResolvedValue(true);
  vi.mocked(semanticEngine.validateShacl).mockReset();
  vi.mocked(writeAudit).mockClear();
});

describe("a mapping set to block on SHACL", () => {
  it("imports nothing when the mapped rows fail the class's shapes, says why, and records the refusal", async () => {
    setUp("block");
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue(failing);
    const refused = run();
    await expect(refused).rejects.toBeInstanceOf(PermanentJobError);
    await expect(refused).rejects.toThrow(/SHACL: 1 violation\(s\) in the mapped rows, and this mapping blocks imports that do not conform/);
    expect(rows(kgNodes)).toEqual([]);
    expect(vi.mocked(writeAudit).mock.calls.map(([e]) => e.action)).toEqual([
      "Sync 'People' refused: 1 SHACL violation(s), and the mapping blocks imports that do not conform",
    ]);
  });

  it("imports rows that conform", async () => {
    setUp("block");
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue(conforming);
    const result = await run();
    expect(result.nodesUpserted).toBe(2);
    expect(rows(kgNodes).map((n) => n.iri)).toEqual(["hr:person/1", "hr:person/2"]);
  });

  it("imports nothing unchecked: with the engine away, or the check failing, the import fails to be retried", async () => {
    for (const cause of ["engine away", "check failed"] as const) {
      setUp("block");
      vi.mocked(semanticEngine.ensureEngineRunning).mockResolvedValue(cause !== "engine away");
      if (cause === "check failed") vi.mocked(semanticEngine.validateShacl).mockRejectedValue(new Error("engine answered 500"));
      const waiting = run();
      await expect(waiting, cause).rejects.toThrow(/could not be checked just now/);
      await expect(waiting, cause).rejects.not.toBeInstanceOf(PermanentJobError);
      expect(rows(kgNodes), cause).toEqual([]);
    }
  });

  it("imports as usual when the class has no shapes to check", async () => {
    setUp("block", null);
    vi.mocked(semanticEngine.ensureEngineRunning).mockResolvedValue(false);
    expect((await run()).nodesUpserted).toBe(2);
  });
});

describe("what the check sees", () => {
  it("the mapped rows with their values typed as the ontology declares, as the import writes them", async () => {
    setUp("block");
    put(ontologyProperties, [
      { id: 60, moduleId: 10, iri: "hr:salary", label: "salary", kind: "datatype", rangeDatatype: "xsd:decimal" },
      { id: 61, moduleId: 10, iri: "hr:manager", label: "manager", kind: "datatype", rangeDatatype: "xsd:integer" },
    ]);
    put(mappings, [{ ...rows(mappings)[0], columnMapJson: { subject: "hr:person/{id}", label: "name", fields: { manager: "hr:manager", salary: "hr:salary" } } }]);
    put(connectors, [{ ...rows(connectors)[0], configJson: { filename: "p.csv", csvText: "id,name,manager,salary\n1,Ada,,1234.50\n2,Grace,1,n/a\n" } }]);
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue(conforming);
    await run();
    const data = vi.mocked(semanticEngine.loadTurtle).mock.calls.at(-1)![0];
    expect(data).toContain('hr:salary "1234.50"^^xsd:decimal');
    expect(data).toContain('hr:manager "1"^^xsd:integer');
    expect(data).toContain('hr:salary "n/a"^^xsd:string');
  });

  it("the links the rows make, to another row or to a node the graph holds, with that node's class", async () => {
    withLinks();
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue({ ...conforming, focusNodes: 5 });
    expect((await run()).nodesUpserted).toBe(4);
    const data = vi.mocked(semanticEngine.loadTurtle).mock.calls.at(-1)![0];
    expect(data).toContain("hr:reportsTo <https://ontos.dev/ontology/hr/person/1>");
    expect(data).toContain("hr:reportsTo <https://ontos.dev/ontology/hr/person/99>");
    expect(data).toContain("<https://ontos.dev/ontology/hr/person/99> a hr:Person");
    // A link to nothing in the graph is dropped by the import, and so by the check.
    expect(data).not.toContain("person/77");
  });
});

/** Four people, three of whom name a manager: another row, a person already in the graph, and no one. */
function withLinks() {
  setUp("block");
  put(mappings, [{ ...rows(mappings)[0], columnMapJson: { subject: "hr:person/{id}", label: "name", fields: {}, links: [{ column: "manager", predicate: "hr:reportsTo", target: "hr:person/{value}" }] } }]);
  put(connectors, [{ ...rows(connectors)[0], configJson: { filename: "p.csv", csvText: "id,name,manager\n1,Ada,\n2,Grace,1\n3,Alan,99\n4,Ida,77\n" } }]);
  put(kgNodes, [{ id: 500, workspaceId: WS, moduleKey: "hr", classIri: "hr:Person", iri: "hr:person/99", label: "Boss", propsJson: {}, deletedAt: null }]);
}

describe("what a mapping set to block refuses", () => {
  it("only the rows' own violations: not those of the nodes they link to", async () => {
    withLinks();
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue({
      conforms: false, focusNodes: 5, violationCount: 1,
      violations: [{ constraint: "sh:MinCountConstraintComponent", focusNode: "https://ontos.dev/ontology/hr/person/99", path: "hr:email", severity: "Violation" }],
    });
    expect((await run()).nodesUpserted).toBe(4);
  });

  it("a Violation, not a Warning or Info, which is recorded as warn records it", async () => {
    setUp("block");
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue({
      conforms: false, focusNodes: 2, violationCount: 2,
      violations: [
        { constraint: "sh:MinCountConstraintComponent", focusNode: "hr:person/1", path: "hr:manager", severity: "Warning" },
        { constraint: "sh:PatternConstraintComponent", focusNode: "hr:person/2", path: "hr:manager", severity: "Info" },
      ],
    });
    const result = await run();
    expect(result.nodesUpserted).toBe(2);
    expect(result.shacl).toMatchObject({ conforms: false, violationCount: 2 });
  });

  it("nothing when there are no rows to check", async () => {
    setUp("block");
    put(connectors, [{ ...rows(connectors)[0], configJson: { filename: "p.csv", csvText: "id,name,manager\n" } }]);
    expect((await run()).nodesUpserted).toBe(0);
    expect(semanticEngine.validateShacl).not.toHaveBeenCalled();
  });

  it("does not take a report on some other graph for this import's: the import waits", async () => {
    setUp("block");
    // Two rows loaded, seven judged: another process loaded its graph in between.
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue({ ...conforming, focusNodes: 7 });
    const waiting = run();
    await expect(waiting).rejects.toThrow(/could not be checked just now: the engine checked 7 node\(s\) of hr:Person where this import loaded 2/);
    await expect(waiting).rejects.not.toBeInstanceOf(PermanentJobError);
    expect(rows(kgNodes)).toEqual([]);
  });

  it("fails for good, with the engine's reason, when the engine cannot check the import", async () => {
    setUp("block");
    vi.mocked(semanticEngine.validateShacl).mockRejectedValue(new EngineRequestError("No such file or directory (os error 2)"));
    const refused = run();
    await expect(refused).rejects.toBeInstanceOf(PermanentJobError);
    await expect(refused).rejects.toThrow(/the semantic engine cannot check this one: No such file or directory/);
    expect(rows(kgNodes)).toEqual([]);
  });

  it("records the counts and the first groups of results, never every result", async () => {
    setUp("block");
    const many = Array.from({ length: 40 }, (_, i) => ({
      constraint: "sh:MinCountConstraintComponent", focusNode: i % 2 ? "hr:person/1" : "hr:person/2", path: `hr:field${i}`, severity: "Violation" as const,
    }));
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue({ conforms: false, focusNodes: 2, violationCount: 40, violations: many, raw: { big: "x".repeat(10_000) } });
    await expect(run()).rejects.toThrow(/SHACL: 40 violation\(s\)/);
    const { payload } = vi.mocked(writeAudit).mock.calls[0][0] as { payload: { shacl: { violationCount: number; groups: unknown[] } } };
    expect(payload.shacl.violationCount).toBe(40);
    expect(payload.shacl.groups).toHaveLength(5);
    expect(JSON.stringify(payload)).not.toMatch(/justificationTree|xxxxxxxxxx/);
  });
});

describe("a mapping set to warn, the default", () => {
  it("imports rows that fail the class's shapes, and records the violations", async () => {
    setUp("warn");
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue(failing);
    const result = await run();
    expect(result.nodesUpserted).toBe(2);
    expect(result.shacl).toMatchObject({ conforms: false, violationCount: 1 });
    expect(vi.mocked(writeAudit).mock.calls[0][0].action).toMatch(/\[SHACL 1 violations\]/);
  });

  it("imports while the engine is away, unchecked, and says so in its record", async () => {
    setUp("warn");
    vi.mocked(semanticEngine.ensureEngineRunning).mockResolvedValue(false);
    const result = await run();
    expect(result.nodesUpserted).toBe(2);
    expect(result.shacl).toBeNull();
    expect(vi.mocked(writeAudit).mock.calls[0][0].payload).toMatchObject({ shacl: null, shaclNotChecked: "the semantic engine is not running" });
  });
});

describe("saving a mapping's SHACL mode", () => {
  const ontologist = () =>
    appRouter.createCaller(
      createMockContext({ user: mockOntologistUser, workspace: mockWorkspace, membership: { id: 902, workspaceId: WS, userId: mockOntologistUser.id, role: "ontologist", moduleScope: null, createdAt: at } }),
    );
  const save = (extra: Record<string, unknown>) => ({
    id: 100, name: "People", connectorId: 1, moduleKey: "hr", sourceTable: "p", classIri: "hr:Person",
    columnMap: { subject: "hr:person/{id}" }, status: "active" as const, ...extra,
  });

  it("stores the mode it is given, and keeps it when a save leaves it out", async () => {
    setUp("warn");
    await ontologist().mapping.upsertMapping(save({ shaclMode: "block" }));
    expect(rows(mappings)[0].shaclMode).toBe("block");
    await ontologist().mapping.upsertMapping(save({ name: "People (renamed)" }));
    expect(rows(mappings)[0]).toMatchObject({ name: "People (renamed)", shaclMode: "block" });
  });

  it("audits switching the check on or off as such, with the mode it was", async () => {
    setUp("block");
    await ontologist().mapping.upsertMapping(save({ shaclMode: "warn" }));
    await ontologist().mapping.upsertMapping(save({ name: "People (renamed)" }));
    const [off, rename] = vi.mocked(writeAudit).mock.calls.map(([e]) => e);
    expect(off.action).toBe("Updated mapping 'People': its SHACL check now only warns");
    expect(off.payload).toMatchObject({ shaclMode: "warn", shaclModeWas: "block" });
    expect(rename.action).toBe("Updated mapping 'People (renamed)'");
    expect(rename.payload).not.toHaveProperty("shaclModeWas");
  });

  it("lets an editor switch the check on, and only an ontologist or admin switch it back to warn", async () => {
    setUp("warn");
    const editor = () =>
      appRouter.createCaller(
        createMockContext({ user: mockViewerUser, workspace: mockWorkspace, membership: { id: 903, workspaceId: WS, userId: mockViewerUser.id, role: "editor", moduleScope: null, createdAt: at } }),
      );
    await editor().mapping.upsertMapping(save({ shaclMode: "block" }));
    expect(rows(mappings)[0].shaclMode).toBe("block");
    await expect(editor().mapping.upsertMapping(save({ shaclMode: "warn" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rows(mappings)[0].shaclMode).toBe("block");
    // A save that leaves the mode as it is goes through.
    await editor().mapping.upsertMapping(save({ name: "People (renamed)" }));
    expect(rows(mappings)[0]).toMatchObject({ name: "People (renamed)", shaclMode: "block" });
    await ontologist().mapping.upsertMapping(save({ shaclMode: "warn" }));
    expect(rows(mappings)[0].shaclMode).toBe("warn");
    expect(await editor().mapping.capabilities()).toEqual({ canRelaxShaclCheck: false });
    expect(await ontologist().mapping.capabilities()).toEqual({ canRelaxShaclCheck: true });
  });

  it("gives a new mapping warn unless told otherwise", async () => {
    setUp("warn");
    const created = await ontologist().mapping.upsertMapping(save({ id: undefined, name: "New" }));
    expect(created.shaclMode).toBe("warn");
  });
});
