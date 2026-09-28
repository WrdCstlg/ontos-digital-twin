import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { ApiToken } from "@db/schema";
import { env } from "../lib/env";
import { mockAdminMembership, mockViewerMembership, mockViewerUser, mockWorkspace } from "./testHarness";

const db = vi.hoisted(() => ({ creator: [] as unknown[], fail: null as Error | null }));

vi.mock("../queries/connection", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      from: self,
      leftJoin: self,
      where: self,
      limit: self,
      then: (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        (db.fail ? Promise.reject(db.fail) : Promise.resolve(db.creator)).then(resolve, reject),
    });
    return c;
  };
  return { getDb: vi.fn(() => ({ select: () => chain() })) };
});
vi.mock("../services/publicApi/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/publicApi/tokens")>()),
  authenticateToken: vi.fn(),
}));
vi.mock("../auth/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/service")>()),
  sessionUser: vi.fn(),
}));
vi.mock("../services/workspaceGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/workspaceGuard")>()),
  resolveUserWorkspace: vi.fn(),
}));

import { sessionUser } from "../auth/service";
import { resolveUserWorkspace } from "../services/workspaceGuard";
import { authenticateToken } from "../services/publicApi/tokens";
import { NO_MODULES, resolvePrincipal } from "../services/publicApi/principal";

const TOKEN = "Bearer ontos_abcdefgh_" + "A".repeat(32);
const apiToken = (over: Partial<ApiToken> = {}): ApiToken => ({
  id: 5,
  workspaceId: mockWorkspace.id,
  name: "CI sync",
  prefix: "ontos_abcdefgh",
  tokenHash: "h",
  role: "admin",
  scopes: ["read", "actions"],
  moduleScope: null,
  createdBy: "Elena",
  createdByUserId: 42,
  createdAt: new Date(),
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});
const withToken = (t: ApiToken | null) => vi.mocked(authenticateToken).mockResolvedValue(t && ({ token: t, workspace: mockWorkspace } as never));
const creator = (row: Record<string, unknown> | null) => {
  db.creator = row ? [row] : [];
};
const principalFor = async (headers: Record<string, string>) => {
  const r = await resolvePrincipal(new Headers(headers));
  if (!r.ok) throw new Error(`refused ${r.status} ${r.code}`);
  return r.principal;
};

const saved = { isProduction: env.isProduction, allowDemoLogin: env.allowDemoLogin };
beforeEach(() => {
  db.fail = null;
  creator({ userRole: "user", email: "elena@acme.com", memberRole: "editor", moduleScope: null });
});
afterEach(() => {
  Object.assign(env, saved);
  vi.clearAllMocks();
});

