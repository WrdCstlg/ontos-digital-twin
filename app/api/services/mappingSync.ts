import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  connectors,
  graphSnapshots,
  kgEdges,
  kgNodes,
  mappings,
  ontologyClasses,
  ontologyModules,
  syncJobs,
  type Connector,
  type Job,
  type Mapping,
  type SyncJob,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { writeAudit } from "./audit";
import { semanticEngine } from "./semanticEngine";
import { buildPrefixMap, knowledgeGraphToTurtle, shaclJsonToTurtle } from "./rdfBridge";
import { explainShaclReport, type ExplainedShaclReport } from "./explainableShacl";
import { enqueueJob } from "./jobs/queue";
import { PermanentJobError, type JobHandler } from "./jobs/worker";

/**
 * CSV imports (`mapping.sync` jobs). The web app validates and enqueues; a
 * worker runs the import, so an import no longer lives and dies with the HTTP
 * request that asked for it.
 */

export const MAPPING_SYNC_KIND = "mapping.sync";

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

export function renderTemplate(tpl: string, row: Record<string, string>) {
  return tpl.replace(/\{([^}]+)\}/g, (_, k) => row[k] ?? "");
}

async function nextSnapshotLabel(workspaceId: number) {
  const [last] = await getDb()
    .select()
    .from(graphSnapshots)
    .where(eq(graphSnapshots.workspaceId, workspaceId))
    .orderBy(desc(graphSnapshots.id))
    .limit(1);
  const n = last ? Number(String(last.label).replace(/^v/, "")) + 1 : 1;
  return `v${Number.isFinite(n) ? n : 1}`;
}

/* ── validation ──────────────────────────────────────────────── */

export type RunnableMapping = { mapping: Mapping; connector: Connector; csvText: string; columnMap: ColumnMap };

export type MappingCheck =
  | { ok: true; value: RunnableMapping }
  | { ok: false; code: "NOT_FOUND" | "BAD_REQUEST"; message: string };

/** Whether a mapping can be imported now. Used before enqueueing and again by the worker. */
export async function checkRunnableMapping(workspaceId: number, mappingId: number): Promise<MappingCheck> {
  const [record] = await getDb()
    .select({ mapping: mappings, connector: connectors })
    .from(mappings)
    .innerJoin(connectors, eq(mappings.connectorId, connectors.id))
    .where(and(eq(mappings.id, mappingId), eq(connectors.workspaceId, workspaceId)))
    .limit(1);
  if (!record) return { ok: false, code: "NOT_FOUND", message: `Mapping ${mappingId} not found` };
  const cfg = (record.connector.configJson ?? {}) as Record<string, unknown>;
  if (record.connector.type !== "csv" || typeof cfg.csvText !== "string") {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "runSync currently materializes CSV connectors with inline data (demo simulator)",
    };
  }
  const columnMap = record.mapping.columnMapJson as ColumnMap | null;
  if (!columnMap?.subject) return { ok: false, code: "BAD_REQUEST", message: "Mapping has no column map" };
  return { ok: true, value: { ...record, csvText: cfg.csvText, columnMap } };
}

/* ── enqueue ─────────────────────────────────────────────────── */

export type QueuedSync = { syncJob: SyncJob; jobId: number; alreadyActive: boolean };

/**
 * Queues an import of the mapping. If one is already queued or running it is
 * returned instead: a second import of the same data behind the first would
 * only repeat it. The mapping row is locked while deciding, so two requests
 * cannot both conclude that none is active.
 */
export async function enqueueMappingSync(workspaceId: number, mappingId: number, actor: string): Promise<QueuedSync> {
  return getDb().transaction(async (tx) => {
    await tx.select({ id: mappings.id }).from(mappings).where(eq(mappings.id, mappingId)).for("update");
    const [active] = await tx
      .select()
      .from(syncJobs)
      .where(and(eq(syncJobs.mappingId, mappingId), inArray(syncJobs.status, ["queued", "running"])))
      .orderBy(desc(syncJobs.id))
      .limit(1);
    if (active?.jobId) return { syncJob: active, jobId: active.jobId, alreadyActive: true };

    const [{ id: syncJobId }] = await tx
      .insert(syncJobs)
      .values({ mappingId, status: "queued" })
      .$returningId();
    const jobId = await enqueueJob(tx, {
      workspaceId,
      kind: MAPPING_SYNC_KIND,
      payload: { syncJobId, mappingId } satisfies MappingSyncPayload,
      createdBy: actor,
    });
    await tx.update(syncJobs).set({ jobId }).where(eq(syncJobs.id, syncJobId));
    const [syncJob] = await tx.select().from(syncJobs).where(eq(syncJobs.id, syncJobId));
    return { syncJob, jobId, alreadyActive: false };
  });
}

