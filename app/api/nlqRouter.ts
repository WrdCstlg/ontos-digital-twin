import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, workspaceQuery, workspaceMutation } from "./middleware";
import { enforceLimit, nlqRateLimiter } from "./lib/rateLimit";
import { executeGenerated, translate, NLQ_SUGGESTIONS } from "./services/nlq";

export const nlqRouter = createRouter({
  translate: workspaceQuery
    .input(z.object({ question: z.string().min(1).max(500) }))
    .query(async ({ ctx, input }) => {
      await enforceLimit(
        nlqRateLimiter,
        String(ctx.user?.id ?? "anon"),
        (seconds) => `NLQ rate limit exceeded. Please wait ${seconds} seconds.`,
      );
      return await translate(input.question);
    }),


  suggestions: workspaceQuery.query(() => NLQ_SUGGESTIONS),

  execute: workspaceMutation
    .input(z.object({ sparql: z.string().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      await enforceLimit(
        nlqRateLimiter,
        String(ctx.user?.id ?? "anon"),
        (seconds) => `NLQ execution rate limit exceeded. Please wait ${seconds} seconds.`,
      );
      const ws = ctx.workspace;
      try {
        return await executeGenerated(input.sparql, ws.id);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Query refused",
        });
      }
    }),
});

