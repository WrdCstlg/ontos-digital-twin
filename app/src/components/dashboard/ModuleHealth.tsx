import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { ModuleBadge } from '@/components/ui/module-badge';
import { StatusDot, type StatusKind } from '@/components/ui/status-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { getModule, type ModuleKey } from '@/lib/modules';
import { formatInt, hashString, makeMiniSpark } from './utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function MiniSpark({ points, color }: { points: number[]; color: string }) {
  const w = 56;
  const h = 20;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const line = points.map((p, i) => `${(i * step).toFixed(1)},${(h - 2 - ((p - min) / range) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-5 w-14" preserveAspectRatio="none" aria-hidden>
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function statusOf(status: string): { kind: StatusKind; label: string } {
  switch (status) {
    case 'active':
      return { kind: 'ok', label: 'Synced' };
    case 'validating':
      return { kind: 'info', label: 'Validating…' };
    case 'draft':
      return { kind: 'idle', label: 'Draft' };
    default:
      return { kind: 'warn', label: status };
  }
}

/**
 * Dashboard §3b — Module Health. Real rows from trpc.dashboard.moduleHealth;
 * cross-module edge count from trpc.graph.stats.
 */
export function ModuleHealth() {
  const navigate = useNavigate();
  const health = trpc.dashboard.moduleHealth.useQuery();
  const stats = trpc.graph.stats.useQuery();
  const crossEdges = stats.data?.byModule?.cross?.edges ?? null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.16, ease: EASE }}
      className="flex h-[420px] flex-col rounded-xl border border-border-hairline bg-bg-panel"
    >
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">Module Health</h2>
        <button
          type="button"
          onClick={() => navigate('/app/library')}
          className="text-[13px] text-text-accent transition-colors hover:text-iris-bright"
        >
          Open Library →
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {health.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg border border-border-hairline bg-bg-panel-raised/50" />
            ))}
          </div>
        ) : health.isError ? (
          <p className="p-5 text-[13px] text-text-muted">Module health unavailable{health.error ? `: ${health.error.message}` : '.'}</p>
        ) : (
          <ul>
            {(health.data ?? []).map((m, i) => {
              const mod = getModule((m.key as ModuleKey) ?? 'custom');
              const st = statusOf(m.status);
              return (
                <motion.li
                  key={m.key}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 + i * 0.06, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => navigate(mod.route)}
                    className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-bg-panel-raised"
                  >
                    <ModuleBadge module={mod.key} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-text-primary">{m.name}</span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="rounded-md border border-border-hairline bg-bg-inset px-1.5 py-0 font-mono text-[10.5px] text-text-secondary">
                          v{m.version}
                        </span>
                        <span className="font-mono text-[11px] text-text-muted">
                          {formatInt(m.instances)} inst · {formatInt(m.edges)} edges
                        </span>
                      </span>
                    </span>
                    <MiniSpark points={makeMiniSpark(hashString(m.key), m.instances)} color={mod.color} />
                    <span className="flex w-24 items-center gap-1.5 text-[12px] text-text-secondary">
                      <StatusDot status={st.kind} pulse={st.kind !== 'idle'} />
                      <span className="truncate">{st.label}</span>
                    </span>
                    <ChevronRight className="size-4 -translate-x-1 text-text-muted opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100" />
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-border-hairline px-5 py-3">
        <span className="text-[12px] text-text-muted">Cross-module edges: </span>
        <span className="font-mono text-[12px] text-text-accent">{crossEdges != null ? formatInt(crossEdges) : '…'} active</span>
      </footer>
    </motion.section>
  );
}
