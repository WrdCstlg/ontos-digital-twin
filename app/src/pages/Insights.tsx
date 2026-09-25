import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Play, Plus, Sparkles } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { LOGIN_PATH } from '@/const';
import { cn } from '@/lib/utils';
import { MODULES, type ModuleKey } from '@/lib/modules';
import { ModuleBadge } from '@/components/ui/module-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NarrativeCard } from '@/components/insights/NarrativeCard';
import { InsightCard } from '@/components/insights/InsightCard';
import { TraceDrawer, type TraceTarget } from '@/components/insights/TraceDrawer';
import { AnalyticsPanel } from '@/components/insights/AnalyticsPanel';
import type { InsightRow } from '@/components/insights/types';
import {
  RULE_META,
  SEVERITY_ORDER,
  SEVERITY_COLOR,
  insightModules,
  resolveInstanceIri,
  type Severity,
} from '@/components/insights/ruleMeta';

type DateRange = 7 | 30 | 90 | 0;
const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 7, label: 'last 7 days' },
  { value: 30, label: 'last 30 days' },
  { value: 90, label: 'last 90 days' },
  { value: 0, label: 'all time' },
];

function isAuthError(err: unknown): boolean {
  const code = (err as { data?: { code?: string } } | null)?.data?.code;
  return code === 'UNAUTHORIZED' || code === 'FORBIDDEN';
}

