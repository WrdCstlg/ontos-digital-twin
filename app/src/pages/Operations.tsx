import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, RefreshCw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { StatusDot } from '@/components/ui/status-dot';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SummaryTiles } from '@/components/operations/SummaryTiles';
import { WorkersPanel } from '@/components/operations/WorkersPanel';
import { JobsTable, type JobAction } from '@/components/operations/JobsTable';
import { JobDetail } from '@/components/operations/JobDetail';
import { JobStatusBadge } from '@/components/operations/JobStatusBadge';
import {
  FAST_POLL_MS,
  SLOW_POLL_MS,
  isActiveJob,
  kindLabel,
  payloadMappingId,
  type JobStatus,
  type OpsSummary,
} from '@/components/operations/utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const JOBS_LIMIT = 50;

function inFlight(s: OpsSummary | undefined): boolean {
  return !!s && s.byStatus.queued + s.byStatus.running > 0;
}

function errorCode(err: unknown): string | undefined {
  return (err as { data?: { code?: string } } | null)?.data?.code;
}

/**
 * Operations — /app/operations. The background-job queue (CSV imports today)
 * and the worker processes that run it: queue depth, worker heartbeats, every
 * job with its attempts, lease and errors, and admin retry / cancel.
 */
export default function Operations() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const now = useNow(1000);

  const [filter, setFilter] = useState<JobStatus | 'all'>('all');
  // The action awaiting confirmation; kept after the dialog closes so its text
  // does not change during the close animation.
  const [pending, setPending] = useState<JobAction | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ?job=<id> (from Mapping & Sync, a worker, or a toast) expands that job.
  // Adjust-during-render when the param changes.
  const focusId = Number(params.get('job')) || null;
  const [expandedId, setExpandedId] = useState<number | null>(focusId);
  const [lastFocusId, setLastFocusId] = useState(focusId);
  if (lastFocusId !== focusId) {
    setLastFocusId(focusId);
    if (focusId != null) {
      setExpandedId(focusId);
      setFilter('all');
    }
  }

  /* ── queries: poll every 2 s while anything is queued or running ── */
  const summaryQ = trpc.operations.summary.useQuery(undefined, {
    retry: 1,
    refetchInterval: (q) => (inFlight(q.state.data) ? FAST_POLL_MS : SLOW_POLL_MS),
  });
  const busy = inFlight(summaryQ.data);
  const interval = busy ? FAST_POLL_MS : SLOW_POLL_MS;

  const jobsQ = trpc.operations.listJobs.useQuery(
    { status: filter === 'all' ? undefined : filter, limit: JOBS_LIMIT },
    {
      retry: 1,
      placeholderData: (prev) => prev,
      refetchInterval: (q) => (busy || (q.state.data ?? []).some((j) => isActiveJob(j.status)) ? FAST_POLL_MS : SLOW_POLL_MS),
    },
  );

  // Workers are shared infrastructure: workspace admins only. Anyone else gets
  // FORBIDDEN once, and the panel stays out of the way.
  const workersQ = trpc.operations.listWorkers.useQuery(undefined, {
    retry: false,
    refetchInterval: (q) => (q.state.status === 'error' ? false : interval),
    refetchOnWindowFocus: (q) => q.state.status !== 'error',
  });
  const workersCode = errorCode(workersQ.error);
  const workersHidden = workersCode === 'FORBIDDEN' || workersCode === 'UNAUTHORIZED';
  const isAdmin = workersQ.isSuccess || user?.role === 'admin';

  const mappingsQ = trpc.mapping.listMappings.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const mappingNames = useMemo(
    () => new Map((mappingsQ.data ?? []).map((m) => [m.id, m.name] as const)),
    [mappingsQ.data],
  );

  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  const focusInList = focusId != null && jobs.some((j) => j.id === focusId);
  // A focused job outside the newest 50 (or the current filter) is fetched on its own.
  const focusQ = trpc.operations.getJob.useQuery(
    { jobId: focusId ?? 0 },
    { enabled: focusId != null && jobsQ.isSuccess && !focusInList, retry: false, refetchInterval: interval },
  );

  // Bring the focused row into view once it is rendered.
  const scrolledFor = useRef<number | null>(null);
  useEffect(() => {
    if (focusId == null || !focusInList || scrolledFor.current === focusId) return;
    scrolledFor.current = focusId;
    requestAnimationFrame(() =>
      document.getElementById(`job-row-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }, [focusId, focusInList]);

  const openJob = (jobId: number) => {
    scrolledFor.current = null;
    setFilter('all');
    setExpandedId(jobId);
    setParams({ job: String(jobId) }, { replace: true });
  };

  const clearFocus = () => {
    setParams({}, { replace: true });
  };

  /* ── admin actions ── */
  const afterAction = () =>
    Promise.all([utils.operations.invalidate(), utils.mapping.listSyncJobs.invalidate()]);

  const retryM = trpc.operations.retryJob.useMutation({
    onSuccess: (job) => {
      toast.success(`Job #${job.id} is queued again`, {
        description: 'A worker picks it up with a fresh set of attempts.',
      });
      void afterAction();
    },
    onError: (err) => toast.error('Could not retry the job', { description: err.message }),
  });
  const cancelM = trpc.operations.cancelJob.useMutation({
    onSuccess: (job) => {
      toast.success(`Job #${job.id} cancelled`, {
        description: 'It left the queue and is marked failed; it will not run.',
      });
      void afterAction();
    },
    onError: (err) => toast.error('Could not cancel the job', { description: err.message }),
  });

  const requestAction = (action: JobAction) => {
    setPending(action);
    setConfirmOpen(true);
  };

  const confirmAction = () => {
    if (!pending) return;
    if (pending.kind === 'retry') retryM.mutate({ jobId: pending.job.id });
    else cancelM.mutate({ jobId: pending.job.id });
    setConfirmOpen(false);
  };

  const refreshAll = () => {
    void summaryQ.refetch();
    void jobsQ.refetch();
    if (!workersHidden) void workersQ.refetch();
  };

  const summary = summaryQ.data;
  const stalled = !!summary && summary.workersAlive === 0 && summary.byStatus.queued > 0;
  const fetching = summaryQ.isFetching || jobsQ.isFetching;
  const focusJob = !focusInList ? focusQ.data : undefined;
  const focusMappingId = focusJob ? payloadMappingId(focusJob) : null;
  const pendingMappingId = pending ? payloadMappingId(pending.job) : null;
  const pendingMappingName = pendingMappingId != null ? mappingNames.get(pendingMappingId) : undefined;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <Toaster position="bottom-right" theme="dark" />

      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
            Operations
          </h1>
          <p className="mt-1 max-w-2xl text-[15px] text-text-secondary">
            Background jobs and the workers that run them. Imports are queued here and run by a worker — not inside
            the request that asked for them.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ok">
            <StatusDot status="ok" className="size-1.5" /> live · {busy ? '2s' : '15s'}
          </span>
          <Link
            to="/app/mapping"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3.5 py-2 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            Mapping &amp; Sync <ArrowRight className="size-3.5" />
          </Link>
          <button
            type="button"
            onClick={refreshAll}
            aria-label="Refresh"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-2 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} />
          </button>
        </div>
      </motion.header>

      {summaryQ.error && (
        <div className="rounded-xl border border-risk/30 bg-risk/10 px-4 py-3 font-mono text-[12px] text-risk">
          Failed to load the queue summary: {summaryQ.error.message}
        </div>
      )}

      {/* ── Summary tiles ── */}
      <SummaryTiles summary={summary} isLoading={summaryQ.isLoading} filter={filter} onFilter={setFilter} />

      {/* ── No worker: queued jobs will wait ── */}
      <AnimatePresence>
        {stalled && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: EASE }}
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-warn">
                No worker is running — {summary.byStatus.queued} queued job{summary.byStatus.queued === 1 ? '' : 's'} will
                wait
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[1.55] text-text-secondary">
                Imports run in a worker process, not in the web app. Start one (
                <span className="font-mono text-[11.5px] text-text-primary">api/worker.ts</span>, the worker service in
                Docker) or run the web app with{' '}
                <span className="font-mono text-[11.5px] text-text-primary">ONTOS_EMBEDDED_WORKER=true</span>; queued jobs
                start as soon as a worker's heartbeat appears.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Workers (admins) ── */}
      {workersHidden ? (
        <p className="flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <ShieldCheck className="size-3.5" />
          Worker details are shared infrastructure, visible to workspace admins.
          {summary && ` ${summary.workersAlive} alive now.`}
        </p>
      ) : (
        <WorkersPanel
          workers={workersQ.data ?? []}
          isLoading={workersQ.isLoading}
          error={workersQ.error?.message ?? null}
          fetchedAt={workersQ.dataUpdatedAt}
          now={now}
          onOpenJob={openJob}
        />
      )}

      {/* ── Focused job outside the list ── */}
      {focusId != null && !focusInList && (focusJob || focusQ.error) && (
        <section className="rounded-xl border border-iris/40 bg-bg-panel">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-hairline px-4 py-3">
            <h2 className="font-display text-[16px] font-semibold text-text-primary">Job #{focusId}</h2>
            {focusJob && (
              <>
                <JobStatusBadge status={focusJob.status} />
                <span className="font-mono text-[11px] text-text-muted">
                  {kindLabel(focusJob.kind)} · not among the {filter === 'all' ? `newest ${JOBS_LIMIT}` : `${filter} jobs shown`}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={clearFocus}
              aria-label="Close"
              className="ml-auto rounded p-1 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="px-4 py-3">
            {focusJob ? (
              <JobDetail
                job={focusJob}
                now={now}
                mappingName={focusMappingId != null ? (mappingNames.get(focusMappingId) ?? null) : null}
              />
            ) : (
              <p className="font-mono text-[12px] text-risk">{focusQ.error?.message}</p>
            )}
          </div>
        </section>
      )}

      {/* ── Jobs ── */}
      <JobsTable
        jobs={jobs}
        isLoading={jobsQ.isLoading}
        error={jobsQ.error?.message ?? null}
        onReload={() => void jobsQ.refetch()}
        filter={filter}
        counts={summary?.byStatus}
        onFilter={setFilter}
        limit={JOBS_LIMIT}
        now={now}
        isAdmin={isAdmin}
        expandedId={expandedId}
        onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
        mappingNames={mappingNames}
        onAction={requestAction}
      />

      {/* ── Retry / cancel confirmation ── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border-border-hairline bg-bg-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-text-primary">
              {pending?.kind === 'retry' ? 'Retry' : 'Cancel'} job #{pending?.job.id}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-text-secondary">
              {pending?.kind === 'retry' ? (
                <>
                  Puts the failed {kindLabel(pending.job.kind).toLowerCase()}
                  {pendingMappingName && <span className="font-mono text-text-accent"> {pendingMappingName}</span>} back
                  in the queue with a fresh set of {pending.job.maxAttempts} attempts. The next free worker runs it.
                </>
              ) : (
                <>
                  Takes the {pending ? kindLabel(pending.job.kind).toLowerCase() : 'job'}
                  {pendingMappingName && <span className="font-mono text-text-accent"> {pendingMappingName}</span>} out
                  of the queue before a worker starts it and marks it failed, cancelled by you. It will not run unless an
                  admin retries it.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border-hairline bg-transparent text-text-secondary hover:bg-bg-panel-raised">
              {pending?.kind === 'cancel' ? 'Keep queued' : 'Close'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction}
              className={cn(
                'text-white',
                pending?.kind === 'cancel' ? 'bg-risk/90 hover:bg-risk' : 'bg-iris hover:bg-iris-bright',
              )}
            >
              {pending?.kind === 'cancel' ? 'Cancel job' : 'Retry job'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
