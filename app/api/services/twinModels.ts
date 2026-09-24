/**
 * Shared digital-twin model metadata.
 *
 * Single source of truth for the 'twin' ontology module (prefix `dtwin`):
 * class hierarchy, DTDL v3 interface mapping, telemetry keys/units, and the
 * one-step simulation rules used by db/seed-twins.ts (history) and
 * api/twinRouter.ts (live `tick` mutation).
 */

/* ── twin state shape (stored on kg_nodes.propsJson) ─────────── */
export type TwinState = {
  status?: string;
  temperature?: number; // celsius
  humidity?: number; // percent
  utilization?: number; // percent
  etaMinutes?: number;
  batteryLevel?: number; // percent
  lat?: number;
  lng?: number;
  zoneType?: string; // receiving | storage | cold-chain | dispatch
  tempTargetMin?: number;
  tempTargetMax?: number;
  mirroredIri?: string; // dtwin:twinOf target
  lastTickAt?: string; // ISO timestamp
  [k: string]: unknown;
};

export const TWIN_MODULE_KEY = "twin";
export const TWIN_PREFIX = "dtwin";

/* ── class hierarchy ─────────────────────────────────────────── */
/** [label, parentLabel|null, definition] — module 'twin' */
export const TWIN_CLASS_DEFS: [string, string | null, string][] = [
  ["DigitalTwin", null, "A live digital twin mirroring a real-world entity of the knowledge graph. Maps to a DTDL v3 Interface instance."],
  ["AssetTwin", "DigitalTwin", "Twin of a movable asset (shipment, carrier vehicle, equipment, inventory)."],
  ["FacilityTwin", "DigitalTwin", "Twin of a fixed facility (warehouse, zone) with environmental telemetry."],
  ["WarehouseTwin", "FacilityTwin", "Twin of a log:Warehouse — aggregates zone/equipment twins and facility telemetry."],
  ["ShipmentTwin", "AssetTwin", "Twin of a log:Shipment — tracks status, position, temperature and ETA countdown."],
  ["CarrierTwin", "AssetTwin", "Twin of a log:Carrier — fleet utilization and position."],
  ["InventoryTwin", "AssetTwin", "Twin of a log:InventoryItem — stock-level telemetry."],
  ["ZoneTwin", "FacilityTwin", "Twin of a warehouse zone (receiving / storage / cold-chain / dispatch). Cold-chain zones hold a 2-6°C target band."],
  ["EquipmentTwin", "AssetTwin", "Twin of warehouse equipment (forklift, temp sensor, dock door) with battery telemetry."],
  ["TwinModel", null, "The DTDL v3 interface descriptor for a twin class — twins link to their model via dtwin:hasModel."],
  ["Telemetry", null, "A telemetry stream definition on a twin model (DTDL Telemetry)."],
  ["TwinState", null, "A point-in-time state snapshot of a twin; the live series is persisted in twin_state_log."],
  ["TwinRelationship", null, "A typed topology link between twins (DTDL Relationship): contains, locatedIn, connectedTo, monitors, twinOf."],
  ["TwinComponent", null, "A contained sub-entity of a twin (DTDL Component): zones within a warehouse twin, equipment within a zone twin."],
];

/* SHACL: required telemetry keys per twin class */
export const TWIN_SHACL: Record<string, unknown> = {
  "dtwin:WarehouseTwin": {
    shape: "dtwin:WarehouseTwinShape",
    constraints: [
      { path: "dtwin:temperature", minCount: 1, datatype: "xsd:double", severity: "Violation", message: "Warehouse twins must report temperature" },
      { path: "dtwin:humidity", minCount: 1, datatype: "xsd:double", severity: "Violation" },
      { path: "dtwin:utilization", minCount: 1, datatype: "xsd:double", severity: "Warning" },
    ],
  },
  "dtwin:ShipmentTwin": {
    shape: "dtwin:ShipmentTwinShape",
    constraints: [
      { path: "dtwin:status", minCount: 1, maxCount: 1, datatype: "xsd:string", severity: "Violation" },
      { path: "dtwin:etaMinutes", minCount: 1, datatype: "xsd:integer", severity: "Warning", message: "In-transit shipment twins must carry an ETA" },
    ],
  },
};

