import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ListChecks, Loader2, RotateCcw, Ban } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { JobStatusBadge } from './JobStatusBadge';
import { JobDetail } from './JobDetail';
import {
  JOB_STATUSES,
  ago,
  firstLine,
  formatSeconds,
  kindLabel,
  payloadMappingId,
  payloadSyncJobId,
  secondsUntil,
  stamp,
  type JobRow,
  type JobStatus,
} from './utils';

export type JobAction = { kind: 'retry' | 'cancel'; job: JobRow };

export interface JobsTableProps {
  jobs: JobRow[];
  isLoading: boolean;
  error: string | null;
  onReload: () => void;
  filter: JobStatus | 'all';
  counts: Record<JobStatus, number> | undefined;
  onFilter: (filter: JobStatus | 'all') => void;
  limit: number;
  now: number;
  isAdmin: boolean;
  expandedId: number | null;
  onToggle: (jobId: number) => void;
  mappingNames: ReadonlyMap<number, string>;
  onAction: (action: JobAction) => void;
}

const FILTER_LABEL: Record<JobStatus | 'all', string> = {
  all: 'All',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

function LeaseCell({ job, now }: { job: JobRow; now: number }) {
  if (job.status !== 'running' || !job.leaseOwner) return <span className="font-mono text-[10.5px] text-text-muted">—</span>;
  const left = secondsUntil(job.leaseExpiresAt, now);
  return (
    <div className="min-w-0">
      <div className="max-w-[160px] truncate font-mono text-[11px] text-text-secondary" title={job.leaseOwner}>
        {job.leaseOwner}
      </div>
      {left != null && (
        <div className={cn('font-mono text-[10px]', left >= 0 ? 'text-ok' : 'text-risk')} title={`expires ${stamp(job.leaseExpiresAt)}`}>
          {left >= 0 ? `${formatSeconds(left)} left` : `lapsed ${formatSeconds(-left)} ago`}
        </div>
      )}
    </div>
  );
}

function TimeCell({ d, now }: { d: Date | string | null; now: number }) {
  return (
    <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-text-secondary" title={d ? stamp(d) : undefined}>
      {d ? ago(d, now) : <span className="text-text-muted">—</span>}
    </td>
  );
}

/**
 * Operations §3 — the job queue, newest first. Rows expand to the full job:
 * timings, lease, payload and result JSON, error history. Admins can retry a
 * failed job or cancel one that has not started.
 */
export function JobsTable({
  jobs,
  isLoading,
  error,
  onReload,
  filter,
  counts,
  onFilter,
  limit,
  now,
  isAdmin,
  expandedId,
  onToggle,
  mappingNames,
  onAction,
}: JobsTableProps) {
  const headers = ['Job', 'Kind', 'Status', 'Attempts', 'Lease', 'Created', 'Started', 'Finished', 'Last error'];
  if (isAdmin) headers.push('');
  const total = counts ? JOB_STATUSES.reduce((s, k) => s + counts[k], 0) : undefined;

  return (
    <section className="rounded-xl border border-border-hairline bg-bg-panel" aria-label="Jobs">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-hairline px-4 py-3">
        <ListChecks className="size-4 text-text-muted" />
        <h2 className="font-display text-[16px] font-semibold text-text-primary">Jobs</h2>
        <div
          className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border-hairline bg-bg-inset p-1"
          role="group"
          aria-label="Status filter"
        >
          {(['all', ...JOB_STATUSES] as const).map((k) => {
            const n = k === 'all' ? total : counts?.[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => onFilter(k)}
                aria-pressed={filter === k}
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-1 text-[12px] transition-colors',
                  filter === k ? 'bg-bg-panel-raised text-text-primary' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {FILTER_LABEL[k]}
                {n != null && <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">{n}</span>}
              </button>
            );
          })}
        </div>
        <span className="ml-auto font-mono text-[10.5px] text-text-muted">newest {limit} · up to 3 attempts, with backoff</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border-hairline">
              {headers.map((h, i) => (
                <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border-hairline/50">
                  <td colSpan={headers.length} className="px-3 py-1.5">
                    <Skeleton className="h-7 w-full" />
                  </td>
                </tr>
              ))}
            {!isLoading && error && (
              <tr>
                <td colSpan={headers.length} className="px-3 py-8 text-center text-[13px] text-text-muted">
                  The job queue could not be loaded: <span className="font-mono text-[12px] text-risk">{error}</span>{' '}
                  <button type="button" onClick={onReload} className="text-text-accent hover:underline">
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {!isLoading && !error && jobs.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="px-3 py-10 text-center">
                  <p className="text-[13px] text-text-secondary">
                    {filter === 'all' ? 'No background jobs yet.' : `No ${filter} jobs.`}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-text-muted">
                    {filter === 'all'
                      ? 'run a sync from Mapping & Sync or the dashboard — it is queued here for a worker'
                      : 'clear the status filter to see every job'}
                  </p>
                </td>
              </tr>
            )}
            <AnimatePresence initial={false}>
              {!isLoading &&
                !error &&
                jobs.map((job) => {
                  const isOpen = expandedId === job.id;
                  const mappingId = payloadMappingId(job);
                  const syncJobId = payloadSyncJobId(job);
                  const mappingName = mappingId != null ? (mappingNames.get(mappingId) ?? `mapping #${mappingId}`) : null;
                  const runIn = job.status === 'queued' ? secondsUntil(job.runAfter, now) : null;
                  const err = firstLine(job.lastError);
                  return [
                    <motion.tr
                      key={job.id}
                      id={`job-row-${job.id}`}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      onClick={() => onToggle(job.id)}
                      className={cn(
                        'cursor-pointer border-b border-border-hairline/50 align-top transition-colors hover:bg-bg-panel-raised',
                        isOpen && 'bg-bg-panel-raised/60',
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-text-accent">
                        <ChevronDown
                          className={cn('mr-1 inline size-3 text-text-muted transition-transform duration-200', isOpen && 'rotate-180')}
                        />
                        #{job.id}
                      </td>
                      <td className="px-3 py-2">
                        <div className="whitespace-nowrap text-[12.5px] text-text-primary">{kindLabel(job.kind)}</div>
                        <div className="max-w-[220px] truncate font-mono text-[10.5px] text-text-muted" title={job.kind}>
                          {job.kind}
                          {mappingName && ` · ${mappingName}`}
                          {syncJobId != null && ` · run-${syncJobId}`}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <JobStatusBadge status={job.status} />
                        {runIn != null && runIn > 0 && (
                          <div className="font-mono text-[10px] text-warn">retry in {formatSeconds(runIn)}</div>
                        )}
                      </td>
                      <td
                        className={cn(
                          'whitespace-nowrap px-3 py-2 font-mono text-[11.5px] tabular-nums',
                          job.status === 'failed' && job.attempts >= job.maxAttempts
                            ? 'text-risk'
                            : job.attempts > 1
                              ? 'text-warn'
                              : 'text-text-secondary',
                        )}
                      >
                        {job.attempts}/{job.maxAttempts}
                      </td>
                      <td className="px-3 py-2">
                        <LeaseCell job={job} now={now} />
                      </td>
                      <TimeCell d={job.createdAt} now={now} />
                      <TimeCell d={job.startedAt} now={now} />
                      <TimeCell d={job.finishedAt} now={now} />
                      <td className="px-3 py-2">
                        {err ? (
                          <span
                            title={job.lastError ?? undefined}
                            className={cn(
                              'block max-w-[280px] truncate font-mono text-[11px]',
                              job.status === 'failed' ? 'text-risk' : job.status === 'succeeded' ? 'text-text-muted' : 'text-warn',
                            )}
                          >
                            {err}
                          </span>
                        ) : (
                          <span className="font-mono text-[10.5px] text-text-muted">—</span>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {job.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => onAction({ kind: 'retry', job })}
                              className="inline-flex items-center gap-1 rounded-md border border-border-hairline px-2 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-iris/50 hover:bg-iris/10 hover:text-text-accent"
                            >
                              <RotateCcw className="size-3" /> Retry
                            </button>
                          )}
                          {job.status === 'queued' && (
                            <button
                              type="button"
                              onClick={() => onAction({ kind: 'cancel', job })}
                              className="inline-flex items-center gap-1 rounded-md border border-border-hairline px-2 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-risk/40 hover:bg-risk/10 hover:text-risk"
                            >
                              <Ban className="size-3" /> Cancel
                            </button>
                          )}
                          {job.status === 'running' && (
                            <span
                              className="inline-flex items-center gap-1 font-mono text-[10.5px] text-text-muted"
                              title="A running job cannot be cancelled; it finishes, fails, or its lease lapses"
                            >
                              <Loader2 className="size-3 animate-spin" /> in flight
                            </span>
                          )}
                        </td>
                      )}
                    </motion.tr>,
                    isOpen && (
                      <tr key={`${job.id}-detail`} className="border-b border-border-hairline/50">
                        <td colSpan={headers.length} className="bg-bg-inset/60 px-4 py-3">
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <JobDetail job={job} now={now} mappingName={mappingName} />
                          </motion.div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </section>
  );
}
