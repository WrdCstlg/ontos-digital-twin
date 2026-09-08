import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  connectors,
  graphSnapshots,
  kgEdges,
  kgNodes,
  mappings,
  ontologyModules,
  syncJobs,
} from "@db/schema";
import { createRouter, authedQuery, authedMutation, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { actorLabelFor, getDemoWorkspace, writeAudit } from "./services/audit";

/* ── CSV helpers ─────────────────────────────────────────────── */

export function parseCsv(csvText: string, maxRows = Infinity): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = csvText.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length && rows.length < maxRows; i++) {
    const cells = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => (row[h] = (cells[j] ?? "").trim()));
    rows.push(row);
  }
  return { headers, rows };
}

export type ColumnMap = {
  subject: string; // e.g. "hr:Person/{emp_id}"
  label?: string; // column used as node label
  fields?: Record<string, string>; // column -> datatype property IRI (stored in propsJson)
  links?: { column: string; predicate: string; target: string }[]; // target template with {value}
};

function renderTemplate(tpl: string, row: Record<string, string>) {
  return tpl.replace(/\{([^}]+)\}/g, (_, k) => row[k] ?? "");
}

async function nextSnapshotLabel(workspaceId: number) {
  const db = getDb();
  const [last] = await db
    .select()
    .from(graphSnapshots)
    .where(eq(graphSnapshots.workspaceId, workspaceId))
    .orderBy(desc(graphSnapshots.id))
    .limit(1);
  const n = last ? Number(String(last.label).replace(/^v/, "")) + 1 : 1;
  return `v${Number.isFinite(n) ? n : 1}`;
}

/* ── router ──────────────────────────────────────────────────── */

