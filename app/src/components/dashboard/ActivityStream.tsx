import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DatabaseZap, GitBranch, ShieldCheck, Sparkles } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { categorizeActivity, timeHHMMSS, type ActivityCategory } from './utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const FILTERS: { key: 'all' | ActivityCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ontology', label: 'Ontology' },
  { key: 'mapping', label: 'Mapping' },
  { key: 'sync', label: 'Sync' },
  { key: 'insights', label: 'Insights' },
];

const CATEGORY_ICON: Record<ActivityCategory, { icon: typeof GitBranch; color: string }> = {
  ontology: { icon: GitBranch, color: '#818CF8' },
  mapping: { icon: GitBranch, color: '#A78BFA' },
  sync: { icon: DatabaseZap, color: '#38BDF8' },
  insights: { icon: Sparkles, color: '#FBBF24' },
};

interface Row {
  id: string;
  time: string;
  actor: string;
  action: string;
  category: ActivityCategory;
  live?: boolean;
}

/**
 * Dashboard §3c — Live Activity. Real audit rows from
 * trpc.dashboard.recentActivity (polled), plus a bounded simulated heartbeat
 * generated from live workspace stats so the stream visibly breathes.
 */
export function ActivityStream() {
  const activity = trpc.dashboard.recentActivity.useQuery(undefined, { refetchInterval: 20_000 });
  const overview = trpc.dashboard.overview.useQuery();
  const [filter, setFilter] = useState<'all' | ActivityCategory>('all');
  const [heartbeats, setHeartbeats] = useState<Row[]>([]);
  const hbId = useRef(0);

  // Simulated live feed (design §3c): a system heartbeat every 8s, content
  // derived from real workspace stats. Capped at 3 so real rows dominate.
  useEffect(() => {
    const iv = window.setInterval(() => {
      const kpis = overview.data?.kpis;
      const texts = [
        `Sync engine heartbeat — snapshot ${kpis?.snapshot?.label ?? '…'} current`,
        `Graph store healthy — ${(kpis?.totalEdges ?? 0).toLocaleString('en-US')} edges addressable`,
        `Reasoner idle — ${kpis?.openInsights ?? 0} open findings tracked`,
      ];
      const text = texts[hbId.current % texts.length];
      hbId.current += 1;
      const row: Row = {
        id: `hb-${hbId.current}`,
        time: timeHHMMSS(new Date()),
        actor: 'system',
        action: text,
        category: 'sync',
        live: true,
      };
      setHeartbeats((h) => [row, ...h].slice(0, 3));
    }, 8000);
    return () => window.clearInterval(iv);
  }, [overview.data]);

  const rows = useMemo<Row[]>(() => {
    const real: Row[] = (activity.data ?? []).map((a) => ({
      id: `a-${a.id}`,
      time: timeHHMMSS(a.createdAt),
      actor: a.actorLabel,
      action: a.action,
      category: categorizeActivity(a.entityType),
    }));
    return [...heartbeats, ...real].slice(0, 24);
  }, [activity.data, heartbeats]);

  const visible = filter === 'all' ? rows : rows.filter((r) => r.category === filter);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.22, ease: EASE }}
      className="flex h-[380px] flex-col rounded-xl border border-border-hairline bg-bg-panel"
    >
      <header className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-4">
        <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">Live Activity</h2>
        <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ok">
          <span className="relative flex size-1.5">
            <span className="absolute size-full animate-ping rounded-full bg-ok opacity-60 [animation-duration:1.6s]" />
            <span className="size-1.5 rounded-full bg-ok" />
          </span>
          Live
        </span>
        <div className="ml-auto flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11.5px] transition-colors duration-150',
                filter === f.key
                  ? 'bg-iris/15 text-text-accent ring-1 ring-iris/40'
                  : 'text-text-muted hover:bg-bg-panel-raised hover:text-text-secondary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {activity.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 rounded-lg border border-border-hairline bg-bg-panel-raised/50" />
            ))}
          </div>
        ) : activity.isError ? (
          <p className="p-5 text-[13px] text-text-muted">Activity stream unavailable.</p>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <ShieldCheck className="size-5 text-text-muted" />
            <p className="text-[13px] text-text-muted">No {filter === 'all' ? '' : filter + ' '}events yet.</p>
          </div>
        ) : (
          <ul>
            <AnimatePresence initial={false}>
              {visible.map((r, i) => {
                const meta = CATEGORY_ICON[r.category];
                const Icon = meta.icon;
                return (
                  <motion.li
                    key={r.id}
                    layout="position"
                    initial={{ opacity: 0, y: r.live ? -10 : 0 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, delay: r.live ? 0 : Math.min(i * 0.04, 0.4), ease: EASE }}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-bg-panel-raised"
                  >
                    <span className="mt-0.5 shrink-0 font-mono text-[10.5px] tabular-nums text-text-muted">{r.time}</span>
                    <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
                    <span className="min-w-0 flex-1 text-[12.5px] leading-5 text-text-secondary">
                      <span className="font-medium text-text-primary">{r.actor}</span>{' '}
                      {r.action}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </motion.section>
  );
}
