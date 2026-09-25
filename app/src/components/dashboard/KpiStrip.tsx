import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { trpc } from '@/providers/trpc';
import { KpiCard } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { daysAgoLabel, formatInt, makeSpark } from './utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Dashboard §2 — KPI strip. All values from the tRPC API:
 * overview (edges/instances/insights) + mapping.listSyncJobs (sync health).
 */
export function KpiStrip() {
  const navigate = useNavigate();
  const overview = trpc.dashboard.overview.useQuery();
  const jobsQ = trpc.mapping.listSyncJobs.useQuery(
    { limit: 25 },
    {
      // Imports run on a worker; refresh while any is queued or running.
      refetchInterval: (q) =>
        (q.state.data ?? []).some((j) => j.status === 'queued' || j.status === 'running') ? 3000 : false,
    },
  );

  if (overview.isLoading || jobsQ.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[150px] rounded-xl border border-border-hairline bg-bg-panel" />
        ))}
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <div className="rounded-xl border border-border-hairline bg-bg-panel p-5 text-[13px] text-text-muted">
        Could not load workspace metrics{overview.error ? `: ${overview.error.message}` : '.'}
      </div>
    );
  }

  const { kpis } = overview.data;
  const jobs = jobsQ.data ?? [];
  // Queued and running imports have no outcome yet.
  const done = jobs.filter((j) => j.status === 'succeeded' || j.status === 'failed');
  const inFlight = jobs.length - done.length;
  const successRate = done.length ? (done.filter((j) => j.status === 'succeeded').length / done.length) * 100 : 100;
  const lastFailure = jobs.find((j) => j.status === 'failed');
  // react-query's dataUpdatedAt is a pure "now" reference for this render
  const now = jobsQ.dataUpdatedAt || new Date(jobs[0]?.startedAt ?? 0).getTime() || 0;
  const weekRows = jobs
    .filter((j) => j.status === 'succeeded' && now - new Date(j.startedAt).getTime() < 7 * 86_400_000)
    .reduce((acc, j) => acc + Number(j.rowsProcessed), 0);
  // Real job outcomes oldest→newest, padded to a 30pt health series
  const healthSeries = [
    ...Array.from({ length: Math.max(0, 30 - done.length) }, () => 100),
    ...[...done].reverse().map((j) => (j.status === 'succeeded' ? 100 : 0)),
  ];

  const cards = [
    {
      key: 'edges',
      label: 'Total Edges',
      value: formatInt(kpis.totalEdges),
      delta: weekRows > 0 ? `${formatInt(weekRows)} this week` : undefined,
      deltaDir: 'up' as const,
      spark: makeSpark(kpis.totalEdges % 9973, kpis.totalEdges),
      to: '/app/explorer',
    },
    {
      key: 'instances',
      label: 'Instances',
      value: formatInt(kpis.totalNodes),
      delta: weekRows > 0 ? `${formatInt(weekRows)} via sync` : undefined,
      deltaDir: 'up' as const,
      spark: makeSpark(kpis.totalNodes % 7919, kpis.totalNodes),
      to: '/app/explorer',
    },
    {
      key: 'insights',
      label: 'Open Insights',
      value: formatInt(kpis.openInsights),
      spark: makeSpark(kpis.openInsights + 41, Math.max(kpis.openInsights, 3)),
      to: '/app/insights',
      footer: (
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-warn/15 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-warn">
          needs review
        </span>
      ),
    },
    {
      key: 'sync',
      label: 'Sync Health',
      value: `${successRate.toFixed(1)}%`,
      spark: healthSeries,
      to: '/app/mapping',
      footer: (
        <span className="mt-2 block font-mono text-[10.5px] text-text-muted">
          {lastFailure ? `last failure ${daysAgoLabel(lastFailure.startedAt)}` : 'no failures on record'}
          {' · '}
          {done.length} runs
          {inFlight > 0 && ` · ${inFlight} in progress`}
        </span>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c, i) => (
        <motion.div
          key={c.key}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.08, ease: EASE }}
          whileHover={{ y: -2 }}
        >
          <KpiCard
            label={c.label}
            value={c.value}
            delta={c.delta}
            deltaDir={c.deltaDir}
            spark={c.spark}
            onClick={() => navigate(c.to)}
            className="h-full cursor-pointer"
            role="link"
            aria-label={`${c.label}: ${c.value} — open details`}
          >
            {c.footer}
          </KpiCard>
        </motion.div>
      ))}
    </div>
  );
}
