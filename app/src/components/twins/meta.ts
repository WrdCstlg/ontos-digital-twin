/**
 * Twin Explorer — shared types + per-model metadata.
 *
 * Mirrors the shapes returned by api/twinRouter.ts (frontend never imports
 * from api/ — these interfaces are kept in sync by hand).
 */
import {
  Boxes,
  Forklift,
  LayoutGrid,
  Package,
  Truck,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { StatusKind } from '@/components/ui/status-dot';

export const TWIN_COLOR = '#2DD4BF'; // teal-400 — Digital Twin module hue
export const SKY_COLOR = '#38BDF8'; // sky-400 — Logistics (physical mirror) hue

/* ── API shapes ──────────────────────────────────────────────── */

export interface TwinStateShape {
  status?: string;
  temperature?: number;
  humidity?: number;
  utilization?: number;
  etaMinutes?: number;
  batteryLevel?: number;
  lat?: number;
  lng?: number;
  zoneType?: string;
  tempTargetMin?: number;
  tempTargetMax?: number;
  equipmentType?: string;
  mirroredIri?: string;
  lastTickAt?: string;
  [k: string]: unknown;
}

export interface TwinSummary {
  iri: string;
  label: string;
  classIri: string;
  state: TwinStateShape;
  contains?: { zones: number; equipment: number };
  updatedAt: string | Date;
}

export interface TwinGroup {
  classIri: string;
  count: number;
  twins: TwinSummary[];
}

export interface TopologyNode {
  id: number;
  iri: string;
  label: string;
  classIri: string;
  moduleKey: string;
}

export interface TopologyEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  predicateIri: string;
}

export interface TwinOfTarget {
  iri: string;
  label: string;
  classIri: string;
  moduleKey: string;
  props: unknown;
}

export interface StateChange {
  key: string;
  old: unknown;
  new: unknown;
}

export interface TickResult {
  tickedAt: string;
  count: number;
  twins: { iri: string; label: string; classIri: string; changes: StateChange[] }[];
}

/** One row in the live simulator event log. */
export interface LogEntry {
  id: string;
  at: string;
  tickNo: number;
  iri: string;
  label: string;
  key: string;
  oldV: unknown;
  newV: unknown;
  kind: 'value' | 'status';
}

/* ── per-model metadata ──────────────────────────────────────── */

export interface TwinClassMeta {
  /** lucide glyph for cards + hero */
  icon: LucideIcon;
  /** 2-letter canvas glyph */
  glyph: string;
  /** primary telemetry key (sparkline / hero chart) */
  primaryKey?: string;
  /** telemetry keys summarized on cards, in priority order */
  cardKeys: string[];
}

const META: Record<string, TwinClassMeta> = {
  'dtwin:WarehouseTwin': {
    icon: Warehouse,
    glyph: 'WH',
    primaryKey: 'utilization',
    cardKeys: ['utilization', 'temperature', 'humidity'],
  },
  'dtwin:ZoneTwin': {
    icon: LayoutGrid,
    glyph: 'ZN',
    primaryKey: 'temperature',
    cardKeys: ['temperature', 'humidity', 'utilization'],
  },
  'dtwin:EquipmentTwin': {
    icon: Forklift,
    glyph: 'EQ',
    primaryKey: 'batteryLevel',
    cardKeys: ['batteryLevel', 'temperature'],
  },
  'dtwin:ShipmentTwin': {
    icon: Package,
    glyph: 'SH',
    primaryKey: 'etaMinutes',
    cardKeys: ['etaMinutes', 'temperature'],
  },
  'dtwin:CarrierTwin': {
    icon: Truck,
    glyph: 'CA',
    primaryKey: 'utilization',
    cardKeys: ['utilization'],
  },
  'dtwin:InventoryTwin': {
    icon: Boxes,
    glyph: 'IN',
    primaryKey: 'utilization',
    cardKeys: ['utilization'],
  },
};

const FALLBACK_META: TwinClassMeta = { icon: Wrench, glyph: 'TW', cardKeys: [] };

export function classMeta(classIri: string): TwinClassMeta {
  return META[classIri] ?? FALLBACK_META;
}

export function classLabel(classIri: string): string {
  return classIri.replace(/^dtwin:/, '');
}

/** Numeric telemetry keys (ordered) actually present in a twin state. */
export const TELEMETRY_KEYS = [
  'temperature',
  'humidity',
  'utilization',
  'etaMinutes',
  'batteryLevel',
] as const;

export function presentTelemetry(state: TwinStateShape): string[] {
  return TELEMETRY_KEYS.filter((k) => typeof state[k] === 'number');
}

/** Static (DTDL Property-style) state keys shown in the inspector. */
export const PROPERTY_KEYS = [
  'status',
  'zoneType',
  'tempTargetMin',
  'tempTargetMax',
  'equipmentType',
  'lat',
  'lng',
  'mirroredIri',
  'lastTickAt',
] as const;

/* ── formatting ──────────────────────────────────────────────── */

export function unitFor(key: string): string {
  switch (key) {
    case 'temperature':
      return '°C';
    case 'humidity':
    case 'utilization':
    case 'batteryLevel':
      return '%';
    case 'etaMinutes':
      return 'min';
    case 'lat':
    case 'lng':
      return '°';
    default:
      return '';
  }
}

export function labelFor(key: string): string {
  switch (key) {
    case 'temperature':
      return 'temp';
    case 'humidity':
      return 'rh';
    case 'utilization':
      return 'util';
    case 'etaMinutes':
      return 'ETA';
    case 'batteryLevel':
      return 'batt';
    default:
      return key;
  }
}

export function fmtNum(key: string, v: number): string {
  if (key === 'etaMinutes') return `${Math.round(v)}`;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}`;
}

export function fmtValue(key: string, v: unknown): string {
  if (typeof v === 'number') return `${fmtNum(key, v)}${unitFor(key)}`;
  if (v == null) return '—';
  return String(v);
}

/** "14:02:11" from an ISO/date-ish value */
export function fmtTime(v: unknown): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

/** "14:02:11.408" */
export function fmtTimeMs(v: unknown): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return '—';
  const base = d.toLocaleTimeString('en-GB', { hour12: false });
  return `${base}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/* ── status vocabulary ───────────────────────────────────────── */

/** Map a seeded twin status to the semantic status-dot kind. */
export function statusKind(status?: string): StatusKind {
  switch (status) {
    case 'operational':
    case 'active':
    case 'in-stock':
      return 'ok';
    case 'in_transit':
      return 'info';
    case 'degraded':
    case 'maintenance':
      return 'warn';
    case 'offline':
      return 'risk';
    case 'delivered':
      return 'idle';
    default:
      return 'idle';
  }
}

export function statusLabel(status?: string): string {
  return (status ?? 'unknown').replace(/_/g, ' ');
}

/** Threshold rule per (class, key) — drives amber rule-lines + warn chips. */
export function thresholdFor(
  classIri: string,
  key: string,
  state: TwinStateShape,
): number | null {
  if (key === 'utilization' && classIri === 'dtwin:WarehouseTwin') return 90;
  if (key === 'temperature' && typeof state.tempTargetMax === 'number') {
    return state.tempTargetMax;
  }
  return null;
}
