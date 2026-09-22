import { z } from "zod";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLog, users, workspaceMembers } from "@db/schema";
import {
  createRouter,
  workspaceQuery,
  workspaceAdminQuery,
  workspaceAdminMutation,
} from "./middleware";
import { getDb } from "./queries/connection";
import {
  actorLabelFor,
  verifyAuditChain,
  writeAudit,
} from "./services/audit";

import { llmGateway } from "./services/llmGateway";

export const adminRouter = createRouter({
  getWorkspace: workspaceQuery.query(async ({ ctx }) => {
    return ctx.workspace;
  }),

  listMembers: workspaceAdminQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, ws.id));
    const userIds = rows.map((m) => m.userId);
    const userRows = userIds.length
      ? await db.select().from(users).where(inArray(users.id, userIds))
      : [];
    const userMap = new Map(userRows.map((u) => [u.id, u]));
    return rows.map((m) => ({
      ...m,
      user: userMap.get(m.userId) ?? null,
    }));
  }),

  updateMemberRole: workspaceAdminMutation
    .input(
      z.object({
        memberId: z.number().int().positive(),
        role: z.enum(["viewer", "editor", "ontologist", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [m] = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.id, input.memberId), eq(workspaceMembers.workspaceId, ws.id)))
        .limit(1);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: `Member ${input.memberId} not found` });
      const before = m.role;
      await db.update(workspaceMembers).set({ role: input.role }).where(eq(workspaceMembers.id, m.id));
      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Changed member role ${before} → ${input.role}`,
        entityType: "workspace_member",
        entityId: m.id,
        payload: { memberId: m.id, userId: m.userId, from: before, to: input.role },
      });
      const [row] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, m.id));
      return row;
    }),

  listAudit: workspaceQuery
    .input(
      z
        .object({
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const conds = [eq(auditLog.workspaceId, ws.id)];
      if (input?.cursor) conds.push(lt(auditLog.id, input.cursor));
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(...conds))
        .orderBy(desc(auditLog.id))
        .limit((input?.limit ?? 30) + 1);
      const limit = input?.limit ?? 30;
      const entries = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? entries[entries.length - 1]?.id ?? null : null;
      const chainValid = await verifyAuditChain(ws.id);
      return { entries, nextCursor, chainValid };
    }),

  getProviders: workspaceAdminQuery.query(async () => {
    return await llmGateway.getProviderStatuses();
  }),
});


