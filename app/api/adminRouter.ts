import { z } from "zod";
import { and, desc, eq, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLog, users, workspaceMembers } from "@db/schema";
import { LLM_PROVIDERS } from "@contracts/providers";
import {
  createRouter,
  authedQuery,
  adminQuery,
  adminMutation,
} from "./middleware";
import { getDb } from "./queries/connection";
import {
  actorLabelFor,
  getDemoWorkspace,
  verifyAuditChain,
  writeAudit,
} from "./services/audit";

export const adminRouter = createRouter({
  getWorkspace: authedQuery.query(async () => {
    const ws = await getDemoWorkspace();
    return ws;
  }),

  listMembers: adminQuery.query(async () => {
    const ws = await getDemoWorkspace();
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, ws.id));
    const withUsers = [];
    for (const m of rows) {
      const [u] = await db.select().from(users).where(eq(users.id, m.userId)).limit(1);
      withUsers.push({ ...m, user: u ?? null });
    }
    return withUsers;
  }),

  updateMemberRole: adminMutation
    .input(
      z.object({
        memberId: z.number().int().positive(),
        role: z.enum(["viewer", "editor", "ontologist", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ws = await getDemoWorkspace();
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

  listAudit: authedQuery
    .input(
      z
        .object({
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const ws = await getDemoWorkspace();
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

  getProviders: adminQuery.query(() => LLM_PROVIDERS),
});

