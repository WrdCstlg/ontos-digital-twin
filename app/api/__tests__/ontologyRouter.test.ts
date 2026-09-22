import { describe, expect, it } from "vitest";
import { appRouter } from "../router";
import {
  createMockContext,
  mockViewerUser,
  mockWorkspace,
  mockViewerMembership,
} from "./testHarness";

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

  it("rejects unauthenticated request to explainViolation", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null, workspace: null, membership: null }));
    await expect(
      caller.ontology.explainViolation({
        constraint: "sh:MinCountConstraintComponent",
      }),
    ).rejects.toThrow("Authentication required");
  });
});
