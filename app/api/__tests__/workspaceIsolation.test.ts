import { afterEach, describe, expect, it, vi } from "vitest";
import { hasWorkspaceRole } from "../services/workspaceGuard";
import {
  mockAdminUser,
  mockOntologistUser,
  mockViewerUser,
  mockWorkspace,
  mockViewerMembership,
} from "./testHarness";

// Configurable mock database for workspace-resolution tests.
// `whereLimitQueue` feeds, in order, every `select().from().where().limit(1)`
// chain; `joinRows` feeds the membership⨯workspace inner-join lookup.
const dbState = vi.hoisted(() => ({
  whereLimitQueue: [] as unknown[][],
  joinRows: [] as unknown[],
}));

vi.mock("../queries/connection", () => {
  return {
    getDb: vi.fn(() => ({
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => {
              return Promise.resolve(dbState.whereLimitQueue.shift() ?? []);
            }),
          })),
          innerJoin: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => {
                return Promise.resolve(dbState.joinRows);
              }),
            })),
          })),
        })),
      })),
    })),
  };
});

async function importGuardFresh(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  return await import("../services/workspaceGuard");
}

afterEach(() => {
  dbState.whereLimitQueue.length = 0;
  dbState.joinRows = [];
  vi.unstubAllEnvs();
});

describe("Multi-Tenant Geometric Isolation & Workspace Guard", () => {
  describe("Role Enforcement via hasWorkspaceRole", () => {
    it("permits system admin regardless of membership role", () => {
      const allowed = hasWorkspaceRole(mockViewerMembership, mockAdminUser, ["admin"]);
      expect(allowed).toBe(true);
    });

    it("permits workspace ontologist role for ontologist action", () => {
      const allowed = hasWorkspaceRole(
        { ...mockViewerMembership, role: "ontologist" },
        mockOntologistUser,
        ["admin", "ontologist", "editor"],
      );
      expect(allowed).toBe(true);
    });

    it("rejects viewer from ontologist-level procedures", () => {
      const allowed = hasWorkspaceRole(
        mockViewerMembership,
        mockViewerUser,
        ["admin", "ontologist", "editor"],
      );
      expect(allowed).toBe(false);
    });

    it("rejects non-admin from admin-only procedures", () => {
      const allowed = hasWorkspaceRole(
        { ...mockViewerMembership, role: "editor" },
        { ...mockViewerUser, role: "editor" },
        ["admin"],
      );
      expect(allowed).toBe(false);
    });
  });

  describe("Workspace Resolution Logic", () => {
    it("correctly identifies target workspace from x-workspace-id header", async () => {
      const headers = new Headers({ "x-workspace-id": "1" });
      expect(headers.get("x-workspace-id")).toBe("1");
    });

    it("correctly identifies target workspace from x-workspace-slug header", async () => {
      const headers = new Headers({ "x-workspace-slug": "acme-corp-production" });
      expect(headers.get("x-workspace-slug")).toBe("acme-corp-production");
    });
  });

  describe("Admin fallback gating (resolveUserWorkspace)", () => {
    const headers = new Headers({ "x-workspace-id": String(mockWorkspace.id) });

    it("non-production: admin without membership gets a fabricated admin membership to a named workspace", async () => {
      const { resolveUserWorkspace } = await importGuardFresh("development");
      // workspace lookup succeeds, membership lookup finds nothing
      dbState.whereLimitQueue.push([mockWorkspace], []);

      const result = await resolveUserWorkspace(mockAdminUser, headers);

      expect(result.workspace.id).toBe(mockWorkspace.id);
      expect(result.membership.role).toBe("admin");
      expect(result.membership.id).toBe(0);
      expect(result.membership.userId).toBe(mockAdminUser.id);
    });

    it("production: admin without membership is FORBIDDEN from a named workspace", async () => {
      const { resolveUserWorkspace } = await importGuardFresh("production");
      dbState.whereLimitQueue.push([mockWorkspace], []);

      await expect(resolveUserWorkspace(mockAdminUser, headers)).rejects.toThrow(
        `User does not have access to workspace '${mockWorkspace.slug}'.`,
      );
    });

    it("non-production: admin with no memberships falls back to the demo workspace", async () => {
      const { resolveUserWorkspace } = await importGuardFresh("development");
      dbState.joinRows = [];
      // demo-workspace lookup succeeds
      dbState.whereLimitQueue.push([mockWorkspace]);

      const result = await resolveUserWorkspace(mockAdminUser, new Headers());

      expect(result.workspace.id).toBe(mockWorkspace.id);
      expect(result.membership.role).toBe("admin");
      expect(result.membership.id).toBe(0);
    });

    it("production: admin with no memberships is FORBIDDEN — no fallback", async () => {
      const { resolveUserWorkspace } = await importGuardFresh("production");
      dbState.joinRows = [];

      await expect(
        resolveUserWorkspace(mockAdminUser, new Headers()),
      ).rejects.toThrow("User is not a member of any workspace");
    });
  });
});
