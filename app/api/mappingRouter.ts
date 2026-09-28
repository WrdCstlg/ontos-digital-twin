import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { connectors, jobs, mappings, ontologyModules, syncJobs, type Connector } from "@db/schema";
import {
  createRouter,
  ONTOLOGIST_ROLES,
  workspaceQuery,
  workspaceAdminMutation,
  workspaceOntologistMutation,
  workspaceOntologistQuery,
} from "./middleware";
import { hasWorkspaceRole } from "./services/workspaceGuard";
import { getDb } from "./queries/connection";
import {
  connectorEndpoint,
  credentialInputProblem,
  sealCredentials,
  sealSecret,
  secretContext,
  SecretUnreadableError,
} from "./lib/secretBox";
import { actorLabelFor, writeAudit } from "./services/audit";
import { publicConnector } from "./services/connectorView";
import { jobAudience, jobErrorFor } from "./services/jobs/jobView";
import {
  checkRunnableMapping,
  enqueueMappingSync,
  parseCsv,
  renderTemplate,
  type ColumnMap,
  type MappingSyncResult,
} from "./services/mappingSync";
import {
  parseSqlConfig,
  testConnection as testSqlConn,
  listTables as listSqlTablesFromDb,
  listColumns as listSqlColumnsFromDb,
  fetchRows as fetchSqlRowsFromDb,
  unreadablePasswordMessage,
  type SqlConnectorConfig,
} from "./services/sqlConnector";

// The CSV helpers live with the import in services/mappingSync.ts.
export { parseCsv, type ColumnMap };

/**
 * A stored SQL connector's settings, its password opened for use. A password
 * this server cannot open is a precondition to put right, not a server fault.
 */
function storedSqlConfig(conn: Connector): SqlConnectorConfig | null {
  try {
    return parseSqlConfig(conn.configJson, conn.workspaceId);
  } catch (err) {
    if (err instanceof SecretUnreadableError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: unreadablePasswordMessage(err) });
    }
    throw err;
  }
}

/* ── router ──────────────────────────────────────────────────── */

