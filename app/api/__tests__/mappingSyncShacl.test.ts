/**
 * A mapping's SHACL mode: `warn` imports rows that fail the class's shapes and
 * records the violations; `block` imports nothing that fails them, and nothing
 * unchecked. Run through the import itself against an in-memory database,
 * with the semantic engine replaced.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { connectors, kgNodes, mappings, ontologyClasses, ontologyModules, syncJobs } from "@db/schema";
import { runMappingSync } from "../services/mappingSync";
import { PermanentJobError } from "../services/jobs/worker";
import { writeAudit } from "../services/audit";
import { semanticEngine } from "../services/semanticEngine";
import { appRouter } from "../router";
import { createMockContext, mockOntologistUser, mockWorkspace } from "./testHarness";

const store = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>() }));
vi.mock("../queries/connection", async () => ({ getDb: (await import("./memoryDb")).memoryDbFor(store.tables) }));
vi.mock("../services/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/audit")>()),
  writeAudit: vi.fn(async () => undefined),
}));
vi.mock("../services/semanticEngine", () => ({
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

describe("a mapping set to warn, the default", () => {
  it("imports rows that fail the class's shapes, and records the violations", async () => {
    setUp("warn");
    vi.mocked(semanticEngine.validateShacl).mockResolvedValue(failing);
    const result = await run();
    expect(result.nodesUpserted).toBe(2);
    expect(result.shacl).toMatchObject({ conforms: false, violationCount: 1 });
    expect(vi.mocked(writeAudit).mock.calls[0][0].action).toMatch(/\[SHACL 1 violations\]/);
  });

  it("imports while the engine is away, unchecked", async () => {
    setUp("warn");
    vi.mocked(semanticEngine.ensureEngineRunning).mockResolvedValue(false);
    expect((await run()).nodesUpserted).toBe(2);
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

  it("gives a new mapping warn unless told otherwise", async () => {
    setUp("warn");
    const created = await ontologist().mapping.upsertMapping(save({ id: undefined, name: "New" }));
    expect(created.shaclMode).toBe("warn");
  });
});