describe("an API token", () => {
  it("acts with the lower of its role and its creator's role now", async () => {
    withToken(apiToken({ role: "admin" })); // created while its creator was an admin; now an editor
    expect((await principalFor({ authorization: TOKEN })).role).toBe("editor");
    withToken(apiToken({ role: "viewer" }));
    expect((await principalFor({ authorization: TOKEN })).role).toBe("viewer");
  });

  it("is narrowed by its creator's module scope, and allows no module when the two do not overlap", async () => {
    creator({ userRole: "user", email: "e@acme.com", memberRole: "admin", moduleScope: ["hr", "legal"] });
    withToken(apiToken({ moduleScope: ["legal", "finance"] }));
    expect((await principalFor({ authorization: TOKEN })).moduleScope).toEqual(["legal"]);
    withToken(apiToken({ moduleScope: ["finance"] }));
    expect((await principalFor({ authorization: TOKEN })).moduleScope).toEqual([NO_MODULES]);
  });

  it("stops working when its creator loses access to the workspace", async () => {
    withToken(apiToken());
    creator(null); // the account is gone
    expect(await resolvePrincipal(new Headers({ authorization: TOKEN }))).toMatchObject({ ok: false, status: 401, code: "invalid_token" });
    creator({ userRole: "user", email: "e@acme.com", memberRole: null, moduleScope: null }); // removed from the workspace
    expect(await resolvePrincipal(new Headers({ authorization: TOKEN }))).toMatchObject({ ok: false, status: 401 });
  });

  it("made by a persona stops when persona login is off in production, as the persona's sessions do", async () => {
    creator({ userRole: "admin", email: "demo-admin@acme-ontology.com", memberRole: "admin", moduleScope: null });
    withToken(apiToken());
    Object.assign(env, { isProduction: true, allowDemoLogin: false });
    expect(await resolvePrincipal(new Headers({ authorization: TOKEN }))).toMatchObject({ ok: false, status: 401 });
    Object.assign(env, { isProduction: true, allowDemoLogin: true });
    expect((await principalFor({ authorization: TOKEN })).role).toBe("admin");
  });

  it("acts at its creator's role in the workspace, not the creator account's", async () => {
    creator({ userRole: "ontologist", email: "o@acme.com", memberRole: "viewer", moduleScope: null });
    withToken(apiToken({ role: "ontologist" }));
    expect((await principalFor({ authorization: TOKEN })).role).toBe("viewer");
  });

  it("with no creator on record keeps its own role", async () => {
    withToken(apiToken({ createdByUserId: null, role: "ontologist" }));
    expect((await principalFor({ authorization: TOKEN })).role).toBe("ontologist");
  });

  it("carries its scopes, its name for the audit trail, and its own rate limit", async () => {
    withToken(apiToken({ scopes: ["read", "bogus"] as never }));
    const p = await principalFor({ authorization: TOKEN });
    expect(p).toMatchObject({ kind: "token", scopes: ["read"], actor: "API token 'CI sync' (ontos_abcdefgh…)", userId: 42, limitKey: "token:5" });
  });

  it("is refused 401 when not valid, and answered 503 when it could not be checked", async () => {
    withToken(null);
    expect(await resolvePrincipal(new Headers({ authorization: TOKEN }))).toMatchObject({ ok: false, status: 401 });
    vi.mocked(authenticateToken).mockRejectedValue(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }));
    expect(await resolvePrincipal(new Headers({ authorization: TOKEN }))).toMatchObject({ ok: false, status: 503 });
    withToken(apiToken());
    db.fail = new Error("the creator lookup failed");
    expect(await resolvePrincipal(new Headers({ authorization: TOKEN }))).toMatchObject({ ok: false, status: 503 });
  });

  it("is used whenever the request names one, even alongside a session cookie", async () => {
    withToken(null);
    const r = await resolvePrincipal(new Headers({ authorization: "Bearer nonsense", cookie: "ontos_session=x" }));
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(sessionUser).not.toHaveBeenCalled();
  });
});

describe("a session", () => {
  it("may read, with its membership's role and module scope", async () => {
    vi.mocked(sessionUser).mockResolvedValue(mockViewerUser);
    vi.mocked(resolveUserWorkspace).mockResolvedValue({ workspace: mockWorkspace, membership: { ...mockViewerMembership, moduleScope: ["hr"] } });
    const p = await principalFor({ cookie: "ontos_session=x" });
    expect(p).toMatchObject({ kind: "session", role: "viewer", scopes: ["read"], moduleScope: ["hr"], limitKey: `user:${mockViewerUser.id}` });
  });

  it("takes the membership's role, whatever the account's own role, unless the account is a platform admin", async () => {
    vi.mocked(sessionUser).mockResolvedValue({ ...mockViewerUser, role: "ontologist" });
    vi.mocked(resolveUserWorkspace).mockResolvedValue({ workspace: mockWorkspace, membership: mockViewerMembership });
    expect((await principalFor({ cookie: "ontos_session=x" })).role).toBe("viewer");
    vi.mocked(sessionUser).mockResolvedValue({ ...mockViewerUser, role: "admin" });
    expect((await principalFor({ cookie: "ontos_session=x" })).role).toBe("admin");
  });

  it("is refused 401 without a session, 403 without a workspace, and answered 503 when it could not be checked", async () => {
    vi.mocked(sessionUser).mockResolvedValue(null);
    expect(await resolvePrincipal(new Headers())).toMatchObject({ ok: false, status: 401 });
    vi.mocked(sessionUser).mockRejectedValue(new Error("db down"));
    expect(await resolvePrincipal(new Headers())).toMatchObject({ ok: false, status: 503 });
    vi.mocked(sessionUser).mockResolvedValue(mockViewerUser);
    vi.mocked(resolveUserWorkspace).mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "not a member" }));
    expect(await resolvePrincipal(new Headers())).toMatchObject({ ok: false, status: 403 });
    vi.mocked(resolveUserWorkspace).mockRejectedValue(new Error("db down"));
    expect(await resolvePrincipal(new Headers())).toMatchObject({ ok: false, status: 503 });
    vi.mocked(resolveUserWorkspace).mockResolvedValue({ workspace: mockWorkspace, membership: mockAdminMembership });
    expect((await principalFor({})).role).toBe("admin");
  });
});
