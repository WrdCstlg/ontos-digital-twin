import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { getDb } from "../../queries/connection";
import { kgNodes, twinStateLog } from "@db/schema";
import { getDemoWorkspace, writeAudit } from "../audit";
import { recordGraphChange } from "../graphChanges";
import { reconcileInsights } from "../../insightsRouter";
import { DTDL_UNITS, LOGGED_NUMERIC_KEYS, TWIN_MODULE_KEY, type TwinState } from "../twinModels";
import { withDeadlockRetry } from "../../lib/mysqlErrors";
import type { IngestResult, RawTelemetryPoint } from "./types";
import { env } from "../../lib/env";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The one workspace the HTTP webhook writes to. IOT_WEBHOOK_API_KEY is a single
 * shared secret, so the workspace it grants is fixed by the operator through
 * IOT_WORKSPACE_ID — never chosen by the caller, or one key would open every
 * tenant. Defaults to the demo workspace.
 */
export async function webhookWorkspaceId(): Promise<number> {
  const configured = Number(process.env.IOT_WORKSPACE_ID);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return (await getDemoWorkspace()).id;
}

/** A device identifier that really resolves in this workspace, for copyable examples. */
export async function sampleDeviceId(workspaceId: number): Promise<string | null> {
  const [twin] = await getDb()
    .select({ iri: kgNodes.iri })
    .from(kgNodes)
    .where(
      and(
        eq(kgNodes.workspaceId, workspaceId),
        eq(kgNodes.classIri, "dtwin:ShipmentTwin"),
        isNull(kgNodes.deletedAt),
      ),
    )
    .limit(1);
  return twin?.iri ?? null;
}

type KgNodeRow = typeof kgNodes.$inferSelect;

/**
 * Resolve an incoming device identifier or twin IRI to a specific twin in kg_nodes.
 */
export async function resolveTwinNode(
  workspaceId: number,
  point: RawTelemetryPoint,
  deviceMappings?: Record<string, string>,
): Promise<KgNodeRow | null> {
  const db = getDb();

  // 1. Check custom device mapping override if configured
  const mappedIri = point.deviceId && deviceMappings ? deviceMappings[point.deviceId] : undefined;
  const targetIri = mappedIri ?? point.twinIri;

  if (targetIri) {
    const [byIri] = await db
      .select()
      .from(kgNodes)
      .where(
        and(
          eq(kgNodes.workspaceId, workspaceId),
          eq(kgNodes.moduleKey, TWIN_MODULE_KEY),
          eq(kgNodes.iri, targetIri),
          isNull(kgNodes.deletedAt),
        ),
      )
      .limit(1);
    if (byIri) return byIri;
  }

  // 2. Resolve via deviceId heuristics
  if (point.deviceId) {
    const rawId = point.deviceId.trim();

    // Check direct iri variations: "dtwin:WarehouseTwin_1", "dtwin:Zone_WH1_Cold1", etc.
    const candidates = [
      rawId,
      `dtwin:${rawId}`,
      `dtwin:${rawId.replace(/^dtwin:/, "")}`,
    ];

    const [directNode] = await db
      .select()
      .from(kgNodes)
      .where(
        and(
          eq(kgNodes.workspaceId, workspaceId),
          eq(kgNodes.moduleKey, TWIN_MODULE_KEY),
          inArray(kgNodes.iri, candidates),
          isNull(kgNodes.deletedAt),
        ),
      )
      .limit(1);
    if (directNode) return directNode;

    // Search by label pattern (e.g. the label "Twin · SHP-001" contains "SHP-001")
    const [labelNode] = await db
      .select()
      .from(kgNodes)
      .where(
        and(
          eq(kgNodes.workspaceId, workspaceId),
          eq(kgNodes.moduleKey, TWIN_MODULE_KEY),
          like(kgNodes.label, `%${rawId}%`),
          isNull(kgNodes.deletedAt),
        ),
      )
      .limit(1);
    if (labelNode) return labelNode;

    // Search in propsJson.deviceId, propsJson.serialNumber, or propsJson.assetId
    const allTwins = await db
      .select()
      .from(kgNodes)
      .where(
        and(
          eq(kgNodes.workspaceId, workspaceId),
          eq(kgNodes.moduleKey, TWIN_MODULE_KEY),
          isNull(kgNodes.deletedAt),
        ),
      )
      .limit(500);

    for (const twin of allTwins) {
      const props = (twin.propsJson ?? {}) as Record<string, unknown>;
      if (
        props.deviceId === rawId ||
        props.serialNumber === rawId ||
        props.assetId === rawId ||
        props.mirroredIri?.toString().includes(rawId)
      ) {
        return twin;
      }
    }
  }

  return null;
}