export default function Insights() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const utils = trpc.useUtils();

  const list = trpc.insights.list.useQuery({ limit: 100 }, { staleTime: 30_000, retry: 1 });
  const stats = trpc.graph.stats.useQuery(undefined, { staleTime: 60_000 });

  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [moduleFilter, setModuleFilter] = useState<Set<ModuleKey>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>(30);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [pendingAck, setPendingAck] = useState<Set<number>>(new Set());
  const ackTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [trace, setTrace] = useState<TraceTarget | null>(null);
  const [watch, setWatch] = useState<InsightRow | null>(null);
  const [watchRule, setWatchRule] = useState('control-without-evidence-90d');
  const [watchSchedule, setWatchSchedule] = useState('daily');
  const [watchSeverity, setWatchSeverity] = useState<Severity>('warn');
  const [scanning, setScanning] = useState(false);
  const narrativeRef = useRef<HTMLDivElement>(null);

  const anomalies = useMemo(
    () => ((list.data ?? []) as InsightRow[]).filter((i) => i.type === 'anomaly'),
    [list.data],
  );

  // date filter
  const [now] = useState(() => Date.now()); // stable reference instant for range filtering
  const inRange = useMemo(() => {
    if (dateRange === 0) return anomalies;
    const cutoff = now - dateRange * 24 * 3600 * 1000;
    return anomalies.filter((i) => new Date(i.createdAt).getTime() >= cutoff);
  }, [anomalies, dateRange, now]);

  // module filter
  const moduleFiltered = useMemo(() => {
    if (moduleFilter.size === 0) return inRange;
    return inRange.filter((i) => insightModules(i).some((m) => moduleFilter.has(m)));
  }, [inRange, moduleFilter]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { risk: 0, warn: 0, info: 0 };
    for (const i of moduleFiltered) c[i.severity] += 1;
    return c;
  }, [moduleFiltered]);

  const feed = useMemo(() => {
    const visible = moduleFiltered.filter(
      (i) => (severity === 'all' || i.severity === severity) && !pendingAck.has(i.id),
    );
    const order = (s: Severity) => SEVERITY_ORDER.indexOf(s);
    return [...visible].sort((a, b) => order(a.severity) - order(b.severity) || b.id - a.id);
  }, [moduleFiltered, severity, pendingAck]);

  const openCount = anomalies.filter((i) => i.status === 'open').length;
  const ackCount = anomalies.filter((i) => i.status === 'acknowledged').length;

  // Hub IRI for analytics + grounding: first risk finding's evidence node
  const hubIri = useMemo(() => {
    const sorted = [...anomalies].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const i of sorted) {
      const iri = resolveInstanceIri(i.evidenceJson, i.summary, i.title);
      if (iri) return iri;
    }
    return null;
  }, [anomalies]);

  /* ── mutations ─────────────────────────────────────────────── */

  const reportMutationError = (err: unknown, fallback: string) => {
    if (isAuthError(err)) {
      toast.error('This action requires sign-in', {
        action: { label: 'Sign in', onClick: () => navigate(LOGIN_PATH) },
      });
    } else {
      toast.error(fallback, { description: err instanceof Error ? err.message : undefined });
    }
  };

  const ackMutation = trpc.insights.acknowledge.useMutation({
    onSuccess: (_data, vars) => {
      setPendingAck((s) => {
        const next = new Set(s);
        next.delete(vars.id);
        return next;
      });
      void utils.insights.list.invalidate();
    },
    onError: (err, vars) => {
      setPendingAck((s) => {
        const next = new Set(s);
        next.delete(vars.id);
        return next;
      });
      reportMutationError(err, 'Could not acknowledge the insight');
    },
  });

  const acknowledge = (insight: InsightRow) => {
    setPendingAck((s) => new Set(s).add(insight.id));
    const timer = setTimeout(() => {
      ackTimers.current.delete(insight.id);
      ackMutation.mutate({ id: insight.id });
    }, 5000);
    ackTimers.current.set(insight.id, timer);
    toast('Marked as resolved', {
      description: insight.title,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(ackTimers.current.get(insight.id));
          ackTimers.current.delete(insight.id);
          setPendingAck((s) => {
            const next = new Set(s);
            next.delete(insight.id);
            return next;
          });
        },
      },
    });
  };

  const scanMutation = trpc.insights.runScan.useMutation({
    onSuccess: (res) => {
      const created = res.findings.filter((f) => f.status === 'created').map((f) => f.insightId);
      const updated = res.findings.filter((f) => f.status === 'updated').map((f) => f.insightId);
      setNewIds((s) => new Set([...s, ...created, ...updated]));
      void utils.insights.list.invalidate();
      toast.success(
        `Scan complete — ${res.findings.length} rules fired over ${res.scanned.nodes} nodes / ${res.scanned.edges} edges`,
      );
    },
    onError: (err) => reportMutationError(err, 'The insight engine scan failed'),
    onSettled: () => setTimeout(() => setScanning(false), 1200),
  });

  const runScan = () => {
    setScanning(true);
    scanMutation.mutate();
  };

  /* ── deep link ?insight=<id> (adjust-during-render once data arrives) ── */
  const deepLinkId = Number(params.get('insight')) || null;
  const [handledDeepLink, setHandledDeepLink] = useState<number | null>(null);
  if (deepLinkId && handledDeepLink !== deepLinkId && list.data) {
    const found = (list.data as InsightRow[]).find((i) => i.id === deepLinkId);
    if (found) {
      setHandledDeepLink(deepLinkId);
      setTrace({ kind: 'insight', insight: found });
    }
  }

  const openTrace = (insight: InsightRow) => {
    setNewIds((s) => {
      const next = new Set(s);
      next.delete(insight.id);
      return next;
    });
    setTrace({ kind: 'insight', insight });
  };

  const toggleModule = (k: ModuleKey) =>
    setModuleFilter((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8 lg:px-8">
      <Toaster position="bottom-right" theme="dark" />

      {/* ── Header ─────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
              Insights
            </h1>
            <p className="mt-1 text-[15px] text-text-secondary">
              Patterns the graph found — every one traceable to evidence.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runScan}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3.5 py-2 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
            >
              <Play className="size-3.5" /> {scanning ? 'Engine running…' : 'Run engine now'}
            </button>
            <button
              type="button"
              onClick={() => narrativeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3.5 py-2 text-[13px] font-medium text-white transition-all hover:from-iris hover:to-iris-bright"
            >
              <Sparkles className="size-3.5" /> Narrative: weekly brief
            </button>
          </div>
        </div>

        {/* KPI mini-strip */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[12px] text-text-muted">
          <span>
            <span className="text-text-primary">{openCount}</span> open
          </span>
          <span aria-hidden className="text-border-glow">·</span>
          <span>
            <span className="text-text-primary">{ackCount}</span> acknowledged
          </span>
          <span aria-hidden className="text-border-glow">·</span>
          <span>
            mean time-to-evidence <span className="text-text-primary">1 click</span>
          </span>
          {stats.data?.snapshot && (
            <>
              <span aria-hidden className="text-border-glow">·</span>
              <span>
                snapshot <span className="text-text-primary">{stats.data.snapshot.label}</span>
              </span>
            </>
          )}
        </div>

        {/* Controls row */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="Severity filter">
            <button
              type="button"
              onClick={() => setSeverity('all')}
              className={cn(
                'rounded-full border px-3 py-1 font-mono text-[11.5px] transition-colors',
                severity === 'all'
                  ? 'border-iris/50 bg-iris/15 text-text-accent'
                  : 'border-border-hairline text-text-muted hover:text-text-secondary',
              )}
            >
              All {moduleFiltered.length}
            </button>
            {SEVERITY_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(severity === s ? 'all' : s)}
                className={cn(
                  'rounded-full border px-3 py-1 font-mono text-[11.5px] transition-colors',
                  severity === s ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
                )}
                style={
                  severity === s
                    ? { borderColor: `${SEVERITY_COLOR[s]}80`, backgroundColor: `${SEVERITY_COLOR[s]}26` }
                    : { borderColor: '#1E293B' }
                }
              >
                {s[0].toUpperCase() + s.slice(1)} {counts[s]}
              </button>
            ))}
          </div>

          <span className="hidden h-4 w-px bg-border-hairline sm:block" aria-hidden />

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Module filter">
            {MODULES.map((m) => {
              const on = moduleFilter.has(m.key);
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleModule(m.key)}
                  aria-pressed={on}
                  className={cn('transition-all', !on && moduleFilter.size > 0 && 'opacity-35 grayscale')}
                >
                  <ModuleBadge module={m.key} />
                </button>
              );
            })}
          </div>

          <span className="hidden h-4 w-px bg-border-hairline sm:block" aria-hidden />

          <div className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-text-muted" />
            <Select value={String(dateRange)} onValueChange={(v) => setDateRange(Number(v) as DateRange)}>
              <SelectTrigger className="h-8 w-[136px] border-border-hairline bg-bg-inset font-mono text-[11.5px] text-text-secondary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGES.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)} className="font-mono text-[12px]">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </motion.header>

      {/* ── Narrative ──────────────────────────────────────── */}
      <div ref={narrativeRef} className="mt-6 scroll-mt-20">
        <NarrativeCard
          onViewGrounding={() =>
            setTrace({ kind: 'grounding', centerIri: hubIri, snapshot: stats.data?.snapshot?.label ?? null })
          }
        />
      </div>

      {/* ── Feed ───────────────────────────────────────────── */}
      <section className="relative mt-6" aria-label="Insight feed">
        {/* indeterminate scan progress across the panel top */}
        <AnimatePresence>
          {scanning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute -top-3 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-bg-panel-raised"
            >
              <motion.div
                className="h-full w-1/3 rounded-full bg-gradient-to-r from-iris-deep via-iris-bright to-iris"
                initial={{ x: '-100%' }}
                animate={{ x: '300%' }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {list.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full rounded-xl" />
            ))}
          </div>
        ) : list.isError ? (
          <div className="rounded-xl border border-border-hairline bg-bg-panel p-8 text-center">
            <p className="text-[14px] text-text-secondary">The insight feed could not be loaded.</p>
            <button
              type="button"
              onClick={() => void list.refetch()}
              className="mt-3 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
            >
              Retry
            </button>
          </div>
        ) : feed.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border-hairline bg-bg-panel/50 px-6 py-14 text-center">
            <motion.span
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="flex size-16 items-center justify-center rounded-full border border-dashed border-border-glow"
              aria-hidden
            >
              <Plus className="size-5 text-text-muted" />
            </motion.span>
            <p className="mt-4 text-[14px] text-text-secondary">No findings match the current filters.</p>
            <p className="mt-1 font-mono text-[11.5px] text-text-muted">
              {anomalies.length === 0 ? 'the engine has not fired yet on this workspace' : 'loosen severity, module, or date filters'}
            </p>
            <button
              type="button"
              onClick={runScan}
              disabled={scanning}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/15 px-3.5 py-2 text-[13px] font-medium text-text-accent transition-colors hover:bg-iris/25 disabled:opacity-50"
            >
              <Play className="size-3.5" /> Run engine now
            </button>
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <AnimatePresence>
              {feed.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  isNew={newIds.has(insight.id)}
                  onTrace={openTrace}
                  onAcknowledge={acknowledge}
                  onWatch={(row) => {
                    setWatch(row);
                    setWatchRule(row.ruleId ?? 'control-without-evidence-90d');
                    setWatchSeverity(row.severity);
                  }}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* ── Analytics ──────────────────────────────────────── */}
      <div className="mt-6">
        <AnalyticsPanel hubIri={hubIri} />
      </div>

      {/* ── Trace drawer ───────────────────────────────────── */}
      <TraceDrawer target={trace} onClose={() => setTrace(null)} onAcknowledge={acknowledge} />

      {/* ── Watch rule dialog ──────────────────────────────── */}
      <Dialog open={watch !== null} onOpenChange={(o) => !o && setWatch(null)}>
        <DialogContent className="border-border-hairline bg-bg-panel sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-text-primary">Create watch rule</DialogTitle>
            <DialogDescription className="text-text-secondary">
              Re-run this rule on a schedule and raise a finding whenever it fires again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Rule template
              </span>
              <Select value={watchRule} onValueChange={setWatchRule}>
                <SelectTrigger className="w-full border-border-hairline bg-bg-inset font-mono text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(RULE_META).map((r) => (
                    <SelectItem key={r} value={r} className="font-mono text-[12px]">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  Schedule
                </span>
                <Select value={watchSchedule} onValueChange={setWatchSchedule}>
                  <SelectTrigger className="w-full border-border-hairline bg-bg-inset font-mono text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['hourly', 'daily', 'weekly'].map((s) => (
                      <SelectItem key={s} value={s} className="font-mono text-[12px]">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  Severity
                </span>
                <Select value={watchSeverity} onValueChange={(v) => setWatchSeverity(v as Severity)}>
                  <SelectTrigger className="w-full border-border-hairline bg-bg-inset font-mono text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_ORDER.map((s) => (
                      <SelectItem key={s} value={s} className="font-mono text-[12px]">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                toast.success(`Watching: ${watchRule}`, {
                  description: `${watchSchedule} · severity ${watchSeverity} — demo build does not persist watch rules`,
                });
                setWatch(null);
              }}
              className="rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3.5 py-2 text-[13px] font-medium text-white transition-all hover:from-iris hover:to-iris-bright"
            >
              Start watching
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
