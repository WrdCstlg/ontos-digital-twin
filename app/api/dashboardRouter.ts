import { and, count, desc, eq, isNull } from "drizzle-orm";
import {
  auditLog,
  graphSnapshots,
  insights,
  kgEdges,
  kgNodes,
  ontologyClasses,
  ontologyModules,
  syncJobs,
  mappings,
  connectors,
} from "@db/schema";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { getDemoWorkspace } from "./services/audit";

export const dashboardRouter = createRouter({
  overview: authedQuery.query(async () => {
    const ws = await getDemoWorkspace();
    const db = getDb();
    const [n] = await db
      .select({ n: count() })
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, ws.id), isNull(kgNodes.deletedAt)));
    const [e] = await db
      .select({ n: count() })
      .from(kgEdges)
      .where(and(eq(kgEdges.workspaceId, ws.id), isNull(kgEdges.deletedAt)));
    const mods = await db
      .select()
      .from(ontologyModules)
      .where(eq(ontologyModules.workspaceId, ws.id));
    let classTotal = 0;
    for (const m of mods) {
      const [cc] = await db
        .select({ n: count() })
        .from(ontologyClasses)
        .where(eq(ontologyClasses.moduleId, m.id));
      classTotal += Number(cc.n);
    }
    const [openInsights] = await db
      .select({ n: count() })
      .from(insights)
      .where(and(eq(insights.workspaceId, ws.id), eq(insights.status, "open")));
    const conns = await db.select().from(connectors).where(eq(connectors.workspaceId, ws.id));
    let lastSync: typeof syncJobs.$inferSelect | null = null;
    if (conns.length) {
      const maps = await db.select().from(mappings);
      const mapIds = maps.filter((m) => conns.some((cn) => cn.id === m.connectorId)).map((m) => m.id);
      if (mapIds.length) {
        const jobs = await db.select().from(syncJobs).orderBy(desc(syncJobs.id)).limit(50);
        lastSync = jobs.find((j) => mapIds.includes(j.mappingId)) ?? null;
      }
    }
    const [snap] = await db
      .select()
      .from(graphSnapshots)
      .where(eq(graphSnapshots.workspaceId, ws.id))
      .orderBy(desc(graphSnapshots.id))
      .limit(1);
    return {
      workspace: { id: ws.id, name: ws.name, slug: ws.slug, plan: ws.plan },
      kpis: {
        totalNodes: Number(n.n),
        totalEdges: Number(e.n),
        totalClasses: classTotal,
        modulesActive: mods.filter((m) => m.status === "active").length,
        openInsights: Number(openInsights.n),
        lastSync,
        snapshot: snap ?? null,
      },
    };
  }),

  moduleHealth: authedQuery.query(async () => {
    const ws = await getDemoWorkspace();
    const db = getDb();
    const mods = await db
      .select()
      .from(ontologyModules)
      .where(eq(ontologyModules.workspaceId, ws.id));
    const nodeRows = await db
      .select({ moduleKey: kgNodes.moduleKey, n: count() })
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, ws.id), isNull(kgNodes.deletedAt)))
      .groupBy(kgNodes.moduleKey);
    const nodeByModule = new Map(nodeRows.map((r) => [r.moduleKey, Number(r.n)]));
    const edgeRows = await db
      .select({ moduleKey: kgEdges.moduleKey, n: count() })
      .from(kgEdges)
      .where(and(eq(kgEdges.workspaceId, ws.id), isNull(kgEdges.deletedAt)))
      .groupBy(kgEdges.moduleKey);
    const edgeByModule = new Map(edgeRows.map((r) => [r.moduleKey ?? "cross", Number(r.n)]));
    return mods.map((m) => ({
      key: m.key,
      name: m.name,
      prefix: m.prefix,
      color: m.color,
      version: m.version,
      status: m.status,
      instances: nodeByModule.get(m.key) ?? 0,
      edges: edgeByModule.get(m.key) ?? 0,
    }));
  }),

  recentActivity: authedQuery.query(async () => {
    const ws = await getDemoWorkspace();
    const db = getDb();
    return db
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, ws.id))
      .orderBy(desc(auditLog.id))
      .limit(20);
  }),

  insightPreview: authedQuery.query(async () => {
    const ws = await getDemoWorkspace();
    const db = getDb();
    return db
      .select()
      .from(insights)
      .where(and(eq(insights.workspaceId, ws.id), eq(insights.status, "open")))
      .orderBy(desc(insights.id))
      .limit(3);
  }),
});