export const mappingRouter = createRouter({
  /** What the caller may do with mappings: the client is not told its workspace role. */
  capabilities: workspaceQuery.query(({ ctx }) => ({
    canRelaxShaclCheck: hasWorkspaceRole(ctx.membership, ctx.user, ONTOLOGIST_ROLES),
  })),

  listConnectors: workspaceQuery.query(async ({ ctx }) => {
    const ws = ctx.workspace;
    const db = getDb();
    const rows = await db
      .select()
      .from(connectors)
      .where(eq(connectors.workspaceId, ws.id))
      .orderBy(asc(connectors.id));
    return rows.map(publicConnector);
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
      const problem = credentialInputProblem(input.config);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const endpoint = connectorEndpoint(input.config);
      const [{ id }] = await db
        .insert(connectors)
        .values({
          workspaceId: ws.id,
          name: input.name,
          type: input.type,
          // Credentials are sealed, for this workspace and endpoint, before they are stored (lib/secretBox.ts).
          configJson: sealCredentials(input.config, (field) => secretContext.connector(ws.id, field, endpoint)),
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
      return publicConnector(row);
    }),

  /**
   * Enters a SQL connector's password again: the way back when a stored
   * password cannot be opened (the key changed), or when it changed at the
   * source. The connector, its mappings and their history stay as they are.
   */
  setConnectorPassword: workspaceAdminMutation
    .input(z.object({ connectorId: z.number().int().positive(), password: z.string().min(1).max(1024) }))
    .mutation(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [conn] = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.id, input.connectorId), eq(connectors.workspaceId, ws.id)))
        .limit(1);
      // The query is scoped; the row is checked too, so a change to the query cannot hand over another workspace's connector.
      if (!conn || conn.workspaceId !== ws.id) throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      if (conn.type !== "sql") throw new TRPCError({ code: "BAD_REQUEST", message: "Only a SQL connector holds a password" });
      const problem = credentialInputProblem({ password: input.password });
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const cfg = (conn.configJson ?? {}) as Record<string, unknown>;
      const configJson = {
        ...cfg,
        password: sealSecret(input.password, secretContext.connector(ws.id, "password", connectorEndpoint(cfg))),
      };
      await db
        .update(connectors)
        .set({ configJson })
        .where(and(eq(connectors.id, conn.id), eq(connectors.workspaceId, ws.id)));
      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `Updated the password of connector '${conn.name}'`,
        entityType: "connector",
        entityId: conn.id,
        payload: { name: conn.name },
      });
      return publicConnector({ ...conn, configJson });
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
    const connById = new Map(conns.map((c) => [c.id, publicConnector(c)]));
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
        /** Whether imports that fail the class's SHACL shapes are refused; left as it is when absent. */
        shaclMode: z.enum(["warn", "block"]).optional(),
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
      // The SHACL mode before this save, so the audit shows a check switched on or off.
      let modeWas: string | null = null;
      if (id) {
        // Only this workspace's mapping may be changed: a mapping is a
        // workspace's through its connector.
        const [existing] = await db
          .select({ id: mappings.id, shaclMode: mappings.shaclMode })
          .from(mappings)
          .innerJoin(connectors, eq(mappings.connectorId, connectors.id))
          .where(and(eq(mappings.id, id), eq(connectors.workspaceId, ws.id)))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Mapping ${id} not found` });
        modeWas = existing.shaclMode;
        // Switching a blocking check off lets imports that break the class's
        // shapes in: that is for those who define the shapes. Anyone who may
        // edit the mapping may switch it on.
        if (modeWas === "block" && input.shaclMode === "warn" && !hasWorkspaceRole(ctx.membership, ctx.user, ONTOLOGIST_ROLES)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only ontologists and admins can switch a mapping's SHACL check from block to warn",
          });
        }
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
            ...(input.shaclMode ? { shaclMode: input.shaclMode } : {}),
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
            shaclMode: input.shaclMode ?? "warn",
          })
          .$returningId();
        id = newId;
      }
      const [row] = await db.select().from(mappings).where(eq(mappings.id, id!));
      const modeChanged = modeWas !== null && modeWas !== row.shaclMode;
      await writeAudit({
        workspaceId: ws.id,
        actor: actorLabelFor(ctx.user),
        action: `${input.id ? "Updated" : "Created"} mapping '${input.name}'${
          modeChanged ? `: its SHACL check now ${row.shaclMode === "block" ? "blocks imports that do not conform" : "only warns"}` : ""
        }`,
        entityType: "mapping",
        entityId: id,
        payload: {
          name: input.name, sourceTable: input.sourceTable, classIri: input.classIri, status: input.status,
          shaclMode: row.shaclMode, ...(modeChanged ? { shaclModeWas: modeWas } : {}),
        },
      });
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
    .query(async ({ ctx, input }) => {
      const { headers, rows } = parseCsv(input.csvText, 8);
      const db = getDb();
      let columnMap: ColumnMap | null = null;
      let classIri: string | null = null;
      if (input.mappingId) {
        // Only this workspace's mapping, through its connector.
        const [found] = await db
          .select({ mapping: mappings })
          .from(mappings)
          .innerJoin(connectors, eq(mappings.connectorId, connectors.id))
          .where(and(eq(mappings.id, input.mappingId), eq(connectors.workspaceId, ctx.workspace.id)))
          .limit(1);
        const m = found?.mapping;
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
      .where(and(eq(connectors.workspaceId, ws.id), inArray(connectors.type, ["csv", "sql"])))
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
      const connById = new Map(conns.map((c) => [c.id, publicConnector(c)]));
      // A sync job's error is its queue job's, copied: worker identities only to admins (jobView.ts).
      const audience = jobAudience(ctx.membership, ctx.user);
      return rows.map((j) => {
        const m = mapById.get(j.mappingId) ?? null;
        const q = j.jobId != null ? queueById.get(j.jobId) : undefined;
        return {
          ...j,
          error: jobErrorFor(j.error, audience),
          attempts: q?.attempts ?? null,
          maxAttempts: q?.maxAttempts ?? null,
          lastError: jobErrorFor(q?.lastError, audience),
          result: (q?.resultJson as MappingSyncResult | null | undefined) ?? null,
          mapping: m,
          connector: m ? (connById.get(m.connectorId) ?? null) : null,
        };
      });
    }),

  /* ── SQL connector endpoints ────────────────────────────────── */

  /**
   * Tests connectivity to an external SQL database.
   * Accepts raw connection params (no connector ID required — useful during
   * the "new connector" wizard before anything is persisted).
   */
  testSqlConnection: workspaceAdminMutation
    .input(
      z.object({
        driver: z.enum(["postgresql", "mysql", "sqlserver"]),
        host: z.string().min(1),
        port: z.number().int().positive().optional(),
        database: z.string().min(1),
        user: z.string().optional(),
        password: z.string().optional(),
        ssl: z.boolean().optional(),
        schema: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return testSqlConn(input);
    }),

  /**
   * Lists tables in an external SQL database identified by connector ID.
   * The connector's configJson must have driver/host/database.
   */
  listSqlTables: workspaceOntologistQuery
    .input(z.object({ connectorId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [conn] = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.id, input.connectorId), eq(connectors.workspaceId, ws.id)))
        .limit(1);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      if (conn.type !== "sql")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Connector is not a SQL type" });
      const cfg = storedSqlConfig(conn);
      if (!cfg)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Connector has incomplete SQL configuration — edit it and provide host, database, and driver",
        });
      try {
        return await listSqlTablesFromDb(cfg);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list tables: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /**
   * Lists columns of a specific table in an external SQL database.
   */
  listSqlColumns: workspaceOntologistQuery
    .input(
      z.object({
        connectorId: z.number().int().positive(),
        table: z.string().min(1).max(255),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [conn] = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.id, input.connectorId), eq(connectors.workspaceId, ws.id)))
        .limit(1);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      const cfg = storedSqlConfig(conn);
      if (!cfg)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Connector has incomplete SQL configuration" });
      try {
        return await listSqlColumnsFromDb(cfg, input.table);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list columns: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /**
   * Fetches sample rows from a table in an external SQL database.
   * Used for preview before mapping.
   */
  previewSqlRows: workspaceOntologistQuery
    .input(
      z.object({
        connectorId: z.number().int().positive(),
        table: z.string().min(1).max(255),
        limit: z.number().int().min(1).max(200).default(10),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const ws = ctx.workspace;
      const db = getDb();
      const [conn] = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.id, input.connectorId), eq(connectors.workspaceId, ws.id)))
        .limit(1);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      const cfg = storedSqlConfig(conn);
      if (!cfg)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Connector has incomplete SQL configuration" });
      try {
        return await fetchSqlRowsFromDb(cfg, input.table, input.limit, input.offset);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch rows: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
});
