import { motion } from 'framer-motion';
import { Cpu, Loader2 } from 'lucide-react';
import { StatusDot, type StatusKind } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';
import { ago, formatSeconds, stamp, type WorkerRow } from './utils';

/** A worker that missed three 5 s heartbeats is stale (matches the API's rule). */
const STALE_AFTER_SECONDS = 15;

function workerState(w: WorkerRow, seenSeconds: number): { dot: StatusKind; label: string; tone: string } {
  if (w.status === 'stopped') return { dot: 'idle', label: 'stopped', tone: 'text-text-muted' };
  if (w.status === 'stopping') return { dot: 'warn', label: 'stopping', tone: 'text-warn' };
  if (w.alive && seenSeconds < STALE_AFTER_SECONDS) return { dot: 'ok', label: 'alive', tone: 'text-ok' };
  return { dot: 'risk', label: 'stale', tone: 'text-risk' };
}

export interface WorkersPanelProps {
  workers: WorkerRow[];
  isLoading: boolean;
  error: string | null;
  /** When the list was fetched; secondsSinceSeen is measured at that instant. */
  fetchedAt: number;
  now: number;
  onOpenJob: (jobId: number) => void;
}

/**
 * Operations §2 — the worker processes serving the queue (admins only):
 * heartbeat freshness, the job each one holds, and lifetime outcomes.
 */
export function WorkersPanel({ workers, isLoading, error, fetchedAt, now, onOpenJob }: WorkersPanelProps) {
  const drift = fetchedAt ? Math.max(0, (now - fetchedAt) / 1000) : 0;
  const alive = workers.filter((w) => workerState(w, w.secondsSinceSeen + drift).label === 'alive').length;

  return (
    <section className="rounded-xl border border-border-hairline bg-bg-panel" aria-label="Workers">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-hairline px-4 py-3">
        <Cpu className="size-4 text-text-muted" />
        <h2 className="font-display text-[16px] font-semibold text-text-primary">Workers</h2>
        {!isLoading && !error && (
          <span className="font-mono text-[11px] text-text-muted">
            {alive} alive · {workers.length} seen in the last day
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px] text-text-muted">heartbeat 5s · stale after {STALE_AFTER_SECONDS}s</span>
      </div>

      {isLoading ? (
        <div className="px-4 py-6 text-center font-mono text-[11.5px] text-text-muted">
          <Loader2 className="mr-2 inline size-3.5 animate-spin" />
          loading workers…
        </div>
      ) : error ? (
        <div className="px-4 py-5 font-mono text-[12px] text-risk">Could not load workers: {error}</div>
      ) : workers.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[13px] text-text-secondary">No worker has registered yet.</p>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            start api/worker.ts (the worker service in Docker), or set ONTOS_EMBEDDED_WORKER=true on the web app
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border-hairline">
                {['Worker', 'Version', 'State', 'Current job', 'Done', 'Up since'].map((h) => (
                  <th key={h} className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workers.map((w, i) => {
                const seen = w.secondsSinceSeen + drift;
                const st = workerState(w, seen);
                return (
                  <motion.tr
                    key={w.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, delay: Math.min(i, 8) * 0.03 }}
                    className={cn(
                      'border-b border-border-hairline/50 transition-colors last:border-b-0 hover:bg-bg-panel-raised/50',
                      st.label !== 'alive' && 'opacity-75',
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <StatusDot status={st.dot} pulse={st.label === 'alive'} />
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[11.5px] text-text-primary" title={w.id}>
                            {w.id}
                          </div>
                          <div className="truncate font-mono text-[10.5px] text-text-muted">{w.hostname}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary">{w.version ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={cn('font-mono text-[11.5px]', st.tone)}>{st.label}</span>
                      <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">seen {formatSeconds(seen)} ago</span>
                    </td>
                    <td className="px-3 py-2">
                      {w.currentJobId != null ? (
                        <button
                          type="button"
                          onClick={() => onOpenJob(w.currentJobId!)}
                          className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-info hover:underline"
                        >
                          <Loader2 className="size-3 animate-spin" /> job #{w.currentJobId}
                        </button>
                      ) : (
                        <span className="font-mono text-[11px] text-text-muted">idle</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11.5px]">
                      <span className="text-ok">✓ {w.jobsSucceeded}</span>
                      <span className={cn('ml-2', w.jobsFailed > 0 ? 'text-risk' : 'text-text-muted')}>✕ {w.jobsFailed}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary" title={stamp(w.startedAt)}>
                      {ago(w.startedAt, now)}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
