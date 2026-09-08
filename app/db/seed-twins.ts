/**
 * Ontos digital-twin seed — "Digital Twin" module (key 'twin', prefix 'dtwin').
 *
 * Idempotent: wipes ONLY twin-owned rows (twin ontology module + its classes/
 * properties/versions, kg_nodes with moduleKey='twin', their edges, twin
 * state history, twin-rule insights) then reseeds. NEVER touches other
 * modules' data or `users`. Deterministic (mulberry32, seed 20261001).
 *
 * Twins mirror the existing logistics graph (log:Warehouse / log:Shipment /
 * log:Carrier / log:InventoryItem) and add twin-only zones + equipment.
 * Live state lives on kg_nodes.propsJson; twin_state_log holds 48 hourly
 * history points per telemetry key per twin (random walks ending at the
 * seeded current state; cold-chain zones keep 2-6°C with one breach).
 */
import { and, eq, inArray, isNull, like, or } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import {
  insights,
  kgEdges,
  kgNodes,
  ontologyClasses,
  ontologyModules,
  ontologyProperties,
  ontologyVersions,
  twinStateLog,
} from "@db/schema";
import { getDemoWorkspace, writeAudit } from "../api/services/audit";
import {
  SIMULATED_TWIN_CLASSES,
  TELEMETRY_UNITS,
  TWIN_CLASS_DEFS,
  TWIN_MODELS,
  TWIN_MODULE_KEY,
  TWIN_PREFIX,
  TWIN_PROP_DEFS,
  TWIN_SHACL,
  dtmiFor,
  type TwinState,
} from "../api/services/twinModels";

/* ── deterministic RNG ───────────────────────────────────────── */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261001);
const ri = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const rf = (min: number, max: number) => rng() * (max - min) + min;
const round1 = (v: number) => Math.round(v * 10) / 10;
const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];

const HOUR = 3600 * 1000;
const NOW = Date.now();
const nowIso = () => new Date(NOW).toISOString();
const daysAgo = (n: number) => new Date(NOW - n * 24 * HOUR);

const MODULE_DOC = `# Digital Twin module (twin / dtwin)

Live digital twins mirroring the knowledge graph, aligned to **DTDL v3**
(\`dtmi:dtdl:context;3\`):

| Ontos concept | DTDL v3 concept |
| --- | --- |
| TwinModel (dtwin:TwinModel) | Interface (\`@type: Interface\`, \`@id: dtmi:acme:<domain>:<Name>;1\`) |
| State properties on propsJson (status, lat, lng, lastTickAt…) | Property contents |
| Telemetry keys (temperature, humidity, utilization, etaMinutes, batteryLevel) | Telemetry contents (schema double) |
| Topology edges (dtwin:contains / locatedIn / connectedTo / monitors / twinOf) | Relationship contents |
| Contained zones / equipment | Component contents |

## Stable twin IDs
Every twin IRI follows \`dtwin:<domain>/<stable-key>\`, e.g.
\`dtwin:log/warehouse-01\`, \`dtwin:log/warehouse-01/zone-cold-chain\`,
\`dtwin:log/shipment-shp-001\`. The mirrored business node is linked with
\`dtwin:twinOf\`; the twin's model with \`dtwin:hasModel\`.

## State & history
Current state lives on \`kg_nodes.propsJson\`; the append-only time series
lives in \`twin_state_log\`. Advance the simulation with the \`twin.tick\`
mutation; export models with \`twin.exportDtdl\`.`;