/* ── ontology properties ─────────────────────────────────────── */
/** [name, kind, domainLabel, rangeLabel|null, datatype|null, cardinality, definition] */
export type TwinPropDef = [string, "object" | "datatype", string | null, string | null, string | null, string | null, string];
export const TWIN_PROP_DEFS: TwinPropDef[] = [
  ["twinOf", "object", "DigitalTwin", null, null, "1..1", "The knowledge-graph entity this twin mirrors (any module — cross-module axiom)."],
  ["contains", "object", "DigitalTwin", "DigitalTwin", null, "0..*", "Containment: warehouse twin → zone twins; zone twin → equipment twins."],
  ["locatedIn", "object", "DigitalTwin", "FacilityTwin", null, "0..1", "Current hosting facility twin (shipment/inventory twin → warehouse twin)."],
  ["connectedTo", "object", "DigitalTwin", "DigitalTwin", null, "0..*", "Operational link (carrier twin ↔ shipment twins)."],
  ["monitors", "object", "EquipmentTwin", "DigitalTwin", null, "0..*", "Sensor equipment twin observes a zone or shipment twin."],
  ["hasModel", "object", "DigitalTwin", "TwinModel", null, "1..1", "The DTDL interface (TwinModel) this twin instantiates."],
  ["hasTelemetry", "datatype", "TwinModel", null, "xsd:string", "1..*", "Telemetry key exposed by the model (temperature, humidity, utilization, etaMinutes, batteryLevel…)."],
  ["status", "datatype", "DigitalTwin", null, "xsd:string", "1..1", "Lifecycle/operational status."],
  ["temperature", "datatype", "DigitalTwin", null, "xsd:double", "0..1", "Ambient or cargo temperature (°C)."],
  ["humidity", "datatype", "DigitalTwin", null, "xsd:double", "0..1", "Relative humidity (%)."],
  ["utilization", "datatype", "DigitalTwin", null, "xsd:double", "0..1", "Capacity/fleet/stock utilization (%)."],
  ["etaMinutes", "datatype", "ShipmentTwin", null, "xsd:integer", "0..1", "Estimated time to arrival (minutes)."],
  ["lat", "datatype", "DigitalTwin", null, "xsd:double", "0..1", "Latitude."],
  ["lng", "datatype", "DigitalTwin", null, "xsd:double", "0..1", "Longitude."],
  ["lastTickAt", "datatype", "DigitalTwin", null, "xsd:dateTime", "0..1", "Timestamp of the last simulation tick."],
];

/* topology predicates used by the twin subgraph */
export const TWIN_TOPOLOGY_PREDICATES = [
  "dtwin:twinOf",
  "dtwin:contains",
  "dtwin:locatedIn",
  "dtwin:connectedTo",
  "dtwin:monitors",
  "dtwin:hasModel",
] as const;

/* ── telemetry ───────────────────────────────────────────────── */
export const TELEMETRY_UNITS: Record<string, string> = {
  temperature: "celsius",
  humidity: "percent",
  utilization: "percent",
  etaMinutes: "minutes",
  batteryLevel: "percent",
  lat: "degree",
  lng: "degree",
};

/** DTDL v3 unit names (https://learn.microsoft.com/azure/digital-twins/concepts-units) */
export const DTDL_UNITS: Record<string, string> = {
  temperature: "degreeCelsius",
  humidity: "percent",
  utilization: "percent",
  etaMinutes: "minute",
  batteryLevel: "percent",
  lat: "degree",
  lng: "degree",
};

/** DTDL v3 extension that defines semantic types and their units. */
export const DTDL_QUANTITATIVE_TYPES_CONTEXT = "dtmi:dtdl:extension:quantitativeTypes;1";

/**
 * QuantitativeTypes semantic type per telemetry key. DTDL v3 allows `unit` only
 * on an element co-typed with one of these. Plain percentages (utilization,
 * batteryLevel) have no semantic type, so they are exported without a unit.
 */
export const DTDL_SEMANTIC_TYPES: Record<string, string> = {
  temperature: "Temperature",
  humidity: "RelativeHumidity",
  etaMinutes: "TimeSpan",
};

/* ── DTDL interface registry ─────────────────────────────────── */
export type TwinRelationshipDef = {
  name: string; // contains | locatedIn | connectedTo | monitors | twinOf | hasModel
  targetModel: string | null; // target twin class name (null = any)
  minMultiplicity: number;
  maxMultiplicity: number | null;
  description: string;
};
export type TwinModelDef = {
  name: string; // class label, e.g. WarehouseTwin
  domain: "core" | "log"; // dtmi domain segment
  displayName: string;
  description: string;
  extends: string | null; // parent model name
  properties: string[]; // DTDL Property names (state)
  telemetry: string[]; // DTDL Telemetry names
  relationships: TwinRelationshipDef[];
  components: { name: string; schemaModel: string; description: string }[];
};

const rel = (
  name: string,
  targetModel: string | null,
  minMultiplicity: number,
  maxMultiplicity: number | null,
  description: string,
): TwinRelationshipDef => ({ name, targetModel, minMultiplicity, maxMultiplicity, description });

