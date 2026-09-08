import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { ScanSearch, Waypoints } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { ModuleBadge } from '@/components/ui/module-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SEVERITY_COLOR, modulesForInsight, type Severity } from './utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type SevFilter = 'all' | Severity;
const SEV_FILTERS: { key: SevFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'risk', label: 'Risk' },
  { key: 'warn', label: 'Warn' },
  { key: 'info', label: 'Info' },
];

interface Evidence {
  nodeIds?: number[];
  edgeIds?: number[];
  missingEdges?: unknown[];
}

function evidenceLine(evidence: unknown): string {
  const e = (evidence ?? {}) as Evidence;
  const edges = e.edgeIds?.length ?? 0;
  const nodes = e.nodeIds?.length ?? 0;
  if (!edges && !nodes) return 'evidence: trace on demand';
  return `evidence: ${edges > 0 ? `${edges} edges` : `${nodes} nodes`}${edges > 0 && nodes > 0 ? ` · ${nodes} nodes` : ''}`;
}

/**
 * Dashboard §3d — Needs Attention. Real open insights from
 * trpc.dashboard.insightPreview with client-side severity filtering.
 */
export function InsightsPreview() {
  const navigate = useNavigate();
  const preview = trpc.dashboard.insightPreview.useQuery();
  const [sev, setSev] = useState<SevFilter>('all');

  const rows = (preview.data ?? []).filter((r) => sev === 'all' || r.severity === sev);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.28, ease: EASE }}
      className="flex h-[380px] flex-col rounded-xl border border-border-hairline bg-bg-panel"
    >
      <header className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-4">
        <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">Needs Attention</h2>
        <div className="ml-2 flex items-center gap-1">
          {SEV_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setSev(f.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11.5px] transition-colors duration-150',
                sev === f.key
                  ? 'bg-iris/15 text-text-accent ring-1 ring-iris/40'
                  : 'text-text-muted hover:bg-bg-panel-raised hover:text-text-secondary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => navigate('/app/insights')}
          className="ml-auto text-[13px] text-text-accent transition-colors hover:text-iris-bright"
        >
          Open Insights →
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
        {preview.isLoading ? (
          Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-lg border border-border-hairline bg-bg-panel-raised/50" />
          ))
        ) : preview.isError ? (
          <p className="py-6 text-[13px] text-text-muted">Insight feed unavailable.</p>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <ScanSearch className="size-5 text-text-muted" />
            <p className="text-[13px] text-text-muted">
              {sev === 'all' ? 'No open insights — the graph is quiet.' : `No ${sev} insights right now.`}
            </p>
          </div>
        ) : (
          rows.map((ins, i) => {
            const severity = ins.severity as Severity;
            const color = SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.info;
            const mods = modulesForInsight(ins.ruleId, ins.title);
            return (
              <motion.article
                key={ins.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.1, ease: EASE }}
                className="relative flex gap-3.5 overflow-hidden rounded-lg border border-border-hairline bg-bg-inset p-3.5 transition-colors duration-150 hover:border-border-glow"
              >
                <motion.span
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.4, delay: i * 0.1, ease: EASE }}
                  className="w-1 origin-top self-stretch rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[13.5px] font-medium leading-5 text-text-primary">{ins.title}</h3>
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                      style={{ color, backgroundColor: `${color}26`, border: `1px solid ${color}4d` }}
                    >
                      {severity}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {mods.map((m) => (
                      <ModuleBadge key={m} module={m} />
                    ))}
                    <span className="ml-1 font-mono text-[10.5px] text-text-muted">{evidenceLine(ins.evidenceJson)}</span>
                  </div>
                  <div className="mt-2.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/app/insights?insight=${ins.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-hairline px-2 py-1 font-mono text-[11px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-accent"
                    >
                      <Waypoints className="size-3" />
                      Trace
                    </button>
                  </div>
                </div>
              </motion.article>
            );
          })
        )}
      </div>
    </motion.section>
  );
}
