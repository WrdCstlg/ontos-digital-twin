import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { appRouter } from "../router";
import {
  createMockContext,
  mockAdminMembership,
  mockAdminUser,
  mockOntologistMembership,
  mockOntologistUser,
  mockViewerMembership,
  mockViewerUser,
  mockWorkspace,
} from "./testHarness";
import { fixtureModel } from "./publicApiFixtures";

const db = vi.hoisted(() => ({ wheres: [] as unknown[], results: [] as unknown[][] }));
vi.mock("../queries/connection", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      from: self,
      limit: self,
      where: (w: unknown) => {
        db.wheres.push(w);
        return c;
      },
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(db.results.shift() ?? []).then(resolve, reject),
    });
    return c;
  };
  return {
    getDb: vi.fn(() => ({
      select: () => chain(),
      transaction: () => {
        throw new Error("the refusal must come before the database");
      },
    })),
  };
});
vi.mock("../services/publicApi/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/publicApi/model")>()),
  loadOntologyModel: vi.fn(async () => fixtureModel),
}));

import { createToken, listTokens, revokeToken, TokenRefused } from "../services/publicApi/tokens";

vi.mock("../services/publicApi/tokens", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/publicApi/tokens")>();
  return { ...real, listTokens: vi.fn(), revokeToken: vi.fn(async () => true), createToken: vi.fn(real.createToken) };
});

const as = (who: "admin" | "ontologist" | "viewer") =>
  appRouter.createCaller(
    createMockContext(
      who === "admin"
        ? { user: mockAdminUser, membership: mockAdminMembership, workspace: mockWorkspace }
        : who === "ontologist"
          ? { user: mockOntologistUser, membership: mockOntologistMembership, workspace: mockWorkspace }
          : { user: mockViewerUser, membership: mockViewerMembership, workspace: mockWorkspace },
    ),
  );
const row = (id: number, createdByUserId: number) => ({ id, workspaceId: 1, name: `t${id}`, prefix: `ontos_${id}`, role: "viewer", scopes: ["read"], createdByUserId });

beforeEach(() => {
  db.wheres.length = 0;
  db.results.length = 0;
});
afterEach(() => vi.clearAllMocks());

describe("creating a token", () => {
  it("never gives a token a higher role than its creator's", async () => {
    await expect(as("ontologist").developer.createToken({ name: "too high", role: "admin", scopes: ["read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(as("viewer").developer.createToken({ name: "too high", role: "editor", scopes: ["read"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes the creator on, so the token acts no higher than they may", async () => {
    vi.mocked(createToken).mockResolvedValueOnce({ token: "ontos_x", row: {} } as never);
    await as("ontologist").developer.createToken({ name: "CI", role: "ontologist", scopes: ["read", "actions"], expiresInDays: 90 });
    expect(vi.mocked(createToken).mock.calls[0][1]).toEqual({ name: mockOntologistUser.name, userId: mockOntologistUser.id, userRole: "ontologist", memberRole: "ontologist" });
  });

  it("refuses a token with no scope, a scope that does not exist, or an expiry out of range", async () => {
    await expect(as("admin").developer.createToken({ name: "x", role: "viewer", scopes: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as("admin").developer.createToken({ name: "x", role: "viewer", scopes: ["write" as never] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as("admin").developer.createToken({ name: "x", role: "viewer", scopes: ["read"], expiresInDays: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(as("admin").developer.createToken({ name: "  ", role: "viewer", scopes: ["read"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the service itself refuses a higher role or no scopes before touching the database", async () => {
    const creator = { name: "V", userId: 3, userRole: "viewer", memberRole: "viewer" };
    await expect(createToken(1, creator, { name: "x", role: "editor", scopes: ["read"] })).rejects.toBeInstanceOf(TokenRefused);
    await expect(createToken(1, creator, { name: "x", role: "viewer", scopes: [] })).rejects.toBeInstanceOf(TokenRefused);
  });

  it("measures the creator by their role in this workspace, not their account's", async () => {
    // An account-level ontologist who is a viewer here mints a viewer's tokens at most.
    const creator = { name: "O", userId: 2, userRole: "ontologist", memberRole: "viewer" };
    await expect(createToken(1, creator, { name: "x", role: "editor", scopes: ["read"] })).rejects.toBeInstanceOf(TokenRefused);
  });
});

describe("seeing and revoking tokens", () => {
  it("shows an admin every token, and anyone else only their own", async () => {
    vi.mocked(listTokens).mockResolvedValue([row(1, mockAdminUser.id), row(2, mockViewerUser.id)] as never);
    expect((await as("admin").developer.listTokens()).map((t) => [t.id, t.mine])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect((await as("viewer").developer.listTokens()).map((t) => t.id)).toEqual([2]);
    expect(vi.mocked(listTokens).mock.calls[0][0]).toBe(mockWorkspace.id);
  });

  it("lets a member revoke their own token, and only an admin someone else's", async () => {
    db.results.push([{ createdByUserId: mockViewerUser.id }]);
    await expect(as("viewer").developer.revokeToken({ id: 2 })).resolves.toEqual({ revoked: true });
    db.results.push([{ createdByUserId: mockAdminUser.id }]);
    await expect(as("viewer").developer.revokeToken({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    db.results.push([{ createdByUserId: mockViewerUser.id }]);
    await expect(as("admin").developer.revokeToken({ id: 2 })).resolves.toEqual({ revoked: true });
    expect(vi.mocked(revokeToken)).toHaveBeenCalledTimes(2);
  });

  it("looks for the token only in the caller's workspace", async () => {
    await expect(as("admin").developer.revokeToken({ id: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { sql, params } = new MySqlDialect().sqlToQuery(db.wheres[0] as SQL);
    expect(sql).toContain("`api_tokens`.`workspaceId`");
    expect(params).toEqual([99, mockWorkspace.id]);
    expect(revokeToken).not.toHaveBeenCalled();
  });
});

describe("the summary", () => {
  it("names the API's base path and the ontology it serves", async () => {
    await expect(as("viewer").developer.summary()).resolves.toMatchObject({
      basePath: "/api/v1",
      ontologyVersion: fixtureModel.version,
      objectTypes: fixtureModel.objectTypes.length,
      actionTypes: fixtureModel.actionTypes.length,
      canManageAll: false,
    });
  });
});