export const TWIN_MODELS: TwinModelDef[] = [
  {
    name: "DigitalTwin",
    domain: "core",
    displayName: "Digital Twin",
    description: "Base interface for all Acme digital twins; mirrors a knowledge-graph entity.",
    extends: null,
    properties: ["status", "lastTickAt"],
    telemetry: [],
    relationships: [
      // DTDL v3 fixes minMultiplicity at 0; "exactly one" cannot be expressed.
      rel("twinOf", null, 0, 1, "Mirrored knowledge-graph entity."),
      rel("hasModel", "TwinModel", 0, 1, "DTDL interface this twin instantiates."),
    ],
    components: [],
  },
  {
    name: "AssetTwin",
    domain: "core",
    displayName: "Asset Twin",
    description: "Twin of a movable asset.",
    extends: "DigitalTwin",
    properties: ["lat", "lng"],
    telemetry: [],
    relationships: [],
    components: [],
  },
  {
    name: "FacilityTwin",
    domain: "core",
    displayName: "Facility Twin",
    description: "Twin of a fixed facility with environmental telemetry.",
    extends: "DigitalTwin",
    properties: ["lat", "lng"],
    telemetry: ["temperature", "humidity", "utilization"],
    relationships: [],
    components: [],
  },
  {
    name: "WarehouseTwin",
    domain: "log",
    displayName: "Warehouse Twin",
    description: "Twin of a log:Warehouse aggregating zone and equipment twins.",
    extends: "FacilityTwin",
    properties: [],
    telemetry: [],
    relationships: [
      rel("contains", "ZoneTwin", 0, null, "Zones within the warehouse."),
    ],
    // Zones are many twins, reached through `contains`. A component is one
    // embedded part, and DTDL v3 forbids ZoneTwin (which has its own
    // component) from serving as one.
    components: [
      { name: "equipment", schemaModel: "EquipmentTwin", description: "Equipment deployed across the warehouse." },
    ],
  },
  {
    name: "ZoneTwin",
    domain: "log",
    displayName: "Zone Twin",
    description: "Twin of a warehouse zone; cold-chain zones target 2-6°C.",
    extends: "FacilityTwin",
    properties: ["zoneType", "tempTargetMin", "tempTargetMax"],
    telemetry: [],
    relationships: [
      rel("contains", "EquipmentTwin", 0, null, "Equipment stationed in the zone."),
    ],
    components: [
      { name: "equipment", schemaModel: "EquipmentTwin", description: "Zone-level equipment twins." },
    ],
  },
  {
    name: "EquipmentTwin",
    domain: "log",
    displayName: "Equipment Twin",
    description: "Twin of warehouse equipment (forklift, temp sensor, dock door).",
    extends: "AssetTwin",
    properties: ["equipmentType"],
    telemetry: ["batteryLevel", "temperature"],
    relationships: [
      rel("monitors", null, 0, null, "Zone or shipment twin observed by this sensor."),
    ],
    components: [],
  },
  {
    name: "ShipmentTwin",
    domain: "log",
    displayName: "Shipment Twin",
    description: "Twin of a log:Shipment — status, position, cargo temperature and ETA countdown.",
    extends: "AssetTwin",
    properties: [],
    telemetry: ["temperature", "etaMinutes"],
    relationships: [
      rel("locatedIn", "WarehouseTwin", 0, 1, "Current/origin warehouse twin."),
      rel("connectedTo", "CarrierTwin", 0, 1, "Carrier twin hauling this shipment."),
    ],
    components: [],
  },
  {
    name: "CarrierTwin",
    domain: "log",
    displayName: "Carrier Twin",
    description: "Twin of a log:Carrier — fleet utilization and position.",
    extends: "AssetTwin",
    properties: [],
    telemetry: ["utilization"],
    relationships: [
      rel("connectedTo", "ShipmentTwin", 0, null, "Shipment twins currently hauled."),
    ],
    components: [],
  },
  {
    name: "InventoryTwin",
    domain: "log",
    displayName: "Inventory Twin",
    description: "Twin of a log:InventoryItem — stock-level telemetry.",
    extends: "AssetTwin",
    properties: [],
    telemetry: ["utilization"],
    relationships: [
      rel("locatedIn", "WarehouseTwin", 0, 1, "Warehouse twin stocking the item."),
    ],
    components: [],
  },
  {
    name: "TwinModel",
    domain: "core",
    displayName: "Twin Model",
    description: "DTDL v3 interface descriptor for a twin class.",
    extends: null,
    properties: ["dtdlId", "version"],
    telemetry: [],
    relationships: [],
    components: [],
  },
];

export const dtmiFor = (modelName: string): string => {
  const m = TWIN_MODELS.find((x) => x.name === modelName);
  if (!m) throw new Error(`Unknown twin model '${modelName}'`);
  return `dtmi:acme:${m.domain}:${m.name};1`;
};