async function main() {
  const db = getDb();
  const ws = await getDemoWorkspace();
  const workspaceId = ws.id;
  console.log(`workspace: ${ws.name} (#${workspaceId})`);

  /* ── 0. wipe prior twin data (twin-owned rows only) ────────── */
  const oldTwins = await db
    .select({ id: kgNodes.id })
    .from(kgNodes)
    .where(and(eq(kgNodes.workspaceId, workspaceId), eq(kgNodes.moduleKey, TWIN_MODULE_KEY)));
  const oldTwinIds = oldTwins.map((t) => t.id);
  if (oldTwinIds.length) {
    await db.delete(twinStateLog).where(inArray(twinStateLog.nodeId, oldTwinIds));
    await db
      .delete(kgEdges)
      .where(
        and(
          eq(kgEdges.workspaceId, workspaceId),
          or(inArray(kgEdges.fromNodeId, oldTwinIds), inArray(kgEdges.toNodeId, oldTwinIds)),
        ),
      );
  }
  await db
    .delete(kgEdges)
    .where(and(eq(kgEdges.workspaceId, workspaceId), eq(kgEdges.moduleKey, TWIN_MODULE_KEY)));
  await db
    .delete(kgNodes)
    .where(and(eq(kgNodes.workspaceId, workspaceId), eq(kgNodes.moduleKey, TWIN_MODULE_KEY)));
  await db
    .delete(insights)
    .where(and(eq(insights.workspaceId, workspaceId), like(insights.ruleId, "twin-%")));
  const [oldModule] = await db
    .select()
    .from(ontologyModules)
    .where(and(eq(ontologyModules.workspaceId, workspaceId), eq(ontologyModules.key, TWIN_MODULE_KEY)))
    .limit(1);
  if (oldModule) {
    await db.delete(ontologyVersions).where(eq(ontologyVersions.moduleId, oldModule.id));
    await db.delete(ontologyProperties).where(eq(ontologyProperties.moduleId, oldModule.id));
    await db.delete(ontologyClasses).where(eq(ontologyClasses.moduleId, oldModule.id));
    await db.delete(ontologyModules).where(eq(ontologyModules.id, oldModule.id));
  }
  console.log(`wiped prior twin data (${oldTwinIds.length} twin nodes)`);

  /* ── 1. ontology module ────────────────────────────────────── */
  const [{ id: moduleId }] = await db
    .insert(ontologyModules)
    .values({
      workspaceId,
      key: TWIN_MODULE_KEY,
      name: "Digital Twin",
      prefix: TWIN_PREFIX,
      color: "#2DD4BF",
      version: "v1.0",
      status: "active",
      description:
        "Live digital twins of the knowledge graph — DTDL v3 aligned twin models, telemetry state, topology and simulation.",
      documentation: MODULE_DOC,
      createdAt: daysAgo(2),
    })
    .$returningId();

  /* classes (two passes: insert, then wire parents) */
  const classIdByIri = new Map<string, number>();
  for (const [label, _parent, def] of TWIN_CLASS_DEFS) {
    const iri = `${TWIN_PREFIX}:${label}`;
    const [{ id }] = await db
      .insert(ontologyClasses)
      .values({
        moduleId,
        iri,
        label,
        definition: def,
        isCustom: false,
        deprecated: false,
        shaclJson: TWIN_SHACL[iri] ?? null,
        createdAt: daysAgo(2),
      })
      .$returningId();
    classIdByIri.set(iri, id);
  }
  for (const [label, parent] of TWIN_CLASS_DEFS) {
    if (!parent) continue;
    await db
      .update(ontologyClasses)
      .set({ parentId: classIdByIri.get(`${TWIN_PREFIX}:${parent}`)! })
      .where(eq(ontologyClasses.id, classIdByIri.get(`${TWIN_PREFIX}:${label}`)!));
  }

  /* properties */
  for (const [name, kind, domain, range, datatype, card, def] of TWIN_PROP_DEFS) {
    await db.insert(ontologyProperties).values({
      moduleId,
      iri: `${TWIN_PREFIX}:${name}`,
      label: name,
      kind,
      domainClassId: domain ? (classIdByIri.get(`${TWIN_PREFIX}:${domain}`) ?? null) : null,
      rangeClassId:
        kind === "object" && range ? (classIdByIri.get(`${TWIN_PREFIX}:${range}`) ?? null) : null,
      rangeDatatype: kind === "datatype" ? datatype : null,
      cardinality: card,
      definition: def,
      createdAt: daysAgo(2),
    });
  }

  /* version history */
  await db.insert(ontologyVersions).values({
    moduleId,
    version: "v1.0",
    changelog:
      "Initial Digital Twin module: DTDL v3 aligned twin classes (DigitalTwin/Asset/Facility/Warehouse/Shipment/Carrier/Inventory/Zone/Equipment + TwinModel), twin topology properties, telemetry state props.",
    diffJson: {
      added: {
        classes: TWIN_CLASS_DEFS.map(([l]) => `${TWIN_PREFIX}:${l}`),
        properties: TWIN_PROP_DEFS.map(([n]) => `${TWIN_PREFIX}:${n}`),
      },
      removed: { classes: [], properties: [] },
      changed: [],
    },
    publishedAt: daysAgo(2),
  });
  console.log("twin ontology seeded");

  /* ── 2. read the existing logistics graph ──────────────────── */
  const logNodes = await db
    .select()
    .from(kgNodes)
    .where(and(eq(kgNodes.workspaceId, workspaceId), eq(kgNodes.moduleKey, "logistics"), isNull(kgNodes.deletedAt)));
  const byClass = (c: string) => logNodes.filter((n) => n.classIri === c).sort((a, b) => a.iri.localeCompare(b.iri));
  const warehouses = byClass("log:Warehouse");
  const shipments = byClass("log:Shipment");
  const carriers = byClass("log:Carrier").slice(0, 6); // ~6 carriers
  const inventory = byClass("log:InventoryItem").slice(0, 8); // ~8 items
  if (!warehouses.length || !shipments.length) {
    throw new Error("No logistics nodes found — run db/seed.ts first");
  }
  const logIdByIri = new Map(logNodes.map((n) => [n.iri, n]));
  const logEdges = await db
    .select()
    .from(kgEdges)
    .where(and(eq(kgEdges.workspaceId, workspaceId), eq(kgEdges.moduleKey, "logistics"), isNull(kgEdges.deletedAt)));
  const shippedBy = new Map<number, number>(); // shipmentId -> carrierId
  const stockedAt = new Map<number, number>(); // inventoryId -> warehouseId
  for (const e of logEdges) {
    if (e.predicateIri === "log:shippedBy") shippedBy.set(e.fromNodeId, e.toNodeId);
    if (e.predicateIri === "log:stocks") stockedAt.set(e.toNodeId, e.fromNodeId);
  }
  console.log(
    `mirroring: ${warehouses.length} warehouses, ${shipments.length} shipments, ${carriers.length} carriers, ${inventory.length} inventory items`,
  );

  /* ── 3. twin instances ─────────────────────────────────────── */
  type NodeInsert = typeof kgNodes.$inferInsert;
  type EdgePlan = { from: string; to: string; predicate: string };
  const nodeRows: NodeInsert[] = [];
  const edgePlans: EdgePlan[] = [];
  const iriByLogIri = new Map<string, string>(); // log node iri -> twin iri
  const stateByIri = new Map<string, TwinState>();

  const WH_COORDS: Record<string, [number, number]> = {
    "WH-Rotterdam": [51.95, 4.14],
    "WH-Memphis": [35.15, -90.05],
    "WH-Singapore": [1.35, 103.82],
    "WH-Leipzig": [51.34, 12.37],
    "WH-Dublin": [53.35, -6.26],
  };
  const addTwin = (
    iri: string,
    classIri: string,
    label: string,
    state: TwinState,
    mirroredIri?: string,
  ) => {
    nodeRows.push({
      workspaceId,
      moduleKey: TWIN_MODULE_KEY,
      classIri,
      iri,
      label,
      propsJson: { ...state, ...(mirroredIri ? { mirroredIri } : {}) },
      createdAt: daysAgo(2),
    });
    stateByIri.set(iri, state);
    if (mirroredIri) {
      iriByLogIri.set(mirroredIri, iri);
      edgePlans.push({ from: iri, to: mirroredIri, predicate: "dtwin:twinOf" });
    }
    edgePlans.push({ from: iri, to: `dtwin:model/${classIri.replace(/^dtwin:/, "")}`, predicate: "dtwin:hasModel" });
  };

  /* TwinModel instance nodes (one per twin class) */
  for (const m of TWIN_MODELS) {
    if (m.name === "TwinModel") continue;
    nodeRows.push({
      workspaceId,
      moduleKey: TWIN_MODULE_KEY,
      classIri: "dtwin:TwinModel",
      iri: `dtwin:model/${m.name}`,
      label: `${m.displayName} model (DTDL interface)`,
      propsJson: {
        dtdlId: dtmiFor(m.name),
        dtdlContext: "dtmi:dtdl:context;3",
        version: 1,
        telemetryKeys: m.telemetry,
      },
      createdAt: daysAgo(2),
    });
  }

  /* warehouse twins + zones + equipment */
  const ZONE_SEQUENCE = ["receiving", "storage", "dispatch", "cold-chain"] as const;
  const sensorIrisByWarehouse = new Map<string, string[]>();
  for (let w = 0; w < warehouses.length; w++) {
    const wh = warehouses[w];
    const key = `warehouse-${String(w + 1).padStart(2, "0")}`;
    const whIri = `dtwin:log/${key}`;
    const [lat, lng] = WH_COORDS[wh.label] ?? [round1(rf(25, 55)), round1(rf(-100, 100))];
    addTwin(whIri, "dtwin:WarehouseTwin", `Twin — ${wh.label}`, {
      status: "operational",
      temperature: round1(rf(17, 23)),
      humidity: round1(rf(38, 58)),
      utilization: round1(rf(45, 92)),
      lat,
      lng,
      lastTickAt: nowIso(),
    }, wh.iri);

    // 3-4 zones: always receiving/storage/dispatch; cold-chain for the first
    // three warehouses and ~40% of the rest (guarantees cold-chain coverage)
    const zoneTypes = [...ZONE_SEQUENCE.slice(0, 3)];
    if (w < 3 || rng() < 0.4) zoneTypes.push("cold-chain");
    const sensors: string[] = [];
    for (const zt of zoneTypes) {
      const cold = zt === "cold-chain";
      const zIri = `${whIri}/zone-${zt}`;
      addTwin(zIri, "dtwin:ZoneTwin", `${wh.label} — ${zt} zone`, {
        status: "operational",
        zoneType: zt,
        temperature: cold ? round1(rf(2.5, 5.5)) : round1(rf(15, 22)),
        humidity: round1(rf(30, 60)),
        utilization: round1(rf(30, 95)),
        ...(cold ? { tempTargetMin: 2, tempTargetMax: 6 } : {}),
        lastTickAt: nowIso(),
      });
      edgePlans.push({ from: whIri, to: zIri, predicate: "dtwin:contains" });

      // 2-5 equipment per warehouse overall — distribute per zone
    }
    const EQUIP_POOL: [string, string][] = [
      ["forklift", "Forklift"],
      ["forklift", "Forklift"],
      ["temp-sensor", "Temp sensor"],
      ["dock-door", "Dock door"],
      ["temp-sensor", "Temp sensor"],
    ];
    const equipCount = ri(2, 5);
    const usedZones = zoneTypes;
    const counters = new Map<string, number>();
    for (let e = 0; e < equipCount; e++) {
      const [etype, elabel] = EQUIP_POOL[e % EQUIP_POOL.length];
      const n = (counters.get(etype) ?? 0) + 1;
      counters.set(etype, n);
      const zone = usedZones[e % usedZones.length];
      const eIri = `${whIri}/equip-${etype}-${n}`;
      addTwin(eIri, "dtwin:EquipmentTwin", `${elabel} ${n} — ${wh.label}`, {
        status: "active",
        equipmentType: etype,
        batteryLevel: round1(rf(35, 100)),
        ...(etype === "temp-sensor" ? { temperature: round1(rf(3, 22)) } : {}),
        lastTickAt: nowIso(),
      });
      edgePlans.push({ from: `${whIri}/zone-${zone}`, to: eIri, predicate: "dtwin:contains" });
      if (etype === "temp-sensor") {
        sensors.push(eIri);
        edgePlans.push({ from: eIri, to: `${whIri}/zone-${zone}`, predicate: "dtwin:monitors" });
      }
    }
    sensorIrisByWarehouse.set(whIri, sensors);
  }

  /* carrier twins (before shipments: connectedTo edges resolve carrier twin IRIs) */
  for (const c of carriers) {
    const cid = c.iri.split("/").pop()!.toLowerCase();
    addTwin(`dtwin:log/carrier-${cid}`, "dtwin:CarrierTwin", `Twin — ${c.label}`, {
      status: "active",
      utilization: round1(rf(40, 95)),
      lat: round1(rf(25, 55)),
      lng: round1(rf(-100, 100)),
      lastTickAt: nowIso(),
    }, c.iri);
  }

  /* shipment twins */
  const whTwinIriByLogIri = new Map(warehouses.map((n) => [n.iri, iriByLogIri.get(n.iri)!]));
  const whTwinIriByLabel = new Map(warehouses.map((n) => [n.label, iriByLogIri.get(n.iri)!]));
  for (const s of shipments) {
    const sid = (s.propsJson as { shipmentId?: string } | null)?.shipmentId ?? s.label;
    const key = String(sid).toLowerCase();
    const props = (s.propsJson ?? {}) as { status?: string; origin?: string };
    const status = props.status ?? "in_transit";
    const delivered = status === "delivered";
    const perishable = rng() < 0.4;
    const originTwin = (props.origin && whTwinIriByLabel.get(props.origin)) ?? pick([...whTwinIriByLogIri.values()]);
    const [olat, olng] = WH_COORDS[props.origin ?? ""] ?? [round1(rf(25, 55)), round1(rf(-100, 100))];
    const sIri = `dtwin:log/shipment-${key}`;
    addTwin(sIri, "dtwin:ShipmentTwin", `Twin — ${sid}`, {
      status,
      etaMinutes: delivered ? 0 : ri(45, 3200),
      ...(perishable ? { temperature: round1(rf(2, 8)) } : {}),
      lat: round1(olat + rf(-2, 2)),
      lng: round1(olng + rf(-2, 2)),
      lastTickAt: nowIso(),
    }, s.iri);
    edgePlans.push({ from: sIri, to: originTwin, predicate: "dtwin:locatedIn" });
    const carrierLogId = shippedBy.get(s.id);
    if (carrierLogId != null) {
      const carrierNode = logNodes.find((n) => n.id === carrierLogId);
      const carrierTwin = carrierNode ? iriByLogIri.get(carrierNode.iri) : undefined;
      if (carrierTwin) edgePlans.push({ from: carrierTwin, to: sIri, predicate: "dtwin:connectedTo" });
    }
    if (perishable) {
      const sensors = sensorIrisByWarehouse.get(originTwin) ?? [];
      if (sensors.length) edgePlans.push({ from: pick(sensors), to: sIri, predicate: "dtwin:monitors" });
    }
  }

  /* inventory twins */
  for (const it of inventory) {
    const sku = it.iri.split("/").pop()!.toLowerCase();
    const iIri = `dtwin:log/${sku}`;
    addTwin(iIri, "dtwin:InventoryTwin", `Twin — ${it.label}`, {
      status: "in-stock",
      utilization: round1(rf(5, 100)),
      lastTickAt: nowIso(),
    }, it.iri);
    const stockWhId = stockedAt.get(it.id);
    const stockWh = stockWhId != null ? logNodes.find((n) => n.id === stockWhId) : undefined;
    const stockTwin = stockWh ? whTwinIriByLogIri.get(stockWh.iri) : undefined;
    if (stockTwin) edgePlans.push({ from: iIri, to: stockTwin, predicate: "dtwin:locatedIn" });
  }

  console.log(`planned ${nodeRows.length} twin nodes, ${edgePlans.length} edges`);

  /* materialize nodes */
  const CHUNK = 150;
  for (let i = 0; i < nodeRows.length; i += CHUNK) {
    await db.insert(kgNodes).values(nodeRows.slice(i, i + CHUNK));
  }
  const twinRows = await db
    .select({ id: kgNodes.id, iri: kgNodes.iri, classIri: kgNodes.classIri })
    .from(kgNodes)
    .where(and(eq(kgNodes.workspaceId, workspaceId), eq(kgNodes.moduleKey, TWIN_MODULE_KEY)));
  const twinIdByIri = new Map(twinRows.map((r) => [r.iri, r.id]));

  /* materialize edges */
  const edgeRows: (typeof kgEdges.$inferInsert)[] = [];
  let skipped = 0;
  for (const e of edgePlans) {
    const fromId = twinIdByIri.get(e.from) ?? logIdByIri.get(e.from)?.id;
    const toId = twinIdByIri.get(e.to) ?? logIdByIri.get(e.to)?.id;
    if (!fromId || !toId) {
      skipped++;
      continue;
    }
    edgeRows.push({
      workspaceId,
      fromNodeId: fromId,
      toNodeId: toId,
      predicateIri: e.predicate,
      moduleKey: TWIN_MODULE_KEY,
      createdAt: daysAgo(2),
    });
  }
  for (let i = 0; i < edgeRows.length; i += CHUNK) {
    await db.insert(kgEdges).values(edgeRows.slice(i, i + CHUNK));
  }
  if (skipped) console.warn("skipped edges with missing endpoints:", skipped);
  console.log(`inserted ${edgeRows.length} twin edges`);

  /* ── 4. state history: 48 hourly points per telemetry key ──── */
  const HISTORY_POINTS = 48;
  const LOG_KEYS: Record<string, string[]> = {
    "dtwin:WarehouseTwin": ["temperature", "humidity", "utilization"],
    "dtwin:ZoneTwin": ["temperature", "humidity", "utilization"],
    "dtwin:EquipmentTwin": ["batteryLevel", "temperature"],
    "dtwin:ShipmentTwin": ["etaMinutes", "temperature"],
    "dtwin:CarrierTwin": ["utilization"],
    "dtwin:InventoryTwin": ["utilization"],
  };
  const STEP: Record<string, number> = {
    temperature: 0.5,
    humidity: 1.6,
    utilization: 1.8,
    batteryLevel: 0.8,
    etaMinutes: 12,
  };
  const logRows: (typeof twinStateLog.$inferInsert)[] = [];
  const twinsToLog = twinRows.filter((r) => SIMULATED_TWIN_CLASSES.has(r.classIri));
  for (const t of twinsToLog) {
    const state = stateByIri.get(t.iri)!;
    const coldChain = state.zoneType === "cold-chain";
    // one historical cold-chain breach excursion per cold-chain zone
    const breachHour = coldChain ? ri(14, 30) : -1;
    for (const key of LOG_KEYS[t.classIri] ?? []) {
      let cur = state[key];
      if (typeof cur !== "number") continue;
      const series: number[] = new Array(HISTORY_POINTS);
      series[HISTORY_POINTS - 1] = cur;
      for (let h = HISTORY_POINTS - 2; h >= 0; h--) {
        const step = STEP[key] ?? 1;
        let prev = series[h + 1] - (rng() - 0.5) * 2 * step;
        if (key === "etaMinutes") prev = series[h + 1] + 55 + rf(-8, 20); // countdown runs backwards
        if (key === "temperature" && coldChain) prev = 4 + (rng() - 0.5) * 1.6; // walk around 4°C
        if (key === "batteryLevel") prev = series[h + 1] + rf(0.2, 1.4); // drains forward
        series[h] = key === "etaMinutes" ? Math.max(0, Math.round(prev)) : round1(prev);
      }
      if (coldChain && key === "temperature") {
        // breach: excursion up to ~8.5°C then recovery within the band
        series[breachHour] = round1(rf(7.2, 8.6));
        series[breachHour + 1] = round1(rf(6.2, 7.4));
        series[breachHour + 2] = round1(rf(4.5, 5.8));
      }
      if (coldChain && key === "temperature") {
        // clamp non-breach hours into the 2-6°C band
        for (let h = 0; h < HISTORY_POINTS; h++) {
          if (h < breachHour || h > breachHour + 2) series[h] = round1(Math.min(6, Math.max(2, series[h])));
        }
      }
      const base = NOW - (HISTORY_POINTS - 1) * HOUR;
      for (let h = 0; h < HISTORY_POINTS; h++) {
        logRows.push({
          nodeId: t.id,
          key,
          valueNum: series[h],
          valueText: null,
          unit: TELEMETRY_UNITS[key] ?? null,
          recordedAt: new Date(base + h * HOUR),
        });
      }
    }
  }
  for (let i = 0; i < logRows.length; i += 500) {
    await db.insert(twinStateLog).values(logRows.slice(i, i + 500));
  }
  console.log(`inserted ${logRows.length} twin_state_log rows (${twinsToLog.length} twins × ${HISTORY_POINTS}h)`);

  /* ── 5. hash-chained audit narrative ───────────────────────── */
  const twinCount = twinRows.filter((r) => r.classIri !== "dtwin:TwinModel").length;
  await writeAudit({
    workspaceId,
    actor: "D. Chen",
    action: "Activated module Digital Twin v1.0",
    entityType: "ontology_module",
    entityId: "twin",
    payload: { version: "v1.0", prefix: "dtwin", dtdlContext: "dtmi:dtdl:context;3" },
  });
  await writeAudit({
    workspaceId,
    actor: "system",
    action: `Materialized ${twinCount} digital twins from the logistics graph`,
    entityType: "twin_batch",
    entityId: "twin",
    payload: {
      warehouses: warehouses.length,
      shipments: shipments.length,
      carriers: carriers.length,
      inventoryItems: inventory.length,
      totalTwinNodes: twinRows.length,
      edges: edgeRows.length,
      stateLogRows: logRows.length,
    },
  });
  await writeAudit({
    workspaceId,
    actor: "S. Park",
    action: "Published DTDL v3 export for twin models",
    entityType: "ontology_module",
    entityId: "twin",
    payload: {
      format: "dtdl",
      context: "dtmi:dtdl:context;3",
      models: TWIN_MODELS.filter((m) => m.name !== "TwinModel").map((m) => dtmiFor(m.name)),
    },
  });
  console.log("audit entries chained");

  console.log("TWIN SEED COMPLETE", {
    twinNodes: twinRows.length,
    twins: twinCount,
    edges: edgeRows.length,
    stateLogRows: logRows.length,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
