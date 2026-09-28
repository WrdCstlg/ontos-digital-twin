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
  type KgEdge,
  type KgNode,
  type Mapping,
  type SyncJob,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { writeAudit } from "./audit";
import { EngineRequestError, semanticEngine, type ShaclValidationResult } from "./semanticEngine";
import { buildPrefixMap, expandIri, knowledgeGraphSubjects, modulePrefixes, shaclJsonToTurtle } from "./rdfBridge";
import { workspaceDatatypeRanges } from "./datatypeRanges";
import { explainShaclReport, type ExplainedShaclReport } from "./explainableShacl";
import { enqueueJob } from "./jobs/queue";
import { PermanentJobError, type JobHandler } from "./jobs/worker";
import {
  parseSqlConfig,
  fetchRows as fetchSqlRows,
  unreadablePasswordMessage,
  type SqlConnectorConfig,
} from "./sqlConnector";
import { SecretUnreadableError } from "../lib/secretBox";


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

export type RunnableCsvMapping = { kind: "csv"; mapping: Mapping; connector: Connector; csvText: string; columnMap: ColumnMap };
export type RunnableSqlMapping = { kind: "sql"; mapping: Mapping; connector: Connector; sqlConfig: SqlConnectorConfig; columnMap: ColumnMap };
export type RunnableMapping = RunnableCsvMapping | RunnableSqlMapping;

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

  const columnMap = record.mapping.columnMapJson as ColumnMap | null;
  if (!columnMap?.subject) return { ok: false, code: "BAD_REQUEST", message: "Mapping has no column map" };

  if (record.connector.type === "csv") {
    const cfg = (record.connector.configJson ?? {}) as Record<string, unknown>;
    if (typeof cfg.csvText !== "string") {
      return { ok: false, code: "BAD_REQUEST", message: "CSV connector has no inline data — upload a file first" };
    }
    return { ok: true, value: { kind: "csv", ...record, csvText: cfg.csvText, columnMap } };
  }

  if (record.connector.type === "sql") {
    let sqlConfig: SqlConnectorConfig | null;
    try {
      sqlConfig = parseSqlConfig(record.connector.configJson, record.connector.workspaceId);
    } catch (err) {
      if (!(err instanceof SecretUnreadableError)) throw err;
      return { ok: false, code: "BAD_REQUEST", message: unreadablePasswordMessage(err) };
    }
    if (!sqlConfig) {
      return {
        ok: false,
        code: "BAD_REQUEST",
        message: "SQL connector has incomplete configuration — provide driver, host, and database",
      };
    }
    return { ok: true, value: { kind: "sql", ...record, sqlConfig, columnMap } };
  }

  return {
    ok: false,
    code: "BAD_REQUEST",
    message: `Connector type '${record.connector.type}' is not yet supported for sync`,
  };
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

/* ── the SHACL pre-check ─────────────────────────────────────── */

/** What checking an import against its class's SHACL shapes found. */
export type ImportShaclCheck =
  /** The class has no shapes, or the import holds no rows to check. */
  | { kind: "none" }
  /**
   * Checked. `report` holds the import's own results (the nodes it links to are
   * not judged); `refusal` those a mapping set to block refuses, the Violations,
   * or null when there are none.
   */
  | { kind: "checked"; report: ExplainedShaclReport; refusal: ExplainedShaclReport | null }
  /**
   * Not checked just now: the engine away, busy past the wait for it, or lost
   * to another process mid-check; a timeout. A later try may be.
   */
  | { kind: "unchecked"; reason: string }
  /** The engine answered that it cannot check this import (data it cannot parse, shapes it cannot read). */
  | { kind: "uncheckable"; reason: string };

/** How many IRIs one lookup names at most, well under MySQL's placeholder limit. */
const IRI_BATCH = 1000;

/**
 * Checks what an import will write against its class's SHACL shapes: the rows
 * as the import writes them (the last row wins for a repeated IRI), each value
 * typed as the ontology declares, and the links they make, to another row or
 * to a node already in the graph, with that node's class, so links and
 * sh:class resolve (the import drops a link to anything else, and so does the
 * check). Only the rows' own results count. `signal` is the job's: aborted,
 * it stops the check, and the waiting for the engine, at once.
 */