/** A message about one point, kept with the point's place in its batch so messages come back in order. */
type PointError = { index: number; message: string };
/** A point that resolved to a twin, before anything is locked or written. */
type ResolvedPoint = { index: number; point: RawTelemetryPoint; twinId: number };

const unresolved = (point: RawTelemetryPoint) =>
  `Could not resolve device '${point.deviceId ?? point.twinIri ?? "unknown"}' to an active digital twin`;

/** Checks each point and finds its twin. Reads only: nothing is locked yet. */
async function resolvePoints(
  workspaceId: number,
  points: RawTelemetryPoint[],
  deviceMappings?: Record<string, string>,
): Promise<{ resolved: ResolvedPoint[]; errors: PointError[] }> {
  const resolved: ResolvedPoint[] = [];
  const errors: PointError[] = [];
  for (const [index, point] of points.entries()) {
    if (!point.telemetry || typeof point.telemetry !== "object") {
      errors.push({ index, message: `Invalid payload for point ${point.twinIri ?? point.deviceId ?? "unknown"}: telemetry must be an object` });
      continue;
    }
    const twin = await resolveTwinNode(workspaceId, point, deviceMappings);
    if (!twin) {
      errors.push({ index, message: unresolved(point) });
      continue;
    }
    resolved.push({ index, point, twinId: twin.id });
  }
  return { resolved, errors };
}

type Applied = {
  updatedTwins: IngestResult["updatedTwins"];
  stateLogRows: number;
  errors: PointError[];
};

/**
 * Writes resolved points into their twins, inside `tx`: live state on
 * kg_nodes.propsJson, history in twin_state_log, and the audit entry.
 *
 * The twins' rows are locked before their state is read, in id order (as an
 * action's are), and written back in the same transaction. Telemetry, the
 * simulation's tick and actions all change propsJson by reading it, merging
 * and writing it back; without the lock one would write over what another
 * had just written, and a reading would be lost.
 */
async function applyPoints(tx: Tx, workspaceId: number, points: ResolvedPoint[], opts: { receivedCount: number; source?: string }): Promise<Applied> {
  const ids = [...new Set(points.map((p) => p.twinId))].sort((a, b) => a - b);
  const rows = ids.length
    ? await tx
        .select()
        .from(kgNodes)
        .where(and(inArray(kgNodes.id, ids), eq(kgNodes.workspaceId, workspaceId), isNull(kgNodes.deletedAt)))
        .orderBy(kgNodes.id)
        .for("update")
    : [];
  // A point without a timestamp is taken as of now: now once the lock is held,
  // so it is not older than what a writer this one waited for recorded.
  const now = new Date();
  const twins = new Map(
    rows.map((row) => [row.id, { row, props: { ...((row.propsJson ?? {}) as TwinState) }, updatedKeys: new Set<string>() }]),
  );
  const logRows: (typeof twinStateLog.$inferInsert)[] = [];
  const errors: PointError[] = [];

  for (const { index, point, twinId } of points) {
    const twin = twins.get(twinId);
    // Deleted since it was resolved.
    if (!twin) {
      errors.push({ index, message: unresolved(point) });
      continue;
    }

    const recordedAt = point.timestamp
      ? new Date(typeof point.timestamp === "number" ? point.timestamp : Date.parse(point.timestamp))
      : now;
    const validRecordedAt = isNaN(recordedAt.getTime()) ? now : recordedAt;

    const currentProps = twin.props;
    const changedKeys: string[] = [];

    // A reading older than the twin's last tick still belongs in its history,
    // but must not roll live state (or lastTickAt) back.
    const lastTick = Date.parse(String(currentProps.lastTickAt ?? ""));
    const isLate = !isNaN(lastTick) && validRecordedAt.getTime() < lastTick;

    for (const [k, v] of Object.entries(point.telemetry)) {
      if (v === undefined || v === null) continue;

      if (typeof v === "number") {
        // JSON like 1e400 parses to Infinity, which no column can hold.
        if (!Number.isFinite(v)) {
          errors.push({ index, message: `Rejected non-finite value for '${k}' on ${twin.row.iri}` });
          continue;
        }
        if (!isLate) {
          currentProps[k] = v;
          changedKeys.push(k);
        }
        if (LOGGED_NUMERIC_KEYS.has(k)) {
          logRows.push({
            nodeId: twin.row.id,
            key: k,
            valueNum: v,
            valueText: null,
            unit: DTDL_UNITS[k] ?? null,
            recordedAt: validRecordedAt,
          });
        }
      } else if (typeof v === "string" || typeof v === "boolean") {
        const strVal = String(v);
        if (!isLate) {
          currentProps[k] = strVal;
          changedKeys.push(k);
        }
        if (k === "status" || k === "zoneType") {
          logRows.push({
            nodeId: twin.row.id,
            key: k,
            valueNum: null,
            valueText: strVal,
            unit: null,
            recordedAt: validRecordedAt,
          });
        }
      }
    }

    if (changedKeys.length > 0) {
      currentProps.lastTickAt = validRecordedAt.toISOString();
      changedKeys.forEach((key) => twin.updatedKeys.add(key));
    }
  }

  const changed = [...twins.values()].filter((t) => t.updatedKeys.size > 0);
  for (const t of changed) {
    await tx.update(kgNodes).set({ propsJson: t.props }).where(eq(kgNodes.id, t.row.id));
  }

  // Insert time-series log entries in batches of 500
  for (let i = 0; i < logRows.length; i += 500) {
    await tx.insert(twinStateLog).values(logRows.slice(i, i + 500));
  }

  const updatedTwins = changed.map((t) => ({
    twinIri: t.row.iri,
    label: t.row.label,
    classIri: t.row.classIri,
    updatedKeys: Array.from(t.updatedKeys),
  }));

  if (updatedTwins.length > 0) {
    // Recorded with the change, in its transaction: the two commit together or
    // not at all.
    await writeAudit(
      {
        workspaceId,
        actor: opts.source ?? "iot_telemetry_broker",
        action: `Ingested IoT telemetry — ${updatedTwins.length} twins updated, ${logRows.length} metrics recorded`,
        entityType: "iot_telemetry",
        entityId: opts.source ?? "ingest",
        payload: {
          receivedCount: opts.receivedCount,
          twinsUpdated: updatedTwins.length,
          stateLogRows: logRows.length,
          sample: updatedTwins.slice(0, 5),
        },
      },
      tx,
    );
    // The graph's change (graphChanges.ts), last: every twin whose live state changed.
    await recordGraphChange(tx, workspaceId, { nodes: changed.map((t) => t.row.id) });
  }

  return { updatedTwins, stateLogRows: logRows.length, errors };
}

