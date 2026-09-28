import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { users, workspaceMembers, type ApiToken, type Workspace } from "@db/schema";
import { ACTION_ROLES, type ActionRole } from "@contracts/actions";
import { getDb } from "../../queries/connection";
import { isDemoPersona, sessionUser } from "../../auth/service";
import { env } from "../../lib/env";
import { actorLabelFor } from "../audit";
import { scopeOf } from "../actions/engine";
import { resolveUserWorkspace } from "../workspaceGuard";
import { authenticateToken, type TokenScope } from "./tokens";

/**
 * Who is calling the Ontology API, and what they may do.
 *
 * An API token acts in its own workspace with its own role, scopes and module
 * scope, but never beyond what its creator may do there now: the lower role
 * wins, module scopes narrow each other, and a creator who has lost access
 * (removed, or a persona once persona login is off) takes their tokens with
 * them. A signed-in session, such as the Developers page, may read; writes
 * need a token, which a browser never sends on its own.
 *
 * A token or session that could not be checked (the database is away) is an
 * outage, answered 503, never "not signed in" (compare fix a47caf6).
 */

export type Principal = {
  kind: "token" | "session";
  workspace: Workspace;
  /** The role it acts with in this workspace. */
  role: ActionRole;
  /** Module keys it may submit actions in; empty means every module. */
  moduleScope: string[];
  scopes: TokenScope[];
  /** How the audit trail names it. */
  actor: string;
  userId: number | null;
  /** The key its requests are rate-limited under. */
  limitKey: string;
};

export type Refusal = { status: 401 | 403 | 503; code: string; message: string };
export type PrincipalResult = { ok: true; principal: Principal } | ({ ok: false } & Refusal);

const RANK: Record<ActionRole, number> = { viewer: 0, editor: 1, ontologist: 2, admin: 3 };
const isRole = (r: unknown): r is ActionRole => typeof r === "string" && (ACTION_ROLES as readonly string[]).includes(r);

/**
 * A member's role in the workspace, as the API acts on it. The workspace role
 * decides; the account's own role counts only as a platform administrator's.
 */
function workspaceRole(userRole: unknown, memberRole: unknown): ActionRole | null {
  if (userRole === "admin") return "admin";
  return isRole(memberRole) ? memberRole : null;
}

function lower(a: ActionRole, b: ActionRole): ActionRole {
  return RANK[a] <= RANK[b] ? a : b;
}

/** A scope that matches no module: two scopes that do not overlap allow none. */
export const NO_MODULES = "(none)";

/** Module scopes narrow each other: empty means every module. */
export function narrowScopes(a: string[], b: string[]): string[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const both = a.filter((k) => b.includes(k));
  return both.length ? both : [NO_MODULES];
}

const unavailable: Refusal = {
  status: 503,
  code: "unavailable",
  message: "Your token or session could not be checked just now. Retry in a moment.",
};

/** What the token's creator may do in the token's workspace now, or null if nothing. */
async function creatorAccess(token: ApiToken): Promise<{ role: ActionRole; moduleScope: string[] } | null> {
  if (token.createdByUserId == null) return { role: token.role, moduleScope: [] };
  const [row] = await getDb()
    .select({ userRole: users.role, email: users.email, memberRole: workspaceMembers.role, moduleScope: workspaceMembers.moduleScope })
    .from(users)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, token.workspaceId)))
    .where(eq(users.id, token.createdByUserId))
    .limit(1);
  if (!row) return null;
  // A persona's tokens stop with persona login, as its sessions do.
  if (env.isProduction && !env.allowDemoLogin && isDemoPersona(row.email)) return null;
  if (row.memberRole) {
    const role = workspaceRole(row.userRole, row.memberRole);
    return role ? { role, moduleScope: row.userRole === "admin" ? [] : scopeOf(row.moduleScope) } : null;
  }
  // Without a membership, as for sessions: only a system administrator, and only outside production.
  return row.userRole === "admin" && !env.isProduction ? { role: "admin", moduleScope: [] } : null;
}

async function tokenPrincipal(authorization: string): Promise<PrincipalResult> {
  let found: Awaited<ReturnType<typeof authenticateToken>>;
  let creator: Awaited<ReturnType<typeof creatorAccess>>;
  try {
    found = await authenticateToken(authorization);
    if (!found) {
      return { ok: false, status: 401, code: "invalid_token", message: "The API token is missing, malformed, unknown, revoked or expired." };
    }
    creator = await creatorAccess(found.token);
  } catch {
    return { ok: false, ...unavailable };
  }
  if (!creator) {
    return { ok: false, status: 401, code: "invalid_token", message: "The person who created this token no longer has access to its workspace." };
  }
  const { token, workspace } = found;
  return {
    ok: true,
    principal: {
      kind: "token",
      workspace,
      role: lower(token.role, creator.role),
      moduleScope: narrowScopes(scopeOf(token.moduleScope), creator.moduleScope),
      scopes: (Array.isArray(token.scopes) ? token.scopes : []).filter((s): s is TokenScope => s === "read" || s === "actions"),
      actor: `API token '${token.name}' (${token.prefix}…)`,
      userId: token.createdByUserId,
      limitKey: `token:${token.id}`,
    },
  };
}

async function sessionPrincipal(headers: Headers): Promise<PrincipalResult> {
  let user: Awaited<ReturnType<typeof sessionUser>>;
  try {
    user = await sessionUser(headers);
  } catch {
    return { ok: false, ...unavailable };
  }
  if (!user) {
    return { ok: false, status: 401, code: "unauthenticated", message: "Send an API token: Authorization: Bearer ontos_…" };
  }
  let resolved: Awaited<ReturnType<typeof resolveUserWorkspace>>;
  try {
    resolved = await resolveUserWorkspace(user, headers);
  } catch (err) {
    if (err instanceof TRPCError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) {
      return { ok: false, status: 403, code: "no_workspace", message: err.message };
    }
    return { ok: false, ...unavailable };
  }
  const role = workspaceRole(user.role, resolved.membership.role) ?? "viewer";
  return {
    ok: true,
    principal: {
      kind: "session",
      workspace: resolved.workspace,
      role,
      moduleScope: user.role === "admin" ? [] : scopeOf(resolved.membership.moduleScope),
      scopes: ["read"],
      actor: actorLabelFor(user),
      userId: user.id,
      limitKey: `user:${user.id}`,
    },
  };
}

/** The caller: a bearer token if the request names one, otherwise the session. */
export function resolvePrincipal(headers: Headers): Promise<PrincipalResult> {
  const authorization = headers.get("authorization");
  return authorization !== null ? tokenPrincipal(authorization) : sessionPrincipal(headers);
}
