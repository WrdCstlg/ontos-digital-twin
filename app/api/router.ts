import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { ontologyRouter } from "./ontologyRouter";
import { graphRouter } from "./graphRouter";
import { mappingRouter } from "./mappingRouter";
import { insightsRouter } from "./insightsRouter";
import { nlqRouter } from "./nlqRouter";
import { adminRouter } from "./adminRouter";
import { dashboardRouter } from "./dashboardRouter";
import { twinRouter } from "./twinRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  ontology: ontologyRouter,
  graph: graphRouter,
  mapping: mappingRouter,
  insights: insightsRouter,
  nlq: nlqRouter,
  admin: adminRouter,
  dashboard: dashboardRouter,
  twin: twinRouter,
});

export type AppRouter = typeof appRouter;
