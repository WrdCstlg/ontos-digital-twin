import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { connectors, jobs, mappings, ontologyModules, syncJobs } from "@db/schema";
import {
  createRouter,
  workspaceQuery,
  workspaceAdminMutation,
  workspaceOntologistMutation,
} from "./middleware";
import { getDb } from "./queries/connection";
import { actorLabelFor, writeAudit } from "./services/audit";
import {
  checkRunnableMapping,
  enqueueMappingSync,
  parseCsv,
  renderTemplate,
  type ColumnMap,
  type MappingSyncResult,
} from "./services/mappingSync";

// The CSV helpers live with the import in services/mappingSync.ts.
export { parseCsv, type ColumnMap };

/* ── router ──────────────────────────────────────────────────── */

export const mappingRouter = createRouter({
  listConnectors: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
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

  createConnector: workspaceAdminMutation
    .input(
      z.object({
        name: z.string().min(1).max(255),
        type: z.enum(["csv", "sql", "rest"]),
        config: z.record(z.string(), z.unknown()).default({}),
        status: z.enum(["connected", "draft", "error"]).default("draft"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
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

  listMappings: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
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

  upsertMapping: workspaceOntologistMutation
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        name: z.string().min(1).max(255),
        connectorId: z.number().int().positive(),
        moduleKey: z.string().min(1).max(64),
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
      const ws = ctx.workspace;
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
        await db
          .update(mappings)
          .set({
            name: input.name,
            connectorId: input.connectorId,
            moduleId: mod.id,
            sourceTable: input.sourceTable,
            classIri: input.classIri,
            columnMapJson: input.columnMap,
            status: input.status,
          })
          .where(eq(mappings.id, id));
      } else {
        const [{ id: newId }] = await db
          .insert(mappings)
          .values({
            name: input.name,
            connectorId: input.connectorId,
            moduleId: mod.id,
            sourceTable: input.sourceTable,
            classIri: input.classIri,
            columnMapJson: input.columnMap,
            status: input.status,
          })
          .$returningId();
        id = newId;
      }
      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `${input.id ? "Updated" : "Created"} mapping '${input.name}'`,
        entityType: "mapping",
        entityId: id,
        payload: { name: input.name, sourceTable: input.sourceTable, classIri: input.classIri, status: input.status },
      });
      const [row] = await db.select().from(mappings).where(eq(mappings.id, id!));
      return row;
    }),

  previewCsv: workspaceQuery
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

  /**
   * Queues an import of the mapping and returns at once; a worker runs it.
   * Follow it with listSyncJobs or operations.getJob.
   */
  runSync: workspaceOntologistMutation
    .input(z.object({ mappingId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const check = await checkRunnableMapping(ws.id, input.mappingId);
      if (!check.ok) throw new TRPCError({ code: check.code, message: check.message });
      return enqueueMappingSync(ws.id, input.mappingId, actorLabelFor(ctx.user));
    }),

  /** Queues an import of every runnable CSV mapping that is not paused. */
  runAllSyncs: workspaceOntologistMutation.mutation(async ({ ctx }) => {
    const ws = ctx.workspace;
    const actor = actorLabelFor(ctx.user);
    const rows = await getDb()
      .select({ mapping: mappings })
      .from(mappings)
      .innerJoin(connectors, eq(mappings.connectorId, connectors.id))
      .where(and(eq(connectors.workspaceId, ws.id), eq(connectors.type, "csv")))
      .orderBy(asc(mappings.id));
    let queued = 0;
    let alreadyActive = 0;
    let skipped = 0;
    for (const { mapping } of rows) {
      const check = await checkRunnableMapping(ws.id, mapping.id);
      if (!check.ok || mapping.status === "paused") {
        skipped++;
        continue;
      }
      const res = await enqueueMappingSync(ws.id, mapping.id, actor);
      if (res.alreadyActive) alreadyActive++;
      else queued++;
    }
    return { queued, alreadyActive, skipped };
  }),

  listSyncJobs: workspaceQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const conns = await db.select().from(connectors).where(eq(connectors.workspaceId, ws.id));
      if (conns.length === 0) return [];
      const maps = await db.select().from(mappings).where(inArray(mappings.connectorId, conns.map((c) => c.id)));
      if (maps.length === 0) return [];
      const rows = await db
        .select()
        .from(syncJobs)
        .where(inArray(syncJobs.mappingId, maps.map((m) => m.id)))
        .orderBy(desc(syncJobs.id))
        .limit(input?.limit ?? 25);
      // The queue's view of each import: attempts, the last error, the result.
      const jobIds = rows.map((r) => r.jobId).filter((id): id is number => id != null);
      const queueRows = jobIds.length
        ? await db
            .select({
              id: jobs.id,
              attempts: jobs.attempts,
              maxAttempts: jobs.maxAttempts,
              lastError: jobs.lastError,
              resultJson: jobs.resultJson,
            })
            .from(jobs)
            .where(and(eq(jobs.workspaceId, ws.id), inArray(jobs.id, jobIds)))
        : [];
      const queueById = new Map(queueRows.map((q) => [q.id, q]));
      const mapById = new Map(maps.map((m) => [m.id, m]));
      const connById = new Map(conns.map((c) => [c.id, c]));
      return rows.map((j) => {
        const m = mapById.get(j.mappingId) ?? null;
        const q = j.jobId != null ? queueById.get(j.jobId) : undefined;
        return {
          ...j,
          attempts: q?.attempts ?? null,
          maxAttempts: q?.maxAttempts ?? null,
          lastError: q?.lastError ?? null,
          result: (q?.resultJson as MappingSyncResult | null | undefined) ?? null,
          mapping: m,
          connector: m ? (connById.get(m.connectorId) ?? null) : null,
        };
      });
    }),
});
