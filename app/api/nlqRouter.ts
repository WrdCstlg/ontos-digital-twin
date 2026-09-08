import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getDemoWorkspace } from "./services/audit";
import { executeGenerated, translate, NLQ_SUGGESTIONS } from "./services/nlq";

export const nlqRouter = createRouter({
  translate: publicQuery
    .input(z.object({ question: z.string().min(1).max(1000) }))
    .query(({ input }) => translate(input.question)),

  suggestions: publicQuery.query(() => NLQ_SUGGESTIONS),

  execute: publicQuery
    .input(z.object({ sparql: z.string().min(1).max(20_000) }))
    .mutation(async ({ input }) => {
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
