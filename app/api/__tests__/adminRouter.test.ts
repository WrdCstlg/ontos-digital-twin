import { describe, expect, it } from "vitest";
import { appRouter } from "../router";
import {
  createMockContext,
  mockAdminUser,
  mockViewerUser,
  mockWorkspace,
  mockAdminMembership,
  mockViewerMembership,
} from "./testHarness";

describe("Admin Router Integration Tests", () => {
  it("allows authenticated user to get their active workspace", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );
    const ws = await caller.admin.getWorkspace();
    expect(ws).toBeDefined();
    expect(ws.id).toBe(mockWorkspace.id);
    expect(ws.slug).toBe(mockWorkspace.slug);
  });

  it("allows admin user to get providers list", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockAdminUser,
        membership: mockAdminMembership,
        workspace: mockWorkspace,
      }),
    );
    const providers = await caller.admin.getProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    expect(providers.some((p) => p.id === "ollama")).toBe(true);
  });

  it("rejects non-admin user from getting providers list", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );
    await expect(caller.admin.getProviders()).rejects.toThrow("Insufficient permissions");
  });

  it("rejects non-admin from updating member roles", async () => {
    const caller = appRouter.createCaller(
      createMockContext({
        user: mockViewerUser,
        membership: mockViewerMembership,
        workspace: mockWorkspace,
      }),
    );
    await expect(
      caller.admin.updateMemberRole({
        memberId: 102,
        role: "admin",
      }),
    ).rejects.toThrow("Insufficient permissions");
  });

  it("rejects unauthenticated caller from admin endpoints", async () => {
    const caller = appRouter.createCaller(createMockContext({ user: null, workspace: null, membership: null }));
    await expect(caller.admin.getWorkspace()).rejects.toThrow("Authentication required");
  });
});
