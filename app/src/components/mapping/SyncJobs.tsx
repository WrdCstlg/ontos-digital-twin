import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  ChevronDown,
  Clock,
  GitCompareArrows,
  History,
  Loader2,
  MoreHorizontal,
  Play,
  Radio,
  Webhook,
} from 'lucide-react';
import { StatusDot } from '@/components/ui/status-dot';
import { JobStatusBadge } from '@/components/operations/JobStatusBadge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { moduleAlpha, moduleForPrefix } from '@/lib/modules';
import {
  attemptLabel,
  clockTime,
  duration,
  inferTrigger,
  isActiveSync,
  relTime,
  syncErrorText,
  type SyncJobLike,
  type SyncJobStatus,
  type TriggerKind,
} from './utils';

const TRIGGER_META: Record<TriggerKind, { icon: typeof Clock; label: string }> = {
  schedule: { icon: Clock, label: 'schedule' },
  webhook: { icon: Webhook, label: 'webhook' },
  cdc: { icon: Radio, label: 'CDC' },
  manual: { icon: Play, label: 'manual' },
};

const JOB_STATUS_LABEL: Record<SyncJobStatus, string> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'ok',
  failed: 'failed',
};

interface LogLine {
  text: string;
  tone?: 'risk' | 'warn' | 'muted';
}

const LOG_TONE: Record<NonNullable<LogLine['tone']> | 'default', string> = {
  default: 'text-text-secondary',
  muted: 'text-text-muted',
  warn: 'text-warn',
  risk: 'text-risk',
};

function snapshotNum(label: string): number {
  const n = Number(label.replace(/^v/, ''));
  return Number.isFinite(n) ? n : 0;
}

export interface SyncJobsProps {
  jobs: SyncJobLike[];
  isLoading: boolean;
}