export async function checkImportShacl(
  workspaceId: number,
  m: Mapping,
  columnMap: ColumnMap,
  moduleKey: string,
  rows: Record<string, string>[],
  signal?: AbortSignal,
): Promise<ImportShaclCheck> {
  const db = getDb();
  const [targetClass] = await db
    .select()
    .from(ontologyClasses)
    .where(and(eq(ontologyClasses.moduleId, m.moduleId), eq(ontologyClasses.iri, m.classIri)))
    .limit(1);
  // A class its module does not define has shapes nobody can find: a mapping
  // set to block must not take that for a class without shapes.
  if (!targetClass) return { kind: "uncheckable", reason: `the mapping's class ${m.classIri} is not in its module, so its shapes cannot be found` };
  if (!targetClass.shaclJson) return { kind: "none" };
  const mods = await db.select().from(ontologyModules).where(eq(ontologyModules.workspaceId, workspaceId));
  const prefixMap = buildPrefixMap(mods);
  const shapesTtl = shaclJsonToTurtle([targetClass], prefixMap);
  if (!shapesTtl.trim()) return { kind: "none" };

  const own = new Map<string, { label: string; props: Record<string, string> }>();
  const links: { from: string; to: string; predicate: string }[] = [];
  for (const row of rows) {
    const iri = renderTemplate(columnMap.subject, row);
    if (!iri || iri.includes("{}")) continue;
    const props: Record<string, string> = {};
    for (const [col, propIri] of Object.entries(columnMap.fields ?? {})) {
      if (row[col]) props[propIri] = row[col];
    }
    own.set(iri, { label: (columnMap.label ? row[columnMap.label] : iri) || iri, props });
    for (const l of columnMap.links ?? []) {
      const to = renderTemplate(l.target, { value: row[l.column] ?? "" });
      if (row[l.column] && to) links.push({ from: iri, to, predicate: l.predicate });
    }
  }
  if (own.size === 0) return { kind: "none" };
  if (!(await semanticEngine.ensureEngineRunning())) return { kind: "unchecked", reason: "the semantic engine is not running" };

  const outside = [...new Set(links.map((l) => l.to))].filter((iri) => !own.has(iri));
  const existing: { iri: string; classIri: string; moduleKey: string; label: string }[] = [];
  for (let i = 0; i < outside.length; i += IRI_BATCH) {
    existing.push(
      ...(await db
        .select({ iri: kgNodes.iri, classIri: kgNodes.classIri, moduleKey: kgNodes.moduleKey, label: kgNodes.label })
        .from(kgNodes)
        .where(and(eq(kgNodes.workspaceId, workspaceId), inArray(kgNodes.iri, outside.slice(i, i + IRI_BATCH))))),
    );
  }

  const now = new Date();
  const idOf = new Map<string, number>();
  const node = (iri: string, classIri: string, nodeModuleKey: string, label: string, props: Record<string, string>): KgNode => {
    const id = idOf.size + 1;
    idOf.set(iri, id);
    const base = { sourceMappingId: m.id, sourceSubmissionId: null, createdAt: now, updatedAt: now, deletedAt: null };
    return { id, workspaceId, moduleKey: nodeModuleKey, classIri, iri, label, propsJson: props, ...base };
  };
  const nodes = [
    ...[...own].map(([iri, r]) => node(iri, m.classIri, moduleKey, r.label, r.props)),
    ...existing.map((t) => node(t.iri, t.classIri, t.moduleKey, t.label, {})),
  ];
  const edges: KgEdge[] = [];
  const made = new Set<string>();
  for (const l of links) {
    const from = idOf.get(l.from);
    const to = idOf.get(l.to);
    const key = `${l.from} ${l.predicate} ${l.to}`;
    if (from === undefined || to === undefined || made.has(key)) continue;
    made.add(key);
    edges.push({
      id: edges.length + 1, workspaceId, fromNodeId: from, toNodeId: to, predicateIri: l.predicate, moduleKey,
      sourceMappingId: m.id, sourceSubmissionId: null, deletedAt: null, createdAt: now,
    });
  }

  const data = knowledgeGraphSubjects(nodes, edges, prefixMap, await workspaceDatatypeRanges(workspaceId), modulePrefixes(mods));
  let raw: ShaclValidationResult;
  try {
    // A store that changed under the check (EngineInterference) makes it unchecked.
    raw = await semanticEngine.exclusive(
      () =>
        semanticEngine.checkLoaded(
          async () => (await semanticEngine.loadSubjects(prefixMap, data)).triplesLoaded,
          () => semanticEngine.validateShacl(shapesTtl),
        ),
      { signal },
    );
  } catch (err) {
    // An interrupted job stops here: it is not an import that went unchecked.
    if (signal?.aborted) interrupted(signal);
    const reason = err instanceof Error ? err.message : String(err);
    return err instanceof EngineRequestError ? { kind: "uncheckable", reason } : { kind: "unchecked", reason };
  }
  // A job stopped while its check ran lets the check finish (the engine would
  // go on with it anyway), and stops here: it does not act on the report.
  if (signal?.aborted) interrupted(signal);

  // The engine holds one graph. The lock around clear, load and validate keeps
  // out every process that takes it, but not one that does not (the app, or a
  // worker given an engine it takes for its own), and a request already sent
  // when the lock was lost cannot be called back. A report that did not look
  // at exactly the nodes of this class loaded here was taken on some other
  // graph, or on none.
  const expected = nodes.filter((n) => n.classIri === m.classIri).length;
  if (raw.focusNodes !== expected) {
    return {
      kind: "unchecked",
      reason: `the engine checked ${raw.focusNodes} node(s) of ${m.classIri} where this import loaded ${expected}, so not this import's graph (another process may have used the engine at the same time)`,
    };
  }

  const judged = new Set([...own.keys()].flatMap((iri) => [iri, expandIri(iri, prefixMap)]));
  const reportOn = (violations: ShaclValidationResult["violations"]) =>
    explainShaclReport({ ...raw, conforms: violations.length === 0, violationCount: violations.length, violations });
  const mine = raw.violations.filter((v) => judged.has(v.focusNode));
  const refused = mine.filter((v) => (v.severity ?? "Violation") === "Violation");
  return { kind: "checked", report: reportOn(mine), refusal: refused.length ? reportOn(refused) : null };
}

