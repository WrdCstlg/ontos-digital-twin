import { describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import {
  createMockContext,
  mockAdminUser,
  mockViewerUser,
  mockWorkspace,
  mockAdminMembership,
  mockViewerMembership,
} from "./testHarness";

vi.mock("../services/semanticEngine", () => ({
  semanticEngine: {
    ensureEngineRunning: vi.fn().mockResolvedValue(false),
    querySparql: vi.fn(),
    syncWorkspace: vi.fn(),
  },
}));

describe("Graph Router Integration Tests", () => {
  it("rejects caller from querying foreign workspace key with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );

    await expect(
      caller.graph.stats({ workspaceKey: "unauthorized-workspace-slug" }),
    ).rejects.toThrow("User does not have access to workspace 'unauthorized-workspace-slug'");
  });

  it("handles offline semantic engine gracefully during sparqlQuery", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockAdminUser,
        membership: mockAdminMembership,
        workspace: mockWorkspace,
      }),
    );

    await expect(
      caller.graph.sparqlQuery({
        query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10",
      }),
    ).rejects.toThrow("Semantic engine is currently offline");
  });

  it("handles offline semantic engine gracefully during syncStore", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockAdminUser,
        membership: mockAdminMembership,
        workspace: mockWorkspace,
      }),
    );

    await expect(caller.graph.syncStore()).rejects.toThrow("Semantic engine is currently offline");
  });

  it("rejects unauthenticated caller from graph endpoints", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null, workspace: null, membership: null }));
    await expect(caller.graph.syncStore()).rejects.toThrow("Authentication required");
  });
});
