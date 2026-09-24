import { z } from "zod";
import { and, desc, eq, inArray, isNull, like, lt, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { kgEdges, kgNodes, ontologyClasses, ontologyModules, twinStateLog } from "@db/schema";
import { createRouter, workspaceQuery, workspaceMutation, workspaceAdminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { actorLabelFor, writeAudit } from "./services/audit";
import {
  DTDL_QUANTITATIVE_TYPES_CONTEXT,
  DTDL_SEMANTIC_TYPES,
  DTDL_UNITS,
  LOGGED_NUMERIC_KEYS,
  SIMULATED_TWIN_CLASSES,
  TWIN_MODELS,
  TWIN_MODULE_KEY,
  TWIN_TOPOLOGY_PREDICATES,
  advanceTwinState,
  dtmiFor,
  type StateChange,
  type TwinState,
} from "./services/twinModels";

type KgNodeRow = typeof kgNodes.$inferSelect;

const listInput = z
  .object({
    classIri: z.string().max(512).optional(),
    q: z.string().max(255).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .optional();

function stateSummary(props: unknown): TwinState {
  const p = (props ?? {}) as TwinState;
  const out: TwinState = {};
  for (const k of [
    "status",
    "temperature",
    "humidity",
    "utilization",
    "etaMinutes",
    "batteryLevel",
    "lat",
    "lng",
    "zoneType",
    "equipmentType",
    "mirroredIri",
    "lastTickAt",
  ]) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  return out;
}

async function fetchTwinByIri(workspaceId: number, iri: string): Promise<KgNodeRow> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(kgNodes)
    .where(
      and(
        eq(kgNodes.workspaceId, workspaceId),
        eq(kgNodes.moduleKey, TWIN_MODULE_KEY),
        eq(kgNodes.iri, iri),
        isNull(kgNodes.deletedAt),
      ),
    )
    .limit(1);
  if (!node) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Twin '${iri}' not found` });
  }
  return node;
}

export const twinRouter = createRouter({
  /** Twins grouped by class, with current-state summary + zone/equipment counts. */
  listTwins: workspaceQuery.input(listInput).query(async ({ ctx, input }) => {
    const ws = ctx.workspace;
    const db = getDb();
    const conds = [
      eq(kgNodes.workspaceId, ws.id),
      eq(kgNodes.moduleKey, TWIN_MODULE_KEY),
      isNull(kgNodes.deletedAt),
    ];
    if (input?.classIri) conds.push(eq(kgNodes.classIri, input.classIri));
    if (input?.q) {
      const pattern = `%${input.q}%`;
      conds.push(or(like(kgNodes.label, pattern), like(kgNodes.iri, pattern))!);
    }
    const rows = await db
      .select()
      .from(kgNodes)
      .where(and(...conds))
      .orderBy(kgNodes.classIri, kgNodes.iri)
      .limit(input?.limit ?? 100);
    const twins = rows.filter((r) => r.classIri !== "dtwin:TwinModel");

    // zone/equipment counts per facility twin (dtwin:contains)
    const facilityIds = twins
      .filter((t) => t.classIri === "dtwin:WarehouseTwin" || t.classIri === "dtwin:ZoneTwin")
      .map((t) => t.id);
    const countsByTwin = new Map<number, { zones: number; equipment: number }>();
    if (facilityIds.length) {
      const edges = await db
        .select()
        .from(kgEdges)
        .where(
          and(
            eq(kgEdges.workspaceId, ws.id),
            eq(kgEdges.predicateIri, "dtwin:contains"),
            inArray(kgEdges.fromNodeId, facilityIds),
            isNull(kgEdges.deletedAt),
          ),
        )
        .limit(2000);
      const targetIds = [...new Set(edges.map((e) => e.toNodeId))];
      const targets = targetIds.length
        ? await db.select().from(kgNodes).where(inArray(kgNodes.id, targetIds))
        : [];
      const classById = new Map(targets.map((t) => [t.id, t.classIri]));
      for (const e of edges) {
        const cls = classById.get(e.toNodeId);
        const bucket = countsByTwin.get(e.fromNodeId) ?? { zones: 0, equipment: 0 };
        if (cls === "dtwin:ZoneTwin") bucket.zones++;
        if (cls === "dtwin:EquipmentTwin") bucket.equipment++;
        countsByTwin.set(e.fromNodeId, bucket);
      }
    }

    const groups = new Map<string, { classIri: string; count: number; twins: unknown[] }>();
    for (const t of twins) {
      const g = groups.get(t.classIri) ?? { classIri: t.classIri, count: 0, twins: [] };
      g.count++;
      g.twins.push({
        iri: t.iri,
        label: t.label,
        classIri: t.classIri,
        state: stateSummary(t.propsJson),
        contains: countsByTwin.get(t.id) ?? undefined,
        updatedAt: t.updatedAt,
      });
      groups.set(t.classIri, g);
    }
    return {
      workspace: { id: ws.id, name: ws.name, slug: ws.slug },
      total: twins.length,
      groups: [...groups.values()],
    };
  }),

  /** One twin: node, model (class + hasModel target), state, topology subgraph, twinOf target. */
  getTwin: workspaceQuery
    .input(z.object({ iri: z.string().min(1).max(512) }))
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const node = await fetchTwinByIri(ws.id, input.iri);

      // model: ontology class + dtwin:hasModel target node
      const [twinModule] = await db
        .select()
        .from(ontologyModules)
        .where(and(eq(ontologyModules.workspaceId, ws.id), eq(ontologyModules.key, TWIN_MODULE_KEY)))
        .limit(1);
      const [klass] = twinModule
        ? await db
            .select()
            .from(ontologyClasses)
            .where(and(eq(ontologyClasses.moduleId, twinModule.id), eq(ontologyClasses.iri, node.classIri)))
            .limit(1)
        : [undefined];
      const hasModelEdges = await db
        .select()
        .from(kgEdges)
        .where(
          and(
            eq(kgEdges.workspaceId, ws.id),
            eq(kgEdges.fromNodeId, node.id),
            eq(kgEdges.predicateIri, "dtwin:hasModel"),
            isNull(kgEdges.deletedAt),
          ),
        )
        .limit(1);
      let modelNode: KgNodeRow | null = null;
      if (hasModelEdges[0]) {
        const [m] = await db.select().from(kgNodes).where(eq(kgNodes.id, hasModelEdges[0].toNodeId)).limit(1);
        modelNode = m ?? null;
      }

      // topology subgraph: twin predicates, 2 hops (undirected)
      const nodeMap = new Map<number, KgNodeRow>([[node.id, node]]);
      const edgeMap = new Map<number, typeof kgEdges.$inferSelect>();
      let frontier = [node.id];
      for (let d = 0; d < 2; d++) {
        const edges = await db
          .select()
          .from(kgEdges)
          .where(
            and(
              eq(kgEdges.workspaceId, ws.id),
              isNull(kgEdges.deletedAt),
              inArray(kgEdges.predicateIri, [...TWIN_TOPOLOGY_PREDICATES]),
              or(inArray(kgEdges.fromNodeId, frontier), inArray(kgEdges.toNodeId, frontier)),
            ),
          )
          .limit(400);
        const nextIds = new Set<number>();
        for (const e of edges) {
          edgeMap.set(e.id, e);
          if (!nodeMap.has(e.fromNodeId)) nextIds.add(e.fromNodeId);
          if (!nodeMap.has(e.toNodeId)) nextIds.add(e.toNodeId);
        }
        if (!nextIds.size) break;
        const ids = [...nextIds].slice(0, 120);
        const nodes = await db
          .select()
          .from(kgNodes)
          .where(and(inArray(kgNodes.id, ids), isNull(kgNodes.deletedAt)));
        for (const n of nodes) nodeMap.set(n.id, n);
        frontier = ids;
      }
      const subgraphEdges = [...edgeMap.values()].filter(
        (e) => nodeMap.has(e.fromNodeId) && nodeMap.has(e.toNodeId),
      );

      // twinOf target (mirrored business node)
      const twinOfEdge = [...edgeMap.values()].find(
        (e) => e.fromNodeId === node.id && e.predicateIri === "dtwin:twinOf",
      );
      const twinOfTarget = twinOfEdge ? (nodeMap.get(twinOfEdge.toNodeId) ?? null) : null;

      return {
        twin: node,
        state: stateSummary(node.propsJson),
        model: {
          class: klass ?? null,
          modelNode,
          dtdlId: modelNode
            ? ((modelNode.propsJson as { dtdlId?: string } | null)?.dtdlId ?? null)
            : null,
        },
        twinOf: twinOfTarget
          ? {
              iri: twinOfTarget.iri,
              label: twinOfTarget.label,
              classIri: twinOfTarget.classIri,
              moduleKey: twinOfTarget.moduleKey,
              props: twinOfTarget.propsJson,
            }
          : null,
        topology: {
          nodes: [...nodeMap.values()].map((n) => ({
            id: n.id,
            iri: n.iri,
            label: n.label,
            classIri: n.classIri,
            moduleKey: n.moduleKey,
          })),
          edges: subgraphEdges,
        },
      };
    }),

  /** Time-ordered telemetry series from twin_state_log (ascending recordedAt). */
  getStateHistory: workspaceQuery
    .input(
      z.object({
        iri: z.string().min(1).max(512),
        key: z.string().min(1).max(64),
        points: z.number().int().min(1).max(500).default(48),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const node = await fetchTwinByIri(ws.id, input.iri);
      const rows = await db
        .select()
        .from(twinStateLog)
        .where(and(eq(twinStateLog.nodeId, node.id), eq(twinStateLog.key, input.key)))
        .orderBy(desc(twinStateLog.recordedAt))
        .limit(input.points);
      rows.reverse();
      return {
        iri: node.iri,
        label: node.label,
        key: input.key,
        unit: rows[0]?.unit ?? null,
        points: rows.map((r) => ({
          recordedAt: r.recordedAt,
          valueNum: r.valueNum,
          valueText: r.valueText,
        })),
      };
    }),

  /**
   * Advance the twin simulation one step (≈ one hour): random-walk telemetry,
   * cold-chain drift toward 2-6°C, shipment ETA countdown + delivery flip,
   * equipment battery drain. Persists propsJson + appends twin_state_log.
   */
  tick: workspaceMutation
    .input(z.object({ iri: z.string().min(1).max(512).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const now = new Date();
      const conds = [
        eq(kgNodes.workspaceId, ws.id),
        eq(kgNodes.moduleKey, TWIN_MODULE_KEY),
        isNull(kgNodes.deletedAt),
      ];
      if (input?.iri) conds.push(eq(kgNodes.iri, input.iri));
      const rows = await db
        .select()
        .from(kgNodes)
        .where(and(...conds))
        .orderBy(kgNodes.iri)
        .limit(500);
      const twins = rows.filter((r) => SIMULATED_TWIN_CLASSES.has(r.classIri));
      if (input?.iri && !twins.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Simulated twin '${input.iri}' not found`,
        });
      }

      const changed: { iri: string; label: string; classIri: string; changes: StateChange[] }[] = [];
      const logRows: (typeof twinStateLog.$inferInsert)[] = [];
      for (const t of twins) {
        const state = ((t.propsJson ?? {}) as TwinState) ?? {};
        const { next, changes } = advanceTwinState(t.classIri, state, Math.random, now);
        if (!changes.length) continue;
        await db.update(kgNodes).set({ propsJson: next }).where(eq(kgNodes.id, t.id));
        for (const c of changes) {
          if (typeof c.new === "number" && LOGGED_NUMERIC_KEYS.has(c.key)) {
            logRows.push({
              nodeId: t.id,
              key: c.key,
              valueNum: c.new,
              valueText: null,
              unit: null,
              recordedAt: now,
            });
          } else if (c.key === "status" && typeof c.new === "string") {
            logRows.push({
              nodeId: t.id,
              key: "status",
              valueNum: null,
              valueText: c.new,
              unit: null,
              recordedAt: now,
            });
          }
        }
        changed.push({ iri: t.iri, label: t.label, classIri: t.classIri, changes });
      }
      for (let i = 0; i < logRows.length; i += 500) {
        await db.insert(twinStateLog).values(logRows.slice(i, i + 500));
      }

      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Advanced twin simulation tick — ${changed.length} twins updated`,
        entityType: "twin_tick",
        entityId: input?.iri ?? "all",
        payload: {
          tickedAt: now.toISOString(),
          twinsUpdated: changed.length,
          stateLogRows: logRows.length,
          sample: changed.slice(0, 5).map((c) => ({ iri: c.iri, changes: c.changes })),
        },
      });

      return { tickedAt: now.toISOString(), count: changed.length, twins: changed };
    }),

  /** DTDL v3 export: one twin's model (by twin IRI) or every twin model. */
  exportDtdl: workspaceQuery
    .input(z.object({ iri: z.string().min(1).max(512).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      let modelNames = TWIN_MODELS.map((m) => m.name);
      let forTwin: { iri: string; label: string; classIri: string } | null = null;
      if (input?.iri) {
        const node = await fetchTwinByIri(ws.id, input.iri);
        const name = node.classIri.replace(/^dtwin:/, "");
        if (!TWIN_MODELS.some((m) => m.name === name)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No DTDL model registered for class '${node.classIri}'`,
          });
        }
        modelNames = [name];
        forTwin = { iri: node.iri, label: node.label, classIri: node.classIri };
      }

      const PROP_SCHEMAS: Record<string, string> = {
        status: "string",
        lastTickAt: "dateTime",
        lat: "double",
        lng: "double",
        zoneType: "string",
        tempTargetMin: "double",
        tempTargetMax: "double",
        equipmentType: "string",
        dtdlId: "string",
        version: "integer",
      };
      const interfaces = modelNames.map((name) => {
        const m = TWIN_MODELS.find((x) => x.name === name)!;
        const dtmi = dtmiFor(m.name);
        const base = dtmi.slice(0, -2); // strip ";1"
        const contents: Record<string, unknown>[] = [];
        for (const p of m.properties) {
          contents.push({ "@type": "Property", name: p, schema: PROP_SCHEMAS[p] ?? "string" });
        }
        // A unit needs a QuantitativeTypes semantic co-type; without one, none.
        for (const t of m.telemetry) {
          const semanticType = DTDL_SEMANTIC_TYPES[t];
          contents.push(
            semanticType
              ? { "@type": ["Telemetry", semanticType], name: t, schema: "double", unit: DTDL_UNITS[t] }
              : { "@type": "Telemetry", name: t, schema: "double" },
          );
        }
        const usesQuantitativeTypes = m.telemetry.some((t) => DTDL_SEMANTIC_TYPES[t]);
        for (const r of m.relationships) {
          contents.push({
            "@type": "Relationship",
            "@id": `${base}:${r.name};1`,
            name: r.name,
            ...(r.targetModel ? { target: dtmiFor(r.targetModel) } : {}),
            minMultiplicity: r.minMultiplicity,
            ...(r.maxMultiplicity != null ? { maxMultiplicity: r.maxMultiplicity } : {}),
            description: r.description,
          });
        }
        for (const c of m.components) {
          contents.push({
            "@type": "Component",
            name: c.name,
            schema: dtmiFor(c.schemaModel),
            description: c.description,
          });
        }
        return {
          "@context": usesQuantitativeTypes
            ? ["dtmi:dtdl:context;3", DTDL_QUANTITATIVE_TYPES_CONTEXT]
            : "dtmi:dtdl:context;3",
          "@id": dtmi,
          "@type": "Interface",
          displayName: m.displayName,
          description: m.description,
          ...(m.extends ? { extends: dtmiFor(m.extends) } : {}),
          contents,
        };
      });

      const doc: unknown =
        interfaces.length === 1 ? interfaces[0] : interfaces;
      return {
        forTwin,
        models: interfaces.map((i) => i["@id"]),
        content: JSON.stringify(doc, null, 2),
      };
    }),

  pruneStateHistory: workspaceAdminMutation
    .input(z.object({ olderThanDays: z.number().int().min(1).default(90) }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const cutoff = new Date(Date.now() - input.olderThanDays * 86400000);

      const wsTwinNodes = await db
        .select({ id: kgNodes.id })
        .from(kgNodes)
        .where(eq(kgNodes.workspaceId, ws.id));
      const nodeIds = wsTwinNodes.map((n) => n.id);

      if (nodeIds.length === 0) {
        return { deletedCount: 0, cutoff: cutoff.toISOString() };
      }

      const [deleteResult] = await db
        .delete(twinStateLog)
        .where(
          and(
            inArray(twinStateLog.nodeId, nodeIds),
            lt(twinStateLog.recordedAt, cutoff),
          ),
        );
      const deletedCount = deleteResult.affectedRows ?? 0;

      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Pruned twin state history older than ${input.olderThanDays} days (${deletedCount} rows deleted)`,
        entityType: "twin_state_log",
        payload: {
          olderThanDays: input.olderThanDays,
          cutoff: cutoff.toISOString(),
          deletedCount,
        },
      });

      return { deletedCount, cutoff: cutoff.toISOString() };
    }),
});
