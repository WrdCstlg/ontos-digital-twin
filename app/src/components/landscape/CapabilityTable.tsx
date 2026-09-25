import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Capability, CapabilityStatus } from '@/lib/landscape';
import { CAPABILITY_STATUS_ORDER, CAPABILITY_STYLE, capabilityStatusText } from './meta';

function StatusChip({ capability, labels }: { capability: Capability; labels: Record<CapabilityStatus, string> }) {
  const st = CAPABILITY_STYLE[capability.status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium',
        st.chip,
      )}
    >
      <st.icon className="size-3" aria-hidden />
      {capabilityStatusText(capability, labels)}
    </span>
  );
}

export interface CapabilityTableProps {
  capabilities: Capability[];
  labels: Record<CapabilityStatus, string>;
}

/**
 * Capabilities next to Palantir Foundry's: counts per status (click to
 * filter), a text filter over area / Foundry / Ontos, and the rows — a table
 * on wide screens, cards on narrow ones.
 */
export function CapabilityTable({ capabilities, labels }: CapabilityTableProps) {
  const [status, setStatus] = useState<CapabilityStatus | 'all'>('all');
  const [query, setQuery] = useState('');

  const statuses = useMemo(
    () => [
      ...CAPABILITY_STATUS_ORDER.filter((s) => s in labels),
      ...(Object.keys(labels) as CapabilityStatus[]).filter((s) => !CAPABILITY_STATUS_ORDER.includes(s)),
    ],
    [labels],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<CapabilityStatus, number>;
    for (const cap of capabilities) c[cap.status] = (c[cap.status] ?? 0) + 1;
    return c;
  }, [capabilities, statuses]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return capabilities.filter(
      (c) =>
        (status === 'all' || c.status === status) &&
        (!q || `${c.area} ${c.palantir} ${c.ontos}`.toLowerCase().includes(q)),
    );
  }, [capabilities, status, query]);

  const total = capabilities.length;

  return (
    <div className="space-y-4">
      {/* distribution bar */}
      <div className="flex h-2 overflow-hidden rounded-full bg-bg-inset" aria-hidden>
        {statuses.map((s) =>
          counts[s] > 0 ? (
            <motion.span
              key={s}
              initial={{ width: 0 }}
              animate={{ width: `${(counts[s] / Math.max(1, total)) * 100}%` }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className={cn('h-full', CAPABILITY_STYLE[s].bar, status !== 'all' && status !== s && 'opacity-30')}
            />
          ) : null,
        )}
      </div>

      {/* counts (filters) + text filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
          <button
            type="button"
            onClick={() => setStatus('all')}
            aria-pressed={status === 'all'}
            className={cn(
              'rounded-full border px-3 py-1 font-mono text-[11.5px] transition-colors',
              status === 'all'
                ? 'border-iris/50 bg-iris/15 text-text-accent'
                : 'border-border-hairline text-text-muted hover:text-text-secondary',
            )}
          >
            All {total}
          </button>
          {statuses.map((s) => {
            const st = CAPABILITY_STYLE[s];
            const on = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(on ? 'all' : s)}
                aria-pressed={on}
                disabled={counts[s] === 0}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11.5px] transition-colors disabled:opacity-40',
                  on ? st.pill : 'border-border-hairline text-text-muted hover:text-text-secondary',
                )}
              >
                <span className={cn('size-1.5 rounded-full', st.bar)} aria-hidden />
                {labels[s]} <span className={on ? '' : 'text-text-secondary'}>{counts[s]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-1.5 transition-colors focus-within:border-iris sm:ml-auto sm:max-w-72">
          <Search className="size-3.5 shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter area, Foundry, Ontos…"
            aria-label="Filter capabilities"
            className="w-full bg-transparent font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear filter" className="text-text-muted hover:text-text-primary">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-hairline bg-bg-panel/50 px-6 py-10 text-center">
          <p className="text-[14px] text-text-secondary">No capability matches the current filters.</p>
          <button
            type="button"
            onClick={() => {
              setStatus('all');
              setQuery('');
            }}
            className="mt-2 font-mono text-[11.5px] text-text-accent hover:underline"
          >
            clear filters
          </button>
        </div>
      ) : (
        <>
          {/* wide: table */}
          <div className="hidden overflow-hidden rounded-xl border border-border-hairline md:block">
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col className="w-[17%]" />
                <col className="w-[33%]" />
                <col className="w-[33%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border-hairline bg-bg-panel">
                  {['Area', 'Palantir Foundry', 'Ontos', 'Status'].map((h) => (
                    <th key={h} className="px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <motion.tr
                    key={c.area}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="border-b border-border-hairline/60 align-top transition-colors last:border-0 hover:bg-bg-panel-raised/50"
                    data-testid="capability-row"
                  >
                    <td className={cn('border-l-2 px-3.5 py-3 text-[13px] font-medium text-text-primary', CAPABILITY_STYLE[c.status].accent)}>
                      {c.area}
                    </td>
                    <td className="px-3.5 py-3 text-[12.5px] leading-[1.55] text-text-secondary">{c.palantir}</td>
                    <td className="px-3.5 py-3 text-[12.5px] leading-[1.55] text-text-primary">{c.ontos}</td>
                    <td className="px-3.5 py-3">
                      <StatusChip capability={c} labels={labels} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* narrow: cards */}
          <ul className="space-y-3 md:hidden">
            {rows.map((c) => (
              <li
                key={c.area}
                className={cn('rounded-xl border border-l-2 border-border-hairline bg-bg-panel p-4', CAPABILITY_STYLE[c.status].accent)}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-[14px] font-medium text-text-primary">{c.area}</h3>
                  <StatusChip capability={c} labels={labels} />
                </div>
                <div className="mt-3 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Palantir Foundry</div>
                <p className="mt-0.5 text-[13px] leading-[1.55] text-text-secondary">{c.palantir}</p>
                <div className="mt-2.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Ontos</div>
                <p className="mt-0.5 text-[13px] leading-[1.55] text-text-primary">{c.ontos}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="font-mono text-[10.5px] text-text-muted">
        {rows.length} of {total} areas shown
      </p>
    </div>
  );
}