/* ── one-step simulation (used by the tick mutation) ─────────── */
export type StateChange = { key: string; old: unknown; new: unknown };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Advance one twin's simulated state by a single tick (≈ one hour).
 * `rand` is a [0,1) PRNG — callers choose determinism. Returns the next
 * state plus the list of changed keys (old → new).
 */
export function advanceTwinState(
  classIri: string,
  state: TwinState,
  rand: () => number,
  now: Date,
): { next: TwinState; changes: StateChange[] } {
  const next: TwinState = { ...state };
  const changes: StateChange[] = [];
  const walk = (key: "temperature" | "humidity" | "utilization" | "batteryLevel", lo: number, hi: number, step: number, pullTo?: number) => {
    const cur = typeof next[key] === "number" ? (next[key] as number) : (lo + hi) / 2;
    let v = cur + (rand() - 0.5) * 2 * step;
    if (pullTo != null) v += (pullTo - cur) * 0.15; // mean reversion
    v = round1(clamp(v, lo, hi));
    if (v !== cur) {
      changes.push({ key, old: cur, new: v });
      next[key] = v;
    }
  };

  const cls = classIri.replace(/^dtwin:/, "");
  const isColdChain = next.zoneType === "cold-chain";
  switch (cls) {
    case "WarehouseTwin":
      walk("temperature", 14, 28, 0.6, 20);
      walk("humidity", 30, 70, 2.0, 48);
      walk("utilization", 5, 98, 1.5);
      break;
    case "ZoneTwin":
      if (isColdChain) {
        // drift toward the 2-6°C band (target 4°C), small excursion risk
        walk("temperature", -1, 9, 0.5, 4);
        if (rand() < 0.02) {
          const spiked = round1(clamp((next.temperature as number) + 2.5, -1, 11));
          changes.push({ key: "temperature", old: next.temperature, new: spiked });
          next.temperature = spiked;
        }
      } else {
        walk("temperature", 12, 28, 0.7, 19);
      }
      walk("humidity", 25, 75, 2.0, 45);
      walk("utilization", 5, 100, 2.0);
      break;
    case "EquipmentTwin": {
      const drain = round1(0.4 + rand() * 1.6);
      const cur = typeof next.batteryLevel === "number" ? next.batteryLevel : 100;
      let v = round1(clamp(cur - drain, 0, 100));
      if (v <= 5) v = 100; // battery swap
      if (v !== cur) {
        changes.push({ key: "batteryLevel", old: cur, new: v });
        next.batteryLevel = v;
      }
      if (next.equipmentType === "temp-sensor") walk("temperature", -2, 30, 0.4);
      break;
    }
    case "ShipmentTwin": {
      const status = (next.status as string) ?? "in_transit";
      if (status !== "delivered") {
        const cur = typeof next.etaMinutes === "number" ? next.etaMinutes : 120;
        const v = Math.max(0, Math.round(cur - 55 - rand() * 15));
        changes.push({ key: "etaMinutes", old: cur, new: v });
        next.etaMinutes = v;
        if (typeof next.lat === "number" && typeof next.lng === "number") {
          next.lat = round1(next.lat + (rand() - 0.5) * 0.4);
          next.lng = round1(next.lng + (rand() - 0.5) * 0.4);
        }
        if (v <= 0) {
          changes.push({ key: "status", old: status, new: "delivered" });
          next.status = "delivered";
        }
      }
      if (typeof next.temperature === "number") walk("temperature", 0, 12, 0.4, 5);
      break;
    }
    case "CarrierTwin":
      walk("utilization", 20, 100, 3.0);
      break;
    case "InventoryTwin":
      walk("utilization", 0, 100, 2.5);
      break;
    default:
      break;
  }
  const iso = now.toISOString();
  if (next.lastTickAt !== iso) {
    changes.push({ key: "lastTickAt", old: next.lastTickAt ?? null, new: iso });
    next.lastTickAt = iso;
  }
  return { next, changes };
}

/** Classes whose propsJson carries live simulated telemetry. */
export const SIMULATED_TWIN_CLASSES = new Set([
  "dtwin:WarehouseTwin",
  "dtwin:ZoneTwin",
  "dtwin:EquipmentTwin",
  "dtwin:ShipmentTwin",
  "dtwin:CarrierTwin",
  "dtwin:InventoryTwin",
]);

/** Numeric telemetry keys mirrored into twin_state_log. */
export const LOGGED_NUMERIC_KEYS = new Set([
  "temperature",
  "humidity",
  "utilization",
  "etaMinutes",
  "batteryLevel",
  "lat",
  "lng",
]);
