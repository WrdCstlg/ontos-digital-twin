import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { hasWorkspaceRole } from "../services/workspaceGuard";
import {
  mockAdminUser,
  mockOntologistUser,
  mockViewerUser,
  mockWorkspace,
  mockWorkspaceBeta,
  mockViewerMembership,
} from "./testHarness";

// Configurable mock database for workspace-resolution tests.
// `whereLimitQueue` feeds, in order, every `select().from().where().limit(1)`
// chain; `joinRows` feeds the membership⨯workspace inner-join lookup.
// The WHERE conditions each chain receives are recorded so tests can check
// what the guard actually asked the database for.
const dbState = vi.hoisted(() => ({
  whereLimitQueue: [] as unknown[][],
  joinRows: [] as unknown[],
  whereLimitConditions: [] as unknown[],
  joinConditions: [] as unknown[],
}));

vi.mock("../queries/connection", () => {
  return {
    getDb: vi.fn(() => ({
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation((condition: unknown) => {
            dbState.whereLimitConditions.push(condition);
            return {
              limit: vi.fn().mockImplementation(() => {
                return Promise.resolve(dbState.whereLimitQueue.shift() ?? []);
              }),
            };
          }),
          innerJoin: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation((condition: unknown) => {
              dbState.joinConditions.push(condition);
              return {
                limit: vi.fn().mockImplementation(() => {
                  return Promise.resolve(dbState.joinRows);
                }),
              };
            }),
          })),
        })),
      })),
    })),
  };
});

async function importGuardFresh(nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  // env.ts throws in production when these are missing; CI has no app/.env.
  vi.stubEnv("APP_SECRET", "test-only-secret-at-least-32-characters!!");
  vi.stubEnv("DATABASE_URL", "mysql://test:test@localhost:3306/test");
  return await import("../services/workspaceGuard");
}

/** Renders a recorded drizzle WHERE condition to its SQL text and bound params. */
const dialect = new MySqlDialect();
function renderCondition(condition: unknown) {
  return dialect.sqlToQuery(condition as SQL);
}