export function SyncJobs({ jobs, isLoading }: SyncJobsProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [rollback, setRollback] = useState<string | null>(null);

  /* snapshot strip — labels derived from real sync jobs */
  const snapshots = useMemo(() => {
    const labels = [...new Set(jobs.map((j) => j.snapshotLabel).filter((x): x is string => !!x))];
    return labels.sort((a, b) => snapshotNum(a) - snapshotNum(b));
  }, [jobs]);
  const current = snapshots[snapshots.length - 1] ?? null;

  const toggleSnapshot = (label: string) =>
    setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s.slice(-1), label]));

  const jobAt = (label: string) => jobs.filter((j) => j.snapshotLabel === label);

  const logLines = (job: SyncJobLike): LogLine[] => {
    const t = clockTime(job.startedAt);
    const end = clockTime(job.finishedAt);
    const via = job.jobId ? ` · job #${job.jobId}` : '';
    const lines: LogLine[] = [
      {
        text:
          job.status === 'queued'
            ? `[${t}] sync job run-${job.id} queued${via} · trigger ${TRIGGER_META[inferTrigger(job.connector)].label}`
            : `[${t}] sync job run-${job.id} started${via} · trigger ${TRIGGER_META[inferTrigger(job.connector)].label}`,
      },
      { text: `[${t}] source ${job.connector?.name ?? '—'} · mapping '${job.mapping?.name ?? '—'}' · table ${job.mapping?.sourceTable ?? '—'}` },
    ];
    const attempt = attemptLabel(job);
    const err = syncErrorText(job);
    if (job.status === 'failed') {
      if (attempt) lines.push({ text: `[${end}] ${attempt}`, tone: 'warn' });
      lines.push({ text: `[${end}] FAILED — ${err ?? 'no error recorded; see the audit log'}`, tone: 'risk' });
    } else if (isActiveSync(job.status)) {
      if (attempt && err) lines.push({ text: `[${t}] previous attempt failed — ${err}`, tone: 'warn' });
      if (attempt) lines.push({ text: `[${t}] ${attempt}`, tone: 'warn' });
      lines.push({
        text: job.status === 'queued' ? `[${t}] waiting for a worker…` : `[${t}] a worker is importing rows…`,
        tone: 'muted',
      });
    } else {
      const r = job.result;
      if (attempt) lines.push({ text: `[${end}] succeeded on ${attempt}`, tone: 'warn' });
      lines.push({ text: `[${end}] upserted ${r?.nodesUpserted ?? job.rowsProcessed} instances into kg_nodes` });
      if (r) lines.push({ text: `[${end}] created ${r.edgesCreated} edges` });
      if (r?.shacl) {
        lines.push(
          r.shacl.conforms === false
            ? { text: `[${end}] SHACL: ${r.shacl.violationCount} violation(s)`, tone: 'warn' }
            : { text: `[${end}] SHACL: ${r.shacl.conforms ? 'conforms' : 'not evaluated'}` },
        );
      }
      if (job.snapshotLabel) lines.push({ text: `[${end}] graph snapshot ${job.snapshotLabel} committed` });
    }
    return lines;
  };

  const activeCount = jobs.filter((j) => isActiveSync(j.status)).length;

  return (
    <section className="rounded-xl border border-border-hairline bg-bg-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-hairline px-4 py-3">
        <h2 className="font-display text-[16px] font-semibold text-text-primary">Sync Runs</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ok">
          <StatusDot status="ok" className="size-1.5" /> live
        </span>
        {activeCount > 0 && (
          <span className="font-mono text-[11px] text-text-muted">
            {activeCount} in the queue · run by a worker
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {selected.length === 2 && (
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-iris/50 bg-iris/15 px-2.5 py-1 font-mono text-[11px] text-text-accent transition-colors hover:bg-iris/25"
            >
              <GitCompareArrows className="size-3.5" /> Compare {selected[0]} ↔ {selected[1]}
            </button>
          )}
          <Link
            to="/app/operations"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted transition-colors hover:text-text-accent"
          >
            Operations <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>

      {/* graph snapshots strip */}
      {snapshots.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border-hairline px-4 py-2.5">
          <History className="size-3.5 shrink-0 text-text-muted" />
          <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Graph snapshots</span>
          {snapshots.map((label) => {
            const active = selected.includes(label);
            const isCurrent = label === current;
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleSnapshot(label)}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors',
                  active
                    ? 'border-iris/60 bg-iris/20 text-text-accent'
                    : 'border-border-hairline bg-bg-inset text-text-secondary hover:border-border-glow',
                )}
              >
                {label}
                {isCurrent && <span className="ml-1 text-ok">(current)</span>}
              </button>
            );
          })}
          {selected.length > 0 && (
            <button type="button" onClick={() => setSelected([])} className="shrink-0 font-mono text-[10.5px] text-text-muted hover:text-text-primary">
              clear
            </button>
          )}
        </div>
      )}

      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border-hairline">
              {['Run ID', 'Source', 'Trigger', 'Started', 'Duration', 'Δ instances', 'Snapshot', 'Status', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center font-mono text-[11.5px] text-text-muted">
                  <Loader2 className="mr-2 inline size-3.5 animate-spin" />
                  loading sync history…
                </td>
              </tr>
            )}
            {!isLoading && jobs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[12.5px] text-text-muted">
                  No sync runs yet — save a mapping and hit <span className="font-mono text-text-accent">Run sync</span>.
                </td>
              </tr>
            )}
            <AnimatePresence initial={false}>
              {jobs.map((job) => {
                const trig = TRIGGER_META[inferTrigger(job.connector)];
                const isOpen = expanded === job.id;
                const active = isActiveSync(job.status);
                const attempt = attemptLabel(job);
                const err = syncErrorText(job);
                const lines = isOpen ? logLines(job) : [];
                return [
                  <motion.tr
                    key={job.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    onClick={() => setExpanded(isOpen ? null : job.id)}
                    className={cn('h-9 cursor-pointer border-b border-border-hairline/50 transition-colors hover:bg-bg-panel-raised', isOpen && 'bg-bg-panel-raised/60')}
                  >
                    <td className="px-3 py-1.5 font-mono text-[11.5px] text-text-accent">run-{job.id}</td>
                    <td className="px-3 py-1.5 text-[12.5px] text-text-primary">{job.connector?.name ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
                        <trig.icon className="size-3.5 text-text-muted" /> {trig.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11.5px] text-text-secondary" title={relTime(job.startedAt)}>
                      {clockTime(job.startedAt)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11.5px] text-text-secondary">{duration(job.startedAt, job.finishedAt)}</td>
                    <td className="px-3 py-1.5 font-mono text-[11.5px]">
                      {job.status === 'failed' ? (
                        <span className="text-risk">+0/−0</span>
                      ) : active ? (
                        <span className="text-text-muted">…</span>
                      ) : (
                        <span className="text-ok">+{job.rowsProcessed}/−0</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {job.snapshotLabel ? (
                        <span className="rounded border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary">
                          {job.snapshotLabel}
                        </span>
                      ) : (
                        <span className="font-mono text-[10.5px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-col gap-0.5 py-0.5">
                        {active ? (
                          <JobStatusBadge status={job.status} label={JOB_STATUS_LABEL[job.status]} />
                        ) : (
                          <motion.span
                            initial={{ scale: 0.9, opacity: 0.6 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.3 }}
                            className="inline-flex"
                          >
                            <JobStatusBadge status={job.status} label={JOB_STATUS_LABEL[job.status]} />
                          </motion.span>
                        )}
                        {attempt && <span className="font-mono text-[10px] text-warn">{attempt}</span>}
                        {job.status === 'failed' && err && (
                          <span title={err} className="max-w-[240px] truncate font-mono text-[10.5px] text-risk">
                            {err}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <ChevronDown className={cn('size-3.5 text-text-muted transition-transform', isOpen && 'rotate-180')} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label="Run actions" className="rounded p-1 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary">
                              <MoreHorizontal className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="border-border-hairline bg-bg-panel-raised">
                            <DropdownMenuItem onSelect={() => setExpanded(job.id)}>View log</DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!job.jobId}
                              onSelect={() => job.jobId && navigate(`/app/operations?job=${job.jobId}`)}
                            >
                              Open in Operations
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!job.snapshotLabel} onSelect={() => setRollback(job.snapshotLabel)}>
                              Rollback snapshot
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </motion.tr>,
                  isOpen && (
                    <tr key={`${job.id}-detail`} className="border-b border-border-hairline/50 bg-bg-inset/60">
                      <td colSpan={9} className="px-4 py-3">
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          transition={{ duration: 0.2 }}
                          className="grid gap-3 overflow-hidden md:grid-cols-2"
                        >
                          <div className="rounded-lg border border-border-hairline bg-bg-inset p-3">
                            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Log</div>
                            {lines.map((l, i) => (
                              <div key={i} className={cn('break-words font-mono text-[11px] leading-relaxed', LOG_TONE[l.tone ?? 'default'])}>
                                {l.text}
                              </div>
                            ))}
                          </div>
                          <div className="grid content-start gap-2.5">
                            <div className="rounded-lg border border-border-hairline bg-bg-inset p-3">
                              <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Provenance</div>
                              <p className="font-mono text-[11px] leading-relaxed text-text-secondary">
                                every edge carries <span className="text-info">ontos:source</span>{' '}
                                <span className="text-info">ontos:mapping</span> <span className="text-info">ontos:timestamp</span>
                                {job.mapping && (
                                  <>
                                    {' '}— this run: <span className="text-text-accent">{job.mapping.name}</span> ·{' '}
                                    {clockTime(job.finishedAt ?? job.startedAt)}
                                  </>
                                )}
                              </p>
                            </div>
                            {job.snapshotLabel && (
                              <div className="flex items-center gap-2">
                                <span className="rounded border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary">
                                  graph {job.snapshotLabel}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const prev = snapshots[snapshots.indexOf(job.snapshotLabel!) - 1];
                                    setSelected(prev ? [prev, job.snapshotLabel!] : [job.snapshotLabel!]);
                                    if (prev) setCompareOpen(true);
                                  }}
                                  className="font-mono text-[11px] text-text-accent hover:underline"
                                >
                                  Diff snapshots →
                                </button>
                              </div>
                            )}
                          </div>
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

      {/* snapshot compare drawer */}
      <Sheet open={compareOpen} onOpenChange={setCompareOpen}>
        <SheetContent side="right" className="w-[420px] border-l border-border-hairline bg-bg-panel sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle className="font-display text-text-primary">
              Snapshot diff {selected[0]} → {selected[1]}
            </SheetTitle>
            <SheetDescription className="text-text-muted">
              Instances upserted per mapping between the two selected snapshots.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid gap-3">
            {selected.map((label) => {
              const at = jobAt(label);
              const total = at.reduce((s, j) => s + j.rowsProcessed, 0);
              return (
                <div key={label} className="rounded-lg border border-border-hairline bg-bg-inset p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-[12.5px] text-text-primary">{label}</span>
                    <span className="font-mono text-[11px] text-ok">+{total} instances</span>
                  </div>
                  {at.map((j) => {
                    const mod = moduleForPrefix((j.mapping?.classIri ?? 'ext:x').split(':')[0]);
                    const max = Math.max(1, ...jobs.map((x) => x.rowsProcessed));
                    return (
                      <div key={j.id} className="mb-1.5">
                        <div className="mb-0.5 flex justify-between font-mono text-[10.5px] text-text-muted">
                          <span>{j.mapping?.name ?? '—'}</span>
                          <span>+{j.rowsProcessed}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-border-hairline">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(j.rowsProcessed / max) * 100}%` }}
                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: mod.color, boxShadow: `0 0 6px ${moduleAlpha(mod.color, 0.5)}` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {at.length === 0 && <div className="font-mono text-[10.5px] text-text-muted">no runs recorded at this snapshot</div>}
                </div>
              );
            })}
            {selected.length === 2 && (
              <div className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2 font-mono text-[11px] text-text-secondary">
                net Δ{' '}
                <span className="text-ok">
                  +{Math.abs(jobAt(selected[1]).reduce((s, j) => s + j.rowsProcessed, 0) - jobAt(selected[0]).reduce((s, j) => s + j.rowsProcessed, 0))}
                </span>{' '}
                instances between snapshots
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* rollback confirm */}
      <AlertDialog open={rollback != null} onOpenChange={(o) => !o && setRollback(null)}>
        <AlertDialogContent className="border-border-hairline bg-bg-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-text-primary">Rollback to snapshot {rollback}?</AlertDialogTitle>
            <AlertDialogDescription className="text-text-secondary">
              Restores the knowledge graph to <span className="font-mono text-text-accent">{rollback}</span> — instances and edges
              materialized after that snapshot would be reverted. In this demo build the graph-admin rollback endpoint is not
              exposed, so the action is read-only here; the audit trail and snapshots above are live data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border-hairline bg-transparent text-text-secondary hover:bg-bg-panel-raised">
              Close
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