export const mappingRouter = createRouter({
  listConnectors: authedQuery.query(async () => {
    const ws = await getDemoWorkspace();
    const db = getDb();
    const rows = await db
      .select()
      .from(connectors)
      .where(eq(connectors.workspaceId, ws.id))
      .orderBy(asc(connectors.id));
    // strip embedded csv payloads from list responses
    return rows.map((c) => {
      const cfg = (c.configJson ?? {}) as Record<string, unknown>;
      const { csvText: _omit, ...rest } = cfg;
      return {
        ...c,
        configJson: { ...rest, hasInlineData: typeof _omit === "string" },
      };
    });
  }),

  createConnector: adminMutation
    .input(
      z.object({
        name: z.string().min(1).max(255),
        type: z.enum(["csv", "sql", "rest"]),
        config: z.record(z.string(), z.unknown()).default({}),
        status: z.enum(["connected", "draft", "error"]).default("draft"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ws = await getDemoWorkspace();
      const db = getDb();
      const [{ id }] = await db
        .insert(connectors)
        .values({
          workspaceId: ws.id,
          name: input.name,
          type: input.type,
          configJson: input.config,
          status: input.status,
        })
        .$returningId();
      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Created connector '${input.name}' (${input.type})`,
        entityType: "connector",
        entityId: id,
        payload: { name: input.name, type: input.type, status: input.status },
      });
      const [row] = await db.select().from(connectors).where(eq(connectors.id, id));
      return row;
    }),

  listMappings: authedQuery.query(async () => {
    const ws = await getDemoWorkspace();
    const db = getDb();
    const conns = await db
      .select()
      .from(connectors)
      .where(eq(connectors.workspaceId, ws.id));
    if (conns.length === 0) return [];
    const rows = await db
      .select()
      .from(mappings)
      .where(inArray(mappings.connectorId, conns.map((c) => c.id)))
      .orderBy(asc(mappings.id));
    const connById = new Map(conns.map((c) => [c.id, c]));
    const mods = await db
      .select()
      .from(ontologyModules)
      .where(eq(ontologyModules.workspaceId, ws.id));
    const modById = new Map(mods.map((m) => [m.id, m]));
    return rows.map((m) => ({
      ...m,
      connector: connById.get(m.connectorId) ?? null,
      module: modById.get(m.moduleId) ?? null,
    }));
  }),

  upsertMapping: authedMutation
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        connectorId: z.number().int().positive(),
        moduleKey: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        sourceTable: z.string().min(1).max(255),
        classIri: z.string().min(1).max(512),
        columnMap: z.object({
          subject: z.string().min(1),
          label: z.string().optional(),
          fields: z.record(z.string(), z.string()).optional(),
          links: z
            .array(
              z.object({
                column: z.string(),
                predicate: z.string(),
                target: z.string(),
              }),
            )
            .optional(),
        }),
        status: z.enum(["draft", "active", "paused"]).default("draft"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ws = await getDemoWorkspace();
      const db = getDb();
      const [mod] = await db
        .select()
        .from(ontologyModules)
        .where(
          and(
            eq(ontologyModules.workspaceId, ws.id),
            eq(ontologyModules.key, input.moduleKey),
          ),
        )
        .limit(1);
      if (!mod)
        throw new TRPCError({ code: "NOT_FOUND", message: `Module '${input.moduleKey}' not found` });
      const [conn] = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.id, input.connectorId), eq(connectors.workspaceId, ws.id)))
        .limit(1);
      if (!conn)
        throw new TRPCError({ code: "NOT_FOUND", message: `Connector ${input.connectorId} not found` });

      let id = input.id;
      if (id) {
        const [existing] = await db.select().from(mappings).where(eq(mappings.id, id)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Mapping ${id} not found` });
        await db
          .update(mappings)
          .set({
            connectorId: input.connectorId,
            moduleId: mod.id,
            name: input.name,
            sourceTable: input.sourceTable,
            classIri: input.classIri,
            columnMapJson: input.columnMap,
            status: input.status,
          })
          .where(eq(mappings.id, id));
      } else {
        const [r] = await db
          .insert(mappings)
          .values({
            connectorId: input.connectorId,
            moduleId: mod.id,
            name: input.name,
            sourceTable: input.sourceTable,
            classIri: input.classIri,
            columnMapJson: input.columnMap,
            status: input.status,
          })
          .$returningId();
        id = r.id;
      }
      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `${input.id ? "Updated" : "Created"} mapping '${input.name}' (${input.sourceTable} → ${input.classIri})`,
        entityType: "mapping",
        entityId: id,
        payload: { name: input.name, sourceTable: input.sourceTable, classIri: input.classIri, status: input.status },
      });
      const [row] = await db.select().from(mappings).where(eq(mappings.id, id!));
      return row;
    }),

  previewCsv: authedQuery
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        csvText: z.string().min(1).max(1_000_000),
        mappingId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input }) => {
      const { headers, rows } = parseCsv(input.csvText, 8);
      const db = getDb();
      let columnMap: ColumnMap | null = null;
      let classIri: string | null = null;
      if (input.mappingId) {
        const [m] = await db.select().from(mappings).where(eq(mappings.id, input.mappingId)).limit(1);
        if (!m) throw new TRPCError({ code: "NOT_FOUND", message: `Mapping ${input.mappingId} not found` });
        columnMap = (m.columnMapJson as ColumnMap) ?? null;
        classIri = m.classIri;
      }
      const instances = rows.map((row, i) => {
        const iri = columnMap ? renderTemplate(columnMap.subject, row) : `row/${i + 1}`;
        const props: Record<string, string> = {};
        if (columnMap?.fields) {
          for (const [col, propIri] of Object.entries(columnMap.fields)) {
            if (row[col] !== undefined && row[col] !== "") props[propIri] = row[col];
          }
        } else {
          for (const h of headers) if (row[h] !== "") props[h] = row[h];
        }
        const triples: string[] = [];
        triples.push(`${iri} a ${classIri ?? "csv:Row"} ;`);
        for (const [k, v] of Object.entries(props)) triples.push(`  ${k} "${v}" ;`);
        if (columnMap?.links) {
          for (const l of columnMap.links) {
            if (row[l.column])
              triples.push(`  ${l.predicate} ${renderTemplate(l.target, { value: row[l.column] })} ;`);
          }
        }
        triples.push(`  ontos:provenance "${input.filename}:row-${i + 2}" .`);
        return {
          row: i + 1,
          source: row,
          iri,
          label: columnMap?.label ? row[columnMap.label] : iri,
          classIri: classIri ?? "csv:Row",
          props,
          triples: triples.join("\n"),
        };
      });
      return { filename: input.filename, headers, sampleRows: rows, instances };
    }),

  runSync: authedMutation
    .input(z.object({ mappingId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ws = await getDemoWorkspace();
      const db = getDb();
      const [m] = await db.select().from(mappings).where(eq(mappings.id, input.mappingId)).limit(1);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: `Mapping ${input.mappingId} not found` });
      const [conn] = await db.select().from(connectors).where(eq(connectors.id, m.connectorId)).limit(1);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: `Connector ${m.connectorId} not found` });
      const cfg = (conn.configJson ?? {}) as Record<string, unknown>;
      if (conn.type !== "csv" || typeof cfg.csvText !== "string")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "runSync currently materializes CSV connectors with inline data (demo simulator)",
        });
      const columnMap = m.columnMapJson as ColumnMap | null;
      if (!columnMap?.subject)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Mapping has no column map" });

      const [{ id: jobId }] = await db
        .insert(syncJobs)
        .values({ mappingId: m.id, status: "running", startedAt: new Date() })
        .$returningId();

      try {
        const { rows } = parseCsv(cfg.csvText);
        const moduleKey = (await db.select().from(ontologyModules).where(eq(ontologyModules.id, m.moduleId)).limit(1))[0]?.key ?? "custom";
        let processed = 0;
        const iriToId = new Map<string, number>();
        const pendingEdges: { from: number; toIri: string; predicate: string }[] = [];

        for (const row of rows) {
          const iri = renderTemplate(columnMap.subject, row);
          if (!iri || iri.includes("{}")) continue;
          const props: Record<string, string> = {};
          for (const [col, propIri] of Object.entries(columnMap.fields ?? {})) {
            if (row[col]) props[propIri] = row[col];
          }
          const label = columnMap.label ? row[columnMap.label] : iri;
          await db
            .insert(kgNodes)
            .values({
              workspaceId: ws.id,
              moduleKey,
              classIri: m.classIri,
              iri,
              label: label || iri,
              propsJson: props,
              sourceMappingId: m.id,
            })
            .onDuplicateKeyUpdate({
              set: { label: label || iri, propsJson: props, sourceMappingId: m.id, updatedAt: new Date() },
            });
          const [node] = await db
            .select()
            .from(kgNodes)
            .where(and(eq(kgNodes.workspaceId, ws.id), eq(kgNodes.iri, iri)))
            .limit(1);
          if (node) {
            iriToId.set(iri, node.id);
            for (const l of columnMap.links ?? []) {
              const toIri = renderTemplate(l.target, { value: row[l.column] ?? "" });
              if (row[l.column] && toIri) pendingEdges.push({ from: node.id, toIri, predicate: l.predicate });
            }
          }
          processed++;
        }

        // resolve edge targets (must already exist in the KG)
        let edgesCreated = 0;
        for (const pe of pendingEdges) {
          let toId = iriToId.get(pe.toIri);
          if (!toId) {
            const [t] = await db
              .select()
              .from(kgNodes)
              .where(and(eq(kgNodes.workspaceId, ws.id), eq(kgNodes.iri, pe.toIri)))
              .limit(1);
            toId = t?.id;
          }
          if (!toId) continue;
          const [dup] = await db
            .select()
            .from(kgEdges)
            .where(
              and(
                eq(kgEdges.workspaceId, ws.id),
                eq(kgEdges.fromNodeId, pe.from),
                eq(kgEdges.toNodeId, toId),
                eq(kgEdges.predicateIri, pe.predicate),
              ),
            )
            .limit(1);
          if (dup) continue;
          await db.insert(kgEdges).values({
            workspaceId: ws.id,
            fromNodeId: pe.from,
            toNodeId: toId,
            predicateIri: pe.predicate,
            moduleKey,
            sourceMappingId: m.id,
          });
          edgesCreated++;
        }

        const snapLabel = await nextSnapshotLabel(ws.id);
        const nodeCount = await db.select({ n: kgNodes.id }).from(kgNodes).where(eq(kgNodes.workspaceId, ws.id));
        const edgeCount = await db.select({ n: kgEdges.id }).from(kgEdges).where(eq(kgEdges.workspaceId, ws.id));
        await db.insert(graphSnapshots).values({
          workspaceId: ws.id,
          label: snapLabel,
          statsJson: { nodes: nodeCount.length, edges: edgeCount.length, byModule: { [moduleKey]: processed } },
        });

        await db
          .update(syncJobs)
          .set({ status: "succeeded", rowsProcessed: processed, snapshotLabel: snapLabel, finishedAt: new Date() })
          .where(eq(syncJobs.id, jobId));
        await writeAudit({
          workspaceId: ws.id,
          actor: actorLabelFor(ctx.user),
          action: `Sync '${m.name}' upserted ${processed} instances, ${edgesCreated} edges (${snapLabel})`,
          entityType: "sync_job",
          entityId: jobId,
          payload: { mappingId: m.id, rowsProcessed: processed, edgesCreated, snapshot: snapLabel },
        });
        const [job] = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId));
        return { job, nodesUpserted: processed, edgesCreated, snapshot: snapLabel };
      } catch (err) {
        await db
          .update(syncJobs)
          .set({ status: "failed", finishedAt: new Date() })
          .where(eq(syncJobs.id, jobId));
        throw err;
      }
    }),

  listSyncJobs: authedQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ input }) => {
      const ws = await getDemoWorkspace();
      const db = getDb();
      const conns = await db.select().from(connectors).where(eq(connectors.workspaceId, ws.id));
      if (conns.length === 0) return [];
      const maps = await db.select().from(mappings).where(inArray(mappings.connectorId, conns.map((c) => c.id)));
      if (maps.length === 0) return [];
      const jobs = await db
        .select()
        .from(syncJobs)
        .where(inArray(syncJobs.mappingId, maps.map((m) => m.id)))
        .orderBy(desc(syncJobs.id))
        .limit(input?.limit ?? 25);
      const mapById = new Map(maps.map((m) => [m.id, m]));
      const connById = new Map(conns.map((c) => [c.id, c]));
      return jobs.map((j) => {
        const m = mapById.get(j.mappingId) ?? null;
        return { ...j, mapping: m, connector: m ? (connById.get(m.connectorId) ?? null) : null };
      });
    }),
});
