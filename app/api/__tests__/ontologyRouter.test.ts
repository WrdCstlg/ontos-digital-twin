import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import { semanticEngine } from "../services/semanticEngine";
import {
  createMockContext,
  mockViewerUser,
  mockWorkspace,
  mockViewerMembership,
} from "./testHarness";

// Minimal module/class rows so validateShacl can reach its early returns.
const mockModule = { id: 5, key: "hr", prefix: "hr" };
const constrainedClass = {
  id: 11,
  moduleId: 5,
  iri: "hr:Person",
  shaclJson: { constraints: [{ path: "hr:email", minCount: 1 }] },
};
const unconstrainedClass = { id: 12, moduleId: 5, iri: "hr:Team", shaclJson: null };

// Each `select().from().where()` chain takes the next entry. validateShacl reads,
// in order: modules (requireModule), classes, properties, kgNodes, kgEdges.
const dbState = vi.hoisted(() => ({ queue: [] as unknown[][] }));

function queueValidateShaclRows(classRow: unknown) {
  dbState.queue.push([mockModule], [classRow], [], [], []);
}

vi.mock("../queries/connection", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = dbState.queue.shift() ?? [];
          const chain = Promise.resolve(rows) as Promise<unknown[]> & {
            limit: (n: number) => Promise<unknown[]>;
          };
          chain.limit = () => Promise.resolve(rows);
          return chain;
        }),
      })),
    })),
  })),
}));

vi.mock("../services/semanticEngine", () => ({
  semanticEngine: {
    ensureEngineRunning: vi.fn().mockResolvedValue(false),
    clearStore: vi.fn(),
    loadTurtle: vi.fn(),
    validateShacl: vi.fn(),
  },
}));

afterEach(() => {
  dbState.queue.length = 0;
  vi.clearAllMocks();
});

describe("Ontology Router Integration Tests", () => {
  it("explains SHACL constraint violation correctly", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    const explanation = await caller.ontology.explainViolation({
      constraint: "sh:MinCountConstraintComponent",
      path: "hr:fullName",
      focusNode: "hr:Person/E-1234",
      message: "Value count must be at least 1",
    });

    expect(explanation).toBeDefined();
    expect(typeof explanation.signature).toBe("string");
    expect(explanation.signature.length).toBeGreaterThan(0);
    expect(explanation.humanExplanation).toBeDefined();
    expect(explanation.remediationAction).toBeDefined();
    expect(explanation.justificationTree).toBeDefined();
  });

  it("rejects viewer user from deprecating a class", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    await expect(
      caller.ontology.deprecateClass({
        classIri: "hr:Person",
      }),
    ).rejects.toThrow("Insufficient permissions");
  });

  it("returns conforms:null with engineOffline flag when the semantic engine is down", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    queueValidateShaclRows(constrainedClass);

    const report = await caller.ontology.validateShacl({ moduleKey: "hr" });

    expect(report.conforms).toBeNull();
    expect(report.engineOffline).toBe(true);
    expect(report.message).toContain("NOT performed");
    expect(vi.mocked(semanticEngine.validateShacl)).not.toHaveBeenCalled();
  });

  it("returns conforms:null with noConstraints flag when the module has no SHACL shapes", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );
    queueValidateShaclRows(unconstrainedClass);

    const report = await caller.ontology.validateShacl({ moduleKey: "hr" });

    expect(report.conforms).toBeNull();
    expect(report.noConstraints).toBe(true);
    expect(report.message).toContain("not performed");
    expect(vi.mocked(semanticEngine.ensureEngineRunning)).not.toHaveBeenCalled();
    expect(vi.mocked(semanticEngine.validateShacl)).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated request to explainViolation", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null, workspace: null, membership: null }));
    await expect(
      caller.ontology.explainViolation({
        constraint: "sh:MinCountConstraintComponent",
      }),
    ).rejects.toThrow("Authentication required");
  });
});
