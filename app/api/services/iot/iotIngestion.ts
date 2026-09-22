import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { getDb } from "../../queries/connection";
import { kgNodes, twinStateLog } from "@db/schema";
import { getDemoWorkspace, writeAudit } from "../audit";
import { reconcileInsights } from "../../insightsRouter";
import { DTDL_UNITS, LOGGED_NUMERIC_KEYS, TWIN_MODULE_KEY, type TwinState } from "../twinModels";
import type { IngestResult, RawTelemetryPoint } from "./types";
import { env } from "../../lib/env";

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

    // Search by label pattern (e.g. "Twin — Logistics Shipment SHP-1004" containing "SHP-1004")
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

/**
 * Ingest physical telemetry points into Ontos Digital Twins.
 * Persists to kg_nodes.propsJson, appends to twin_state_log, and triggers insight reconciliation.
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

  const db = getDb();
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
  const now = new Date();
  const logRows: (typeof twinStateLog.$inferInsert)[] = [];
  const updatedTwinsMap = new Map<string, { twinIri: string; label: string; classIri: string; updatedKeys: Set<string> }>();
  const errors: string[] = [];

  for (const point of points) {
    if (!point.telemetry || typeof point.telemetry !== "object") {
      errors.push(`Invalid payload for point ${point.twinIri ?? point.deviceId ?? "unknown"}: telemetry must be an object`);
      continue;
    }

    const twin = await resolveTwinNode(ws.id, point, options?.deviceMappings);
    if (!twin) {
      errors.push(`Could not resolve device '${point.deviceId ?? point.twinIri ?? "unknown"}' to an active digital twin`);
      continue;
    }

    const recordedAt = point.timestamp
      ? new Date(typeof point.timestamp === "number" ? point.timestamp : Date.parse(point.timestamp))
      : now;
    const validRecordedAt = isNaN(recordedAt.getTime()) ? now : recordedAt;

    const currentProps = ((twin.propsJson ?? {}) as TwinState) ?? {};
    const nextProps: TwinState = { ...currentProps };
    const changedKeys: string[] = [];

    for (const [k, v] of Object.entries(point.telemetry)) {
      if (v === undefined || v === null) continue;

      if (typeof v === "number") {
        nextProps[k] = v;
        changedKeys.push(k);
        if (LOGGED_NUMERIC_KEYS.has(k)) {
          logRows.push({
            nodeId: twin.id,
            key: k,
            valueNum: v,
            valueText: null,
            unit: DTDL_UNITS[k] ?? null,
            recordedAt: validRecordedAt,
          });
        }
      } else if (typeof v === "string" || typeof v === "boolean") {
        const strVal = String(v);
        nextProps[k] = strVal;
        changedKeys.push(k);
        if (k === "status" || k === "zoneType") {
          logRows.push({
            nodeId: twin.id,
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
      nextProps.lastTickAt = validRecordedAt.toISOString();
      await db.update(kgNodes).set({ propsJson: nextProps }).where(eq(kgNodes.id, twin.id));

      const existing = updatedTwinsMap.get(twin.iri) ?? {
        twinIri: twin.iri,
        label: twin.label,
        classIri: twin.classIri,
        updatedKeys: new Set<string>(),
      };
      changedKeys.forEach((key) => existing.updatedKeys.add(key));
      updatedTwinsMap.set(twin.iri, existing);
    }
  }

  // Insert time-series log entries in batches of 500
  for (let i = 0; i < logRows.length; i += 500) {
    await db.insert(twinStateLog).values(logRows.slice(i, i + 500));
  }

  const updatedTwins = Array.from(updatedTwinsMap.values()).map((t) => ({
    twinIri: t.twinIri,
    label: t.label,
    classIri: t.classIri,
    updatedKeys: Array.from(t.updatedKeys),
  }));

  // Automatically trigger insight evaluation to detect cold-chain breaches or telemetry anomalies
  if (updatedTwins.length > 0) {
    try {
      await reconcileInsights(ws.id);
    } catch (err) {
      console.warn("[iot-ingest] Non-fatal error during insight reconciliation:", err);
    }

    // Record audit trail entry
    await writeAudit({
      workspaceId: ws.id,
      actor: options?.source ?? "iot_telemetry_broker",
      action: `Ingested IoT telemetry — ${updatedTwins.length} twins updated, ${logRows.length} metrics recorded`,
      entityType: "iot_telemetry",
      entityId: options?.source ?? "ingest",
      payload: {
        receivedCount: points.length,
        twinsUpdated: updatedTwins.length,
        stateLogRows: logRows.length,
        sample: updatedTwins.slice(0, 5),
      },
    });
  }

  return {
    success: errors.length === 0,
    receivedCount: points.length,
    updatedTwins,
    errors,
  };
}