afterEach(() => {
  dbState.whereLimitQueue.length = 0;
  dbState.joinRows = [];
  dbState.whereLimitConditions.length = 0;
  dbState.joinConditions.length = 0;
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

  // The viewer fixture is a member of workspace A (mockWorkspace, id 1) only;
  // workspace B (mockWorkspaceBeta, id 2) belongs to another tenant.
  // Non-admins never get a fabricated membership, so every case must hold in
  // both development and production.
  describe.each(["development", "production"])(
    "Cross-tenant resolution for non-admins (NODE_ENV=%s)",
    (nodeEnv) => {
      const editorUser = { ...mockViewerUser, id: 4, email: "editor@acme.com", role: "editor" as const };

      it.each([
        ["viewer", mockViewerUser],
        ["ontologist", mockOntologistUser],
        ["editor", editorUser],
      ])(
        "%s member of A requesting B by x-workspace-id is FORBIDDEN",
        async (_role, user) => {
          const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);
          // B exists; the caller has no membership row in B.
          dbState.whereLimitQueue.push([mockWorkspaceBeta], []);

          await expect(
            resolveUserWorkspace(user, new Headers({ "x-workspace-id": String(mockWorkspaceBeta.id) })),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: `User does not have access to workspace '${mockWorkspaceBeta.slug}'.`,
          });

          // The guard looked up B by id, then asked for *this user's* membership in *B*.
          expect(dbState.whereLimitConditions).toHaveLength(2);
          expect(renderCondition(dbState.whereLimitConditions[0]).params).toEqual([mockWorkspaceBeta.id]);
          const membershipLookup = renderCondition(dbState.whereLimitConditions[1]);
          expect(membershipLookup.sql).toContain("`workspace_members`.`workspaceId`");
          expect(membershipLookup.sql).toContain("`workspace_members`.`userId`");
          expect(membershipLookup.params).toEqual([mockWorkspaceBeta.id, user.id]);
        },
      );

      it("member of A requesting B by x-workspace-slug is FORBIDDEN", async () => {
        const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);
        dbState.whereLimitQueue.push([mockWorkspaceBeta], []);

        await expect(
          resolveUserWorkspace(
            mockViewerUser,
            new Headers({ "x-workspace-slug": `  ${mockWorkspaceBeta.slug}  ` }),
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Looked up by the trimmed slug, then membership scoped to B and this user.
        expect(renderCondition(dbState.whereLimitConditions[0]).params).toEqual([mockWorkspaceBeta.slug]);
        expect(renderCondition(dbState.whereLimitConditions[1]).params).toEqual([
          mockWorkspaceBeta.id,
          mockViewerUser.id,
        ]);
      });

      it("requesting a workspace that does not exist is NOT_FOUND, without probing membership", async () => {
        const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);

        dbState.whereLimitQueue.push([]);
        await expect(
          resolveUserWorkspace(mockViewerUser, new Headers({ "x-workspace-id": "999" })),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(dbState.whereLimitConditions).toHaveLength(1);
        expect(renderCondition(dbState.whereLimitConditions[0]).params).toEqual([999]);

        dbState.whereLimitQueue.push([]);
        await expect(
          resolveUserWorkspace(mockViewerUser, new Headers({ "x-workspace-slug": "no-such-tenant" })),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(dbState.whereLimitConditions).toHaveLength(2);
      });

      it("requesting their own workspace by header resolves their real membership row", async () => {
        const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);
        dbState.whereLimitQueue.push([mockWorkspace], [mockViewerMembership]);

        const result = await resolveUserWorkspace(
          mockViewerUser,
          new Headers({ "x-workspace-id": String(mockWorkspace.id) }),
        );

        expect(result.workspace).toEqual(mockWorkspace);
        // The stored row, not a fabricated one (fabricated memberships carry id 0).
        expect(result.membership).toEqual(mockViewerMembership);
        expect(result.membership.id).not.toBe(0);
        expect(result.membership.role).toBe("viewer");
        expect(renderCondition(dbState.whereLimitConditions[1]).params).toEqual([
          mockWorkspace.id,
          mockViewerUser.id,
        ]);
      });

      it("with no header, resolves their primary membership via the join lookup", async () => {
        const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);
        dbState.joinRows = [{ membership: mockViewerMembership, workspace: mockWorkspace }];

        const result = await resolveUserWorkspace(mockViewerUser, new Headers());

        expect(result).toEqual({ workspace: mockWorkspace, membership: mockViewerMembership });
        // The join is filtered to this user only, and no by-id/slug lookup ran.
        expect(dbState.joinConditions).toHaveLength(1);
        expect(renderCondition(dbState.joinConditions[0]).params).toEqual([mockViewerUser.id]);
        expect(dbState.whereLimitConditions).toHaveLength(0);
      });

      it("with no header and no memberships, is FORBIDDEN and never falls back to a default workspace", async () => {
        const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);
        dbState.joinRows = [];
        // Bait: if the guard tried the admin-style demo-workspace fallback, it would get this.
        dbState.whereLimitQueue.push([mockWorkspace]);

        await expect(resolveUserWorkspace(mockViewerUser, new Headers())).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringContaining("not a member of any workspace"),
        });
        expect(dbState.whereLimitConditions).toHaveLength(0);
        expect(dbState.whereLimitQueue).toHaveLength(1);
      });

      it.each(["1 OR 1=1", "2abc", "-2", "0x2", "2.0", "2; DROP TABLE workspaces"])(
        "ignores the non-numeric x-workspace-id %j instead of parsing it",
        async (headerValue) => {
          const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);
          dbState.joinRows = [{ membership: mockViewerMembership, workspace: mockWorkspace }];

          const result = await resolveUserWorkspace(
            mockViewerUser,
            new Headers({ "x-workspace-id": headerValue }),
          );

          // Treated as if no workspace was requested: primary membership, no id lookup
          // (parseInt would have turned "2abc" or "2; DROP..." into workspace 2).
          expect(result).toEqual({ workspace: mockWorkspace, membership: mockViewerMembership });
          expect(dbState.whereLimitConditions).toHaveLength(0);
        },
      );

      it("an ignored non-numeric x-workspace-id does not mask a cross-tenant x-workspace-slug", async () => {
        const { resolveUserWorkspace } = await importGuardFresh(nodeEnv);
        dbState.whereLimitQueue.push([mockWorkspaceBeta], []);

        await expect(
          resolveUserWorkspace(
            mockViewerUser,
            new Headers({ "x-workspace-id": "1 OR 1=1", "x-workspace-slug": mockWorkspaceBeta.slug }),
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(renderCondition(dbState.whereLimitConditions[0]).params).toEqual([mockWorkspaceBeta.slug]);
      });
    },
  );

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
