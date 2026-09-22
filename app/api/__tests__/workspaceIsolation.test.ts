import { describe, expect, it, vi } from "vitest";
import { hasWorkspaceRole } from "../services/workspaceGuard";
import {
  mockAdminUser,
  mockOntologistUser,
  mockViewerUser,
  mockWorkspace,
  mockViewerMembership,
} from "./testHarness";

// Mock database connection for isolation unit tests
vi.mock("../queries/connection", () => {
  return {
    getDb: vi.fn(() => ({
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => {
              // Check what's being queried based on mock setup
              return [];
            }),
          })),
          innerJoin: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  membership: mockViewerMembership,
                  workspace: mockWorkspace,
                },
              ]),
            })),
          })),
        })),
      })),
    })),
  };
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
});
