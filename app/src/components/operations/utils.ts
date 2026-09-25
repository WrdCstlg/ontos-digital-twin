/**
 * Shared helpers for the Operations page (background jobs and workers).
 */
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';

type Outputs = inferRouterOutputs<AppRouter>;

export type JobRow = Outputs['operations']['listJobs'][number];
export type WorkerRow = Outputs['operations']['listWorkers'][number];
export type OpsSummary = Outputs['operations']['summary'];

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export const JOB_STATUSES: JobStatus[] = ['queued', 'running', 'succeeded', 'failed'];

/** Poll fast while work is in flight, slowly when the queue is idle. */
export const FAST_POLL_MS = 2000;
export const SLOW_POLL_MS = 15000;

export function isActiveJob(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}

function toMs(d: Date | string): number {
  return (typeof d === 'string' ? new Date(d) : d).getTime();
}

/** "45s", "3m 12s", "2h 5m", "3d 4h". */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** "12s ago" relative to a caller-supplied instant (keeps render pure). */
export function ago(d: Date | string | null | undefined, now: number): string {
  if (!d) return '—';
  const s = Math.max(0, Math.floor((now - toMs(d)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Seconds from `now` until `d`; negative once it has passed. */
export function secondsUntil(d: Date | string | null | undefined, now: number): number | null {
  if (!d) return null;
  return Math.round((toMs(d) - now) / 1000);
}

/** "2026-09-24 14:01:03" for tooltips and the detail panel. */
export function stamp(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const t = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${t.toLocaleTimeString('en-GB', { hour12: false })}`;
}

/** Pretty JSON for the expandable job detail. */
export function prettyJson(v: unknown): string {
  if (v == null) return 'null';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const KIND_LABELS: Record<string, string> = {
  'mapping.sync': 'CSV import',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

/** The mapping a `mapping.sync` job imports, read from its payload. */
export function payloadMappingId(job: Pick<JobRow, 'kind' | 'payloadJson'>): number | null {
  if (job.kind !== 'mapping.sync') return null;
  const p = job.payloadJson as { mappingId?: unknown } | null;
  return typeof p?.mappingId === 'number' ? p.mappingId : null;
}

export function payloadSyncJobId(job: Pick<JobRow, 'kind' | 'payloadJson'>): number | null {
  if (job.kind !== 'mapping.sync') return null;
  const p = job.payloadJson as { syncJobId?: unknown } | null;
  return typeof p?.syncJobId === 'number' ? p.syncJobId : null;
}

/** The first line of a (possibly multi-line) error, for table cells. */
export function firstLine(text: string | null | undefined): string | null {
  const line = text?.split('\n').find((l) => l.trim() !== '');
  return line?.trim() || null;
}
