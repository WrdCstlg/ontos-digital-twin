import type { ModuleKey } from '@/lib/modules';

/** Deterministic pseudo-random generator (mulberry32) so derived sparklines are stable. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a stable, gently trending sparkline anchored to a real value.
 * Used where the API exposes only current totals — the endpoint value is real,
 * the shape is a deterministic illustration around it.
 */
export function makeSpark(seed: number, endValue: number, points = 30): number[] {
  const rnd = seededRandom(seed);
  const base = Math.max(endValue, 1);
  const out: number[] = [];
  let v = base * (0.82 + rnd() * 0.06);
  for (let i = 0; i < points; i++) {
    out.push(Math.round(v));
    const drift = base * 0.006 + (rnd() - 0.45) * base * 0.02;
    v = Math.max(v + drift, base * 0.4);
  }
  out[points - 1] = Math.round(endValue);
  return out;
}

/** Small 7-point sparkline for module rows. */
export function makeMiniSpark(seed: number, value: number): number[] {
  const rnd = seededRandom(seed);
  const base = Math.max(value, 1);
  return Array.from({ length: 7 }, () => Math.round(base * (0.75 + rnd() * 0.5)));
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function timeHHMMSS(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleTimeString('en-GB', { hour12: false });
}

export function relTime(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const s = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function daysAgoLabel(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const days = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export type Severity = 'info' | 'warn' | 'risk';

export const SEVERITY_COLOR: Record<Severity, string> = {
  info: '#38BDF8',
  warn: '#FBBF24',
  risk: '#F87171',
};

/** Infer the modules an insight touches from its rule id / title (real fields). */
export function modulesForInsight(ruleId: string | null, title: string): ModuleKey[] {
  const text = `${ruleId ?? ''} ${title}`.toLowerCase();
  const mods = new Set<ModuleKey>();
  if (/vendor|payment|invoice|transaction|cost.?center|spend/.test(text)) mods.add('finance');
  if (/contract|legal|counsel/.test(text)) mods.add('legal');
  if (/control|evidence|audit|recert|cmp-/.test(text)) mods.add('compliance');
  if (/person|employee|manager|org.?island|contractor|people/.test(text)) mods.add('hr');
  if (/shipment|delivery|route|warehouse|log/.test(text)) mods.add('logistics');
  if (mods.size === 0) mods.add('custom');
  return [...mods];
}

export type ActivityCategory = 'ontology' | 'mapping' | 'sync' | 'insights';

/** Map an audit-log entityType to a dashboard activity category. */
export function categorizeActivity(entityType: string): ActivityCategory {
  if (entityType.startsWith('ontology')) return 'ontology';
  if (entityType === 'mapping') return 'mapping';
  if (entityType === 'sync_job' || entityType === 'connector') return 'sync';
  // insight, insight_scan, reasoner_run, nlq
  return 'insights';
}
