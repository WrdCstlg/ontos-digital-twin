import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { workspaces, workspaceMembers } from "@db/schema";
import type { User, Workspace, WorkspaceMember } from "@db/schema";
import { getDb } from "../queries/connection";
import { DEMO_WORKSPACE_SLUG } from "./audit";

/**
 * Resolves the active workspace for an authenticated user and strictly validates
 * their membership and role.
 *
 * Workspace selection precedence:
 * 1. Explicit workspaceId override (procedure input)
 * 2. 'x-workspace-id' request header
 * 3. 'x-workspace-slug' request header
 * 4. User's primary/first workspace membership from workspace_members table
 * 5. Fallback to default demo workspace (for admin or during onboarding)
 *
 * Enforces strict geometric multi-tenancy:
 * If a target workspace is requested, non-member users are rejected with FORBIDDEN.
 */
export async function resolveUserWorkspace(
  user: User,
  headers?: Headers,
  overrideWorkspaceId?: number,
): Promise<{ workspace: Workspace; membership: WorkspaceMember }> {
  const db = getDb();

  // 1. Determine requested workspace ID or slug
  let targetId: number | undefined = overrideWorkspaceId;
  let targetSlug: string | undefined;

  if (!targetId && headers) {
    const headerId = headers.get("x-workspace-id");
    if (headerId && /^\d+$/.test(headerId)) {
      targetId = parseInt(headerId, 10);
    }
    const headerSlug = headers.get("x-workspace-slug");
    if (headerSlug) {
      targetSlug = headerSlug.trim();
    }
  }

  // 2. If a specific workspace was requested:
  if (targetId !== undefined || targetSlug !== undefined) {
    let ws: Workspace | undefined;
    if (targetId !== undefined) {
      const [row] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, targetId))
        .limit(1);
      ws = row;
    } else if (targetSlug) {
      const [row] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, targetSlug))
        .limit(1);
      ws = row;
    }

    if (!ws) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Workspace not found.`,
      });
    }

    // Check membership in the target workspace
    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.id),
          eq(workspaceMembers.userId, user.id),
        ),
      )
      .limit(1);

    if (membership) {
      return { workspace: ws, membership };
    }

    // System admin privilege: can access any workspace as admin
    if (user.role === "admin") {
      const adminMembership: WorkspaceMember = {
        id: 0,
        workspaceId: ws.id,
        userId: user.id,
        role: "admin",
        moduleScope: null,
        createdAt: new Date(),
      };
      return { workspace: ws, membership: adminMembership };
    }

    // Strict multi-tenant rejection
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `User does not have access to workspace '${ws.slug}'.`,
    });
  }

  // 3. If no target workspace was specified, resolve user's primary membership
  const memberRows = await db
    .select({
      membership: workspaceMembers,
      workspace: workspaces,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1);

  if (memberRows.length > 0) {
    return {
      workspace: memberRows[0].workspace,
      membership: memberRows[0].membership,
    };
  }

  // 4. If user has no memberships:
  // System admins can bootstrap — they need access to create workspaces and enroll users.
  // All other users are strictly rejected: no membership = no access.
  if (user.role === "admin") {
    const [fallbackWs] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, DEMO_WORKSPACE_SLUG))
      .limit(1);

    const ws =
      fallbackWs || (await db.select().from(workspaces).limit(1))[0];

    if (!ws) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No workspace available. Please initialize or seed a workspace.",
      });
    }

    const adminMembership: WorkspaceMember = {
      id: 0,
      workspaceId: ws.id,
      userId: user.id,
      role: "admin",
      moduleScope: null,
      createdAt: new Date(),
    };
    return { workspace: ws, membership: adminMembership };
  }

  // Non-admin with no memberships: strict rejection
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "User is not a member of any workspace. Contact an administrator to be enrolled.",
  });
}

/** Check if user/membership has the required workspace-level role */
export function hasWorkspaceRole(
  membership: WorkspaceMember,
  user: User,
  allowedRoles: string[],
): boolean {
  if (user.role === "admin") return true;
  if (allowedRoles.includes(membership.role)) return true;
  if (allowedRoles.includes(user.role)) return true;
  return false;
}