/* ── the import ──────────────────────────────────────────────── */

export type MappingSyncPayload = { syncJobId: number; mappingId: number };

export type MappingSyncResult = {
  syncJobId: number;
  nodesUpserted: number;
  edgesCreated: number;
  snapshot: string;
  shacl: {
    conforms: boolean | null;
    violationCount: number;
    signatureSummary: ExplainedShaclReport["signatureSummary"];
  } | null;
};

function readPayload(job: Job): MappingSyncPayload {
  const p = job.payloadJson as Partial<MappingSyncPayload> | null;
  if (!p || typeof p.syncJobId !== "number" || typeof p.mappingId !== "number") {
    throw new PermanentJobError(`job ${job.id} has no syncJobId/mappingId in its payload`);
  }
  return { syncJobId: p.syncJobId, mappingId: p.mappingId };
}

function interrupted(signal: AbortSignal): never {
  throw new Error(`import interrupted: ${signal.reason instanceof Error ? signal.reason.message : "aborted"}`);
}

/**
 * Imports every CSV row of the mapping into the knowledge graph. Upserts by
 * IRI and skips existing edges, so running it again after a failed attempt
 * converges on the same graph.
 */
export async function runMappingSync(
  workspaceId: number,
  payload: MappingSyncPayload,
  actor: string,
  signal: AbortSignal,
): Promise<MappingSyncResult> {
  const db = getDb();
  const check = await checkRunnableMapping(workspaceId, payload.mappingId);
  if (!check.ok) throw new PermanentJobError(check.message);
  const { mapping: m, csvText, columnMap } = check.value;

  await db
    .update(syncJobs)
    .set({ status: "running", startedAt: sql`now()`, error: null })
    .where(eq(syncJobs.id, payload.syncJobId));

  const { rows } = parseCsv(csvText);
  const moduleKey =
    (await db.select().from(ontologyModules).where(eq(ontologyModules.id, m.moduleId)).limit(1))[0]?.key ?? "custom";

  // Pre-validate mapped data against the class's SHACL shapes, when it has any.
  const [targetClass] = await db
    .select()
    .from(ontologyClasses)
    .where(and(eq(ontologyClasses.moduleId, m.moduleId), eq(ontologyClasses.iri, m.classIri)))
    .limit(1);
  let shaclReport: ExplainedShaclReport | null = null;
  if (targetClass?.shaclJson && (await semanticEngine.ensureEngineRunning())) {
    try {
      const prefixMap = buildPrefixMap();
      const shapesTtl = shaclJsonToTurtle([targetClass], prefixMap);
      if (shapesTtl.trim()) {
        const candidateNodes: (typeof kgNodes.$inferSelect)[] = [];
        let tempId = 1;
        for (const row of rows) {
          const iri = renderTemplate(columnMap.subject, row);
          if (!iri || iri.includes("{}")) continue;
          const props: Record<string, string> = {};
          for (const [col, propIri] of Object.entries(columnMap.fields ?? {})) {
            if (row[col]) props[propIri] = row[col];
          }
          candidateNodes.push({
            id: tempId++,
            workspaceId,
            moduleKey,
            classIri: m.classIri,
            iri,
            label: columnMap.label ? row[columnMap.label] ?? iri : iri,
            propsJson: props,
            sourceMappingId: m.id,
            sourceSubmissionId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          });
        }
        const dataTtl = knowledgeGraphToTurtle(candidateNodes, [], prefixMap);
        const valRes = await semanticEngine.exclusive(async () => {
          await semanticEngine.clearStore();
          await semanticEngine.loadTurtle(dataTtl);
          return semanticEngine.validateShacl(shapesTtl);
        });
        shaclReport = explainShaclReport(valRes);
      }
    } catch (shaclErr) {
      console.warn("[mappingSync] SHACL pre-validation encountered error:", shaclErr);
    }
  }

  let processed = 0;
  const iriToId = new Map<string, number>();
  const pendingEdges: { from: number; toIri: string; predicate: string }[] = [];

  for (const row of rows) {
    if (signal.aborted) interrupted(signal);
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
        workspaceId,
        moduleKey,
        classIri: m.classIri,
        iri,
        label: label || iri,
        propsJson: props,
        sourceMappingId: m.id,
      })
      .onDuplicateKeyUpdate({
        // The import is now the last thing to have changed it.
        set: { label: label || iri, propsJson: props, sourceMappingId: m.id, sourceSubmissionId: null, updatedAt: new Date() },
      });
    const [node] = await db
      .select()
      .from(kgNodes)
      .where(and(eq(kgNodes.workspaceId, workspaceId), eq(kgNodes.iri, iri)))
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

  // Resolve edge targets, which must already exist in the graph.
  let edgesCreated = 0;
  for (const pe of pendingEdges) {
    if (signal.aborted) interrupted(signal);
    let toId = iriToId.get(pe.toIri);
    if (!toId) {
      const [t] = await db
        .select()
        .from(kgNodes)
        .where(and(eq(kgNodes.workspaceId, workspaceId), eq(kgNodes.iri, pe.toIri)))
        .limit(1);
      toId = t?.id;
    }
    if (!toId) continue;
    const [dup] = await db
      .select()
      .from(kgEdges)
      .where(
        and(
          eq(kgEdges.workspaceId, workspaceId),
          eq(kgEdges.fromNodeId, pe.from),
          eq(kgEdges.toNodeId, toId),
          eq(kgEdges.predicateIri, pe.predicate),
        ),
      )
      .limit(1);
    if (dup) continue;
    await db.insert(kgEdges).values({
      workspaceId,
      fromNodeId: pe.from,
      toNodeId: toId,
      predicateIri: pe.predicate,
      moduleKey,
      sourceMappingId: m.id,
    });
    edgesCreated++;
  }

  const snapLabel = await nextSnapshotLabel(workspaceId);
  const nodeCount = await db.select({ n: kgNodes.id }).from(kgNodes).where(eq(kgNodes.workspaceId, workspaceId));
  const edgeCount = await db.select({ n: kgEdges.id }).from(kgEdges).where(eq(kgEdges.workspaceId, workspaceId));
  await db.insert(graphSnapshots).values({
    workspaceId,
    label: snapLabel,
    statsJson: { nodes: nodeCount.length, edges: edgeCount.length, byModule: { [moduleKey]: processed } },
  });

  // The audit entry is written before the job is marked succeeded, so a failed
  // audit write fails this attempt (and it is retried) rather than leaving a
  // succeeded import with no record.
  await writeAudit({
    workspaceId,
    actor,
    action: `Sync '${m.name}' upserted ${processed} instances, ${edgesCreated} edges (${snapLabel})${
      shaclReport ? ` [SHACL ${shaclReport.conforms ? "PASSED" : `${shaclReport.violationCount} violations`}]` : ""
    }`,
    entityType: "sync_job",
    entityId: payload.syncJobId,
    payload: { mappingId: m.id, processed, edgesCreated, snapshot: snapLabel, shaclReport },
  });

  await db
    .update(syncJobs)
    .set({ status: "succeeded", rowsProcessed: processed, snapshotLabel: snapLabel, finishedAt: sql`now()`, error: null })
    .where(eq(syncJobs.id, payload.syncJobId));

  return {
    syncJobId: payload.syncJobId,
    nodesUpserted: processed,
    edgesCreated,
    snapshot: snapLabel,
    shacl: shaclReport
      ? {
          conforms: shaclReport.conforms,
          violationCount: shaclReport.violationCount,
          signatureSummary: shaclReport.signatureSummary.slice(0, 5),
        }
      : null,
  };
}

async function setSyncJob(job: Job, values: Partial<typeof syncJobs.$inferInsert>) {
  const p = job.payloadJson as Partial<MappingSyncPayload> | null;
  if (typeof p?.syncJobId !== "number") return;
  await getDb().update(syncJobs).set(values).where(eq(syncJobs.id, p.syncJobId));
}

export const mappingSyncHandler: JobHandler = {
  run: ({ job, signal }) => runMappingSync(job.workspaceId, readPayload(job), job.createdBy ?? "system", signal),
  onRetry: (job, error) => setSyncJob(job, { status: "queued", error }),
  onFailed: (job, error) => setSyncJob(job, { status: "failed", error, finishedAt: new Date() }),
  onRequeued: (job) => setSyncJob(job, { status: "queued", error: null, finishedAt: null }),
};
