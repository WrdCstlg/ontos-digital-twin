import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { apiTokens } from "@db/schema";
import { ACTION_ROLES } from "@contracts/actions";
import { createRouter, workspaceMutation, workspaceQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { actorLabelFor } from "./services/audit";
import { hasWorkspaceRole } from "./services/workspaceGuard";
import { TOKEN_SCOPES, TokenRefused, createToken, listTokens, revokeToken } from "./services/publicApi/tokens";
import { ontologyModels } from "./publicApiRoutes";

/**
 * API tokens for the Ontology API, for the Developers page. Any member may
 * create tokens for themselves, with a role no higher than their own; a
 * token's full value is shown once, when it is created. Members see and
 * revoke their own tokens; workspace admins see and revoke every token.
 */
export const developerRouter = createRouter({
  /** Where the API is and what it serves, for the Developers page. */
  summary: workspaceQuery.query(async ({ ctx }) => {
    const model = await ontologyModels.get(ctx.workspace);
    const exampleType = model.objectTypes.find((t) => !t.deprecated) ?? model.objectTypes[0];
    const exampleAction = model.actionTypes[0];
    return {
      basePath: "/api/v1",
      ontologyVersion: model.version,
      objectTypes: model.objectTypes.length,
      actionTypes: model.actionTypes.length,
      canManageAll: hasWorkspaceRole(ctx.membership, ctx.user, ["admin"]),
      // Real names from this ontology, for the page's examples.
      example: {
        objectType: exampleType ? { iri: exampleType.iri, path: `/objects/${exampleType.prefix}/${exampleType.localName}` } : null,
        action: exampleAction ? { key: exampleAction.key, params: exampleAction.parameters.filter((p) => p.required).map((p) => ({ name: p.name, type: p.type })) } : null,
      },
    };
  }),

  listTokens: workspaceQuery.query(async ({ ctx }) => {
    const all = await listTokens(ctx.workspace.id);
    const mine = (t: (typeof all)[number]) => t.createdByUserId === ctx.user.id;
    return hasWorkspaceRole(ctx.membership, ctx.user, ["admin"]) ? all.map((t) => ({ ...t, mine: mine(t) })) : all.filter(mine).map((t) => ({ ...t, mine: true }));
  }),

  createToken: workspaceMutation
    .input(
      z.object({
        name: z.string().trim().min(1).max(128),
        role: z.enum(ACTION_ROLES),
        scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).max(TOKEN_SCOPES.length),
        moduleScope: z.array(z.string().trim().min(1).max(64)).max(20).nullish(),
        expiresInDays: z.number().int().min(1).max(365).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createToken(
          ctx.workspace.id,
          { name: actorLabelFor(ctx.user), userId: ctx.user.id, userRole: ctx.user.role, memberRole: ctx.membership.role },
          input,
        );
      } catch (err) {
        if (err instanceof TokenRefused) throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        throw err;
      }
    }),

  revokeToken: workspaceMutation.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const [token] = await getDb()
      .select({ createdByUserId: apiTokens.createdByUserId })
      .from(apiTokens)
      .where(and(eq(apiTokens.id, input.id), eq(apiTokens.workspaceId, ctx.workspace.id)))
      .limit(1);
    if (!token) throw new TRPCError({ code: "NOT_FOUND", message: "No such token" });
    if (token.createdByUserId !== ctx.user.id && !hasWorkspaceRole(ctx.membership, ctx.user, ["admin"])) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only a workspace admin may revoke someone else's token" });
    }
    await revokeToken(ctx.workspace.id, input.id, actorLabelFor(ctx.user));
    return { revoked: true };
  }),
});
