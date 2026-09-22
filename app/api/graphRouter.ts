import { z } from "zod";
import { and, count, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  connectors,
  graphSnapshots,
  kgEdges,
  kgNodes,
  mappings,
  ontologyModules,
  type Workspace,
} from "@db/schema";
import { createRouter, workspaceQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { semanticEngine } from "./services/semanticEngine";

async function resolveWorkspace(userWorkspace: Workspace, workspaceKey?: string) {
  if (!workspaceKey) return userWorkspace;
  if (workspaceKey !== userWorkspace.slug && workspaceKey !== String(userWorkspace.id) && workspaceKey !== userWorkspace.name) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `User does not have access to workspace '${workspaceKey}'`,
    });
  }
  return userWorkspace;
}

export const graphRouter = createRouter({
  stats: workspaceQuery
    .input(z.object({ workspaceKey: z.string().max(255).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const ws = await resolveWorkspace(ctx.workspace, input?.workspaceKey);
      const db = getDb();
      const nodeRows = await db
        .select({ moduleKey: kgNodes.moduleKey, n: count() })
        .from(kgNodes)
        .where(and(eq(kgNodes.workspaceId, ws.id), isNull(kgNodes.deletedAt)))
        .groupBy(kgNodes.moduleKey);
      const edgeRows = await db
        .select({ moduleKey: kgEdges.moduleKey, n: count() })
        .from(kgEdges)
        .where(and(eq(kgEdges.workspaceId, ws.id), isNull(kgEdges.deletedAt)))
        .groupBy(kgEdges.moduleKey);
      const [snap] = await db
        .select()
        .from(graphSnapshots)
        .where(eq(graphSnapshots.workspaceId, ws.id))
        .orderBy(desc(graphSnapshots.id))
        .limit(1);
      const byModule: Record<string, { nodes: number; edges: number }> = {};
      let totalNodes = 0;
      let totalEdges = 0;
      for (const r of nodeRows) {
        byModule[r.moduleKey] = byModule[r.moduleKey] ?? { nodes: 0, edges: 0 };
        byModule[r.moduleKey].nodes = Number(r.n);
        totalNodes += Number(r.n);
      }
      for (const r of edgeRows) {
        const k = r.moduleKey ?? "cross";
        byModule[k] = byModule[k] ?? { nodes: 0, edges: 0 };
        byModule[k].edges = Number(r.n);
        totalEdges += Number(r.n);
      }
      return {
        workspace: { id: ws.id, name: ws.name, slug: ws.slug },
        totals: { nodes: totalNodes, edges: totalEdges },
        byModule,
        snapshot: snap ?? null,
      };
    }),

  searchNodes: workspaceQuery
    .input(
      z.object({
        q: z.string().min(1).max(255),
        moduleKey: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const pattern = `%${input.q}%`;
      const conds = [
        eq(kgNodes.workspaceId, ws.id),
        isNull(kgNodes.deletedAt),
        or(like(kgNodes.label, pattern), like(kgNodes.iri, pattern)),
      ];
      if (input.moduleKey) conds.push(eq(kgNodes.moduleKey, input.moduleKey));
      const rows = await db
        .select()
        .from(kgNodes)
        .where(and(...conds))
        .orderBy(kgNodes.id)
        .limit(input.limit);
      return rows;
    }),

  getSubgraph: workspaceQuery
    .input(
      z.object({
        centerIri: z.string().min(1).max(512),
        depth: z.union([z.literal(1), z.literal(2)]).default(1),
        limit: z.number().int().min(1).max(500).default(80),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [center] = await db
        .select()
        .from(kgNodes)
        .where(
          and(
            eq(kgNodes.workspaceId, ws.id),
            eq(kgNodes.iri, input.centerIri),
            isNull(kgNodes.deletedAt),
          ),
        )
        .limit(1);
      if (!center)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Node '${input.centerIri}' not found`,
        });

      const nodeMap = new Map<number, typeof center>();
      nodeMap.set(center.id, center);
      const edgeMap = new Map<number, typeof kgEdges.$inferSelect>();
      let frontier = [center.id];
      for (let d = 0; d < input.depth; d++) {
        const edges = await db
          .select()
          .from(kgEdges)
          .where(
            and(
              eq(kgEdges.workspaceId, ws.id),
              isNull(kgEdges.deletedAt),
              or(
                inArray(kgEdges.fromNodeId, frontier),
                inArray(kgEdges.toNodeId, frontier),
              ),
            ),
          )
          .limit(input.limit * 4);
        const nextIds = new Set<number>();
        for (const e of edges) {
          edgeMap.set(e.id, e);
          if (!nodeMap.has(e.fromNodeId)) nextIds.add(e.fromNodeId);
          if (!nodeMap.has(e.toNodeId)) nextIds.add(e.toNodeId);
        }
        if (nextIds.size === 0) break;
        const ids = [...nextIds].slice(0, input.limit);
        const nodes = await db
          .select()
          .from(kgNodes)
          .where(
            and(
              eq(kgNodes.workspaceId, ws.id),
              inArray(kgNodes.id, ids),
              isNull(kgNodes.deletedAt),
            ),
          );
        for (const n of nodes) nodeMap.set(n.id, n);
        frontier = ids;
      }
      // drop edges whose endpoints fell outside the node window
      const edges = [...edgeMap.values()].filter(
        (e) => nodeMap.has(e.fromNodeId) && nodeMap.has(e.toNodeId),
      );
      return {
        center: input.centerIri,
        depth: input.depth,
        nodes: [...nodeMap.values()],
        edges,
      };
    }),

  getNode: workspaceQuery
    .input(z.object({ iri: z.string().min(1).max(512) }))
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [node] = await db
        .select()
        .from(kgNodes)
        .where(
          and(
            eq(kgNodes.workspaceId, ws.id),
            eq(kgNodes.iri, input.iri),
            isNull(kgNodes.deletedAt),
          ),
        )
        .limit(1);
      if (!node)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Node '${input.iri}' not found`,
        });
      const outgoing = await db
        .select()
        .from(kgEdges)
        .where(
          and(
            eq(kgEdges.workspaceId, ws.id),
            eq(kgEdges.fromNodeId, node.id),
            isNull(kgEdges.deletedAt),
          ),
        )
        .limit(200);
      const incoming = await db
        .select()
        .from(kgEdges)
        .where(
          and(
            eq(kgEdges.workspaceId, ws.id),
            eq(kgEdges.toNodeId, node.id),
            isNull(kgEdges.deletedAt),
          ),
        )
        .limit(200);
      const neighborIds = [
        ...new Set([
          ...outgoing.map((e) => e.toNodeId),
          ...incoming.map((e) => e.fromNodeId),
        ]),
      ];
      const neighbors = neighborIds.length
        ? await db.select().from(kgNodes).where(inArray(kgNodes.id, neighborIds))
        : [];
      const nodeById = new Map(neighbors.map((n) => [n.id, n]));

      let provenance: {
        mapping: typeof mappings.$inferSelect | null;
        connector: typeof connectors.$inferSelect | null;
      } = { mapping: null, connector: null };
      if (node.sourceMappingId) {
        const [m] = await db
          .select()
          .from(mappings)
          .where(eq(mappings.id, node.sourceMappingId))
          .limit(1);
        if (m) {
          const [c] = await db
            .select()
            .from(connectors)
            .where(eq(connectors.id, m.connectorId))
            .limit(1);
          provenance = { mapping: m, connector: c ?? null };
        }
      }
      const mods = await db
        .select()
        .from(ontologyModules)
        .where(eq(ontologyModules.workspaceId, ws.id));
      const modByKey = new Map(mods.map((m) => [m.key, m]));

      const pack = (e: typeof kgEdges.$inferSelect, dir: "out" | "in") => {
        const other = dir === "out" ? nodeById.get(e.toNodeId) : nodeById.get(e.fromNodeId);
        return {
          edge: e,
          direction: dir,
          other: other ?? null,
          module: e.moduleKey ? (modByKey.get(e.moduleKey) ?? null) : null,
        };
      };
      return {
        node,
        module: modByKey.get(node.moduleKey) ?? null,
        outgoing: outgoing.map((e) => pack(e, "out")),
        incoming: incoming.map((e) => pack(e, "in")),
        provenance: {
          ...provenance,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        },
      };
    }),

  sparqlQuery: workspaceQuery
    .input(
      z.object({
        query: z.string().min(1).max(50000),
        autoSync: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const isAlive = await semanticEngine.ensureEngineRunning();
      if (!isAlive) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message:
            "Semantic engine is currently offline. Please ensure open-ontologies is running.",
        });
      }

      if (input.autoSync) {
        await semanticEngine.syncWorkspace(ws.id);
      }

      try {
        const res = await semanticEngine.querySparql(input.query);
        return {
          variables: res.variables,
          results: res.results,
          count: res.results.length,
        };
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `SPARQL execution failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  syncStore: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
    const isAlive = await semanticEngine.ensureEngineRunning();
    if (!isAlive) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Semantic engine is currently offline.",
      });
    }
    return semanticEngine.syncWorkspace(ws.id);
  }),
});