/**
 * A SHACL report as an audit entry keeps it: the counts and the first groups
 * of results, never every result with its justification and the engine's raw
 * answer (an import can hold tens of thousands of rows).
 */
function shaclSummary(report: ExplainedShaclReport) {
  return {
    conforms: report.conforms,
    violationCount: report.violationCount,
    focusNodes: report.focusNodes,
    groups: report.signatureSummary.slice(0, 5).map((g) => ({
      constraint: g.constraint,
      path: g.path,
      count: g.count,
      sampleFocusNodes: g.sampleFocusNodes.slice(0, 3),
      humanExplanation: g.humanExplanation,
      remediationAction: g.remediationAction,
    })),
  };
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
  const { mapping: m, columnMap } = check.value;

  await db
    .update(syncJobs)
    .set({ status: "running", startedAt: sql`now()`, error: null })
    .where(eq(syncJobs.id, payload.syncJobId));

  // Resolve rows: CSV inline data or live SQL fetch
  let rows: Record<string, string>[];
  if (check.value.kind === "csv") {
    rows = parseCsv(check.value.csvText).rows;
  } else {
    // SQL connector: fetch all rows from the source table
    const result = await fetchSqlRows(check.value.sqlConfig, m.sourceTable, 50_000, 0);
    // Coerce all values to strings (the graph stores string properties)
    rows = result.rows.map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v == null ? "" : String(v);
      }
      return out;
    });
  }

  const moduleKey =
    (await db.select().from(ontologyModules).where(eq(ontologyModules.id, m.moduleId)).limit(1))[0]?.key ?? "custom";

  const shacl = await checkImportShacl(workspaceId, m, columnMap, moduleKey, rows, signal);
  const shaclReport = shacl.kind === "checked" ? shacl.report : null;
  const shaclNotChecked = shacl.kind === "unchecked" || shacl.kind === "uncheckable" ? shacl.reason : null;
  if (shaclNotChecked) console.warn(`[mappingSync] mapping ${m.id}: SHACL not checked: ${shaclNotChecked}`);

  // A mapping set to block imports nothing its class's shapes reject with a
  // Violation (a Warning or Info is recorded, as warn records everything), and
  // nothing unchecked. A check that may pass later is retried, as many times
  // as the job has attempts (three, a few seconds apart); one the engine
  // cannot do fails for good, with its reason. Warn (the default) imports and
  // records. Each attempt decides for itself: a refusal does not undo what an
  // earlier attempt that passed the check had written before it died.
  if (m.shaclMode === "block") {
    if (shacl.kind === "uncheckable") {
      throw new PermanentJobError(`SHACL: this mapping blocks imports its class's shapes have not checked, and the semantic engine cannot check this one: ${shacl.reason}`);
    }
    if (shacl.kind === "unchecked") {
      throw new Error(`mapping '${m.name}' blocks imports its class's SHACL shapes have not checked, and they could not be checked just now: ${shacl.reason}`);
    }
    if (shacl.kind === "checked" && shacl.refusal) {
      const r = shacl.refusal;
      const worst = r.signatureSummary
        .slice(0, 3)
        .map((g) => `${g.humanExplanation} (${g.count}×, e.g. ${g.sampleFocusNodes[0] ?? "?"})`)
        .join("; ");
      await writeAudit({
        workspaceId,
        actor,
        action: `Sync '${m.name}' refused: ${r.violationCount} SHACL violation(s), and the mapping blocks imports that do not conform`,
        entityType: "sync_job",
        entityId: payload.syncJobId,
        payload: { mappingId: m.id, refused: true, shacl: shaclSummary(shacl.report) },
      });
      throw new PermanentJobError(
        `SHACL: ${r.violationCount} violation(s) in the mapped rows, and this mapping blocks imports that do not conform. ${worst}`,
      );
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
    payload: {
      mappingId: m.id,
      processed,
      edgesCreated,
      snapshot: snapLabel,
      shacl: shaclReport ? shaclSummary(shaclReport) : null,
      ...(shaclNotChecked ? { shaclNotChecked } : {}),
    },
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
