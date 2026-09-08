import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery, authedMutation } from "./middleware";
import { nlqRateLimiter } from "./lib/rateLimit";
import { getDemoWorkspace } from "./services/audit";
import { executeGenerated, translate, NLQ_SUGGESTIONS } from "./services/nlq";

export const nlqRouter = createRouter({
  translate: authedQuery
    .input(z.object({ question: z.string().min(1).max(500) }))
    .query(({ ctx, input }) => {
      const rl = nlqRateLimiter.check(String(ctx.user?.id ?? "anon"));
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `NLQ rate limit exceeded. Please wait ${Math.ceil(rl.resetMs / 1000)} seconds.`,
        });
      }
      return translate(input.question);
    }),

  suggestions: authedQuery.query(() => NLQ_SUGGESTIONS),

  execute: authedMutation
    .input(z.object({ sparql: z.string().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      const rl = nlqRateLimiter.check(String(ctx.user?.id ?? "anon"));
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `NLQ execution rate limit exceeded. Please wait ${Math.ceil(rl.resetMs / 1000)} seconds.`,
        });
      }
      const ws = await getDemoWorkspace();
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