/** The transactions that write telemetry: at READ COMMITTED, their locking reads take no gap locks. */
function writeTelemetry<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return withDeadlockRetry(() => getDb().transaction(work, { isolationLevel: "read committed" }));
}

/**
 * Ingest physical telemetry points into Ontos Digital Twins, from the HTTP
 * webhook and the tRPC API: one transaction, with the twins locked (applyPoints),
 * then insight reconciliation once it has committed.
 */
export async function ingestTelemetry(
  points: RawTelemetryPoint[],
  options?: {
    workspaceId?: number;
    source?: string;
    deviceMappings?: Record<string, string>;
  },
): Promise<IngestResult> {
  if (!points || points.length === 0) {
    return { success: true, receivedCount: 0, updatedTwins: [], errors: [] };
  }

  let workspaceId = options?.workspaceId;
  if (!workspaceId) {
    if (env.isProduction) {
      return {
        success: false,
        receivedCount: points.length,
        updatedTwins: [],
        errors: ["Refused: Multi-tenant telemetry ingestion requires an authorized workspaceId."],
      };
    }
    const wsDemo = await getDemoWorkspace();
    workspaceId = wsDemo.id;
  }
  const ws = { id: workspaceId };

  const { resolved, errors } = await resolvePoints(ws.id, points, options?.deviceMappings);
  const applied: Applied = resolved.length
    ? await writeTelemetry((tx) => applyPoints(tx, ws.id, resolved, { receivedCount: points.length, source: options?.source }))
    : { updatedTwins: [], stateLogRows: 0, errors: [] };

  // Automatically trigger insight evaluation to detect cold-chain breaches or telemetry anomalies
  if (applied.updatedTwins.length > 0) {
    try {
      await reconcileInsights(ws.id);
    } catch (err) {
      console.warn("[iot-ingest] Non-fatal error during insight reconciliation:", err);
    }
  }

  const allErrors = [...errors, ...applied.errors].sort((a, b) => a.index - b.index).map((e) => e.message);
  return {
    success: allErrors.length === 0,
    receivedCount: points.length,
    updatedTwins: applied.updatedTwins,
    errors: allErrors,
  };
}
