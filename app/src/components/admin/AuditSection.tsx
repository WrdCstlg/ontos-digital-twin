import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCheck, ChevronDown, Download, Link2, Loader2, ShieldX } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { IRIChip } from '@/components/ui/iri-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AuditEntryRow } from '@/components/insights/types';
import { formatTimestamp } from '@/components/insights/ruleMeta';

type Category = 'ONTOLOGY' | 'MAPPING' | 'SYNC' | 'ACCESS' | 'AUTH' | 'INSIGHT' | 'SYSTEM';

const CATEGORY_STYLE: Record<Category, { color: string }> = {
  ONTOLOGY: { color: '#818CF8' },
  MAPPING: { color: '#A78BFA' },
  SYNC: { color: '#38BDF8' },
  ACCESS: { color: '#34D399' },
  AUTH: { color: '#94A3B8' },
  INSIGHT: { color: '#FBBF24' },
  SYSTEM: { color: '#64748B' },
};

function categoryOf(entityType: string): Category {
  if (entityType.startsWith('ontology') || entityType === 'reasoner_run') return 'ONTOLOGY';
  if (entityType === 'mapping' || entityType === 'connector') return 'MAPPING';
  if (entityType === 'sync_job') return 'SYNC';
  if (entityType === 'workspace_member' || entityType === 'workspace') return 'ACCESS';
  if (entityType === 'auth' || entityType === 'session') return 'AUTH';
  if (entityType.startsWith('insight')) return 'INSIGHT';
  return 'SYSTEM';
}

const FILTER_CHIPS: (Category | 'ALL')[] = ['ALL', 'ONTOLOGY', 'MAPPING', 'SYNC', 'ACCESS', 'AUTH', 'INSIGHT'];

function toCsv(entries: AuditEntryRow[]): string {
  const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'id,timestamp,actor,type,action,entity,hash,prev_hash';
  const rows = entries.map((e) =>
    [e.id, formatTimestamp(e.createdAt), e.actorLabel, categoryOf(e.entityType), e.action, e.entityId, e.hash, e.prevHash]
      .map(esc)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

/**
 * AuditSection — the hash-chained, append-only audit log viewer with
 * cursor pagination, expandable payloads, chain integrity badge, and CSV
 * export. Data: admin.listAudit.
 */
export function AuditSection() {
  const audit = trpc.admin.listAudit.useInfiniteQuery(
    { limit: 30 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<Category | 'ALL'>('ALL');
  const [days, setDays] = useState<number>(0); // 0 = all
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [now] = useState(() => Date.now()); // stable reference instant for date filtering

  const allEntries = useMemo(
    () => (audit.data?.pages ?? []).flatMap((p) => p.entries as AuditEntryRow[]),
    [audit.data],
  );
  const chainValid = audit.data?.pages[0]?.chainValid;

  const entries = useMemo(() => {
    let rows = allEntries;
    if (typeFilter !== 'ALL') rows = rows.filter((e) => categoryOf(e.entityType) === typeFilter);
    if (days > 0) {
      const cutoff = now - days * 24 * 3600 * 1000;
      rows = rows.filter((e) => new Date(e.createdAt).getTime() >= cutoff);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (e) =>
          e.actorLabel.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          (e.entityId ?? '').toLowerCase().includes(q) ||
          e.hash.startsWith(q),
      );
    }
    return rows;
  }, [allEntries, typeFilter, days, search, now]);

  const exportCsv = useCallback(() => {
    if (entries.length === 0) {
      toast.warning('Nothing to export — the current filter matches no entries');
      return;
    }
    const blob = new Blob([toCsv(entries)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ontos-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${entries.length} audit entries`);
  }, [entries]);

  // header "Export audit log (CSV)" button dispatches this event
  useEffect(() => {
    const handler = () => exportCsv();
    window.addEventListener('ontos:export-audit', handler);
    return () => window.removeEventListener('ontos:export-audit', handler);
  }, [exportCsv]);

  return (
    <div>
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-accent">Immutable record</span>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">Audit Log</h2>
        {chainValid !== undefined && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px]',
                    chainValid ? 'border-ok/40 bg-ok/10 text-ok' : 'border-risk/40 bg-risk/10 text-risk',
                  )}
                >
                  {chainValid ? <CheckCheck className="size-3" /> : <ShieldX className="size-3" />}
                  {chainValid ? 'chain verified' : 'chain broken'}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 border-border-hairline bg-bg-panel-raised text-[12px] text-text-secondary">
                Each entry hashes the previous — tamper-evident.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <p className="mt-1 max-w-[640px] text-[13px] leading-[1.5] text-text-secondary">
        Every ontology change, mapping change, sync, permission change, and login — append-only, exportable.
      </p>

      {/* Toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="actor, action, entity…"
          className="w-56 rounded-lg border border-border-hairline bg-bg-inset px-3 py-1.5 font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted focus:border-border-glow"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setTypeFilter(c)}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10.5px] tracking-[0.04em] transition-colors',
                typeFilter === c
                  ? 'border-iris/50 bg-iris/15 text-text-accent'
                  : 'border-border-hairline text-text-muted hover:text-text-secondary',
              )}
            >
              {c === 'ALL' ? 'All' : c[0] + c.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-[128px] border-border-hairline bg-bg-inset font-mono text-[11.5px] text-text-secondary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              [7, 'last 7 days'],
              [30, 'last 30 days'],
              [90, 'last 90 days'],
              [0, 'all time'],
            ].map(([v, l]) => (
              <SelectItem key={v} value={String(v)} className="font-mono text-[12px]">
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={exportCsv}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
        >
          <Download className="size-3.5" /> Export CSV
        </button>
      </div>

      {/* Log table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-border-hairline">
        {audit.isLoading ? (
          <div className="space-y-1.5 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : audit.isError ? (
          <div className="p-8 text-center text-[13px] text-text-muted">
            The audit log could not be loaded.{' '}
            <button type="button" onClick={() => void audit.refetch()} className="text-text-accent hover:underline">
              Retry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-[14px] text-text-secondary">No audit entries match the current filters.</p>
            <p className="mt-1 font-mono text-[11.5px] text-text-muted">
              {allEntries.length === 0 ? 'the log is empty for this workspace' : 'loosen the search, type, or date filters'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-hairline bg-bg-panel">
                {['Timestamp', 'Actor', 'Type', 'Action', 'Entity', 'Hash'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const cat = categoryOf(e.entityType);
                const color = CATEGORY_STYLE[cat].color;
                const expanded = expandedId === e.id;
                return [
                  <motion.tr
                    key={`row-${e.id}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, delay: Math.min(i, 12) * 0.03 }}
                    onClick={() => setExpandedId(expanded ? null : e.id)}
                    className={cn(
                      'cursor-pointer border-b border-border-hairline/60 transition-colors hover:bg-bg-panel-raised/50',
                      expanded && 'bg-bg-panel-raised/40',
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11.5px] text-text-muted">
                      <ChevronDown
                        className={cn(
                          'mr-1.5 inline size-3 text-text-muted transition-transform duration-200',
                          expanded && 'rotate-180',
                        )}
                      />
                      {formatTimestamp(e.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-[12.5px] text-text-secondary">{e.actorLabel}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className="rounded-md px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em]"
                        style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}40` }}
                      >
                        {cat}
                      </span>
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-1.5 text-[12.5px] text-text-primary">{e.action}</td>
                    <td className="max-w-[200px] truncate px-3 py-1.5">
                      {e.entityId ? (
                        e.entityId.includes(':') ? (
                          <IRIChip iri={e.entityId} />
                        ) : (
                          <span className="font-mono text-[11.5px] text-text-secondary">{e.entityId}</span>
                        )
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-text-muted">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-default items-center gap-1">
                              <Link2 className="size-3 text-slate-500" />
                              {e.hash.slice(0, 8)}…
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64 border-border-hairline bg-bg-panel-raised font-mono text-[11px] text-text-secondary">
                            sha256: {e.hash}
                            <br />
                            prev: {e.prevHash ?? '∅ (genesis)'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </td>
                  </motion.tr>,
                  expanded && (
                    <tr key={`detail-${e.id}`} className="border-b border-border-hairline/60">
                      <td colSpan={6} className="bg-bg-inset/60 px-3 py-2">
                        <motion.pre
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-x-auto rounded-lg border border-border-hairline bg-bg-inset p-3 font-mono text-[11.5px] leading-[1.5] text-text-secondary"
                        >
                          {JSON.stringify(e.payloadJson ?? {}, null, 2)}
                        </motion.pre>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}

        {/* pagination */}
        {audit.hasNextPage && (
          <div className="border-t border-border-hairline p-3 text-center">
            <button
              type="button"
              onClick={() => void audit.fetchNextPage()}
              disabled={audit.isFetchingNextPage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3.5 py-1.5 font-mono text-[12px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
            >
              {audit.isFetchingNextPage && <Loader2 className="size-3.5 animate-spin" />}
              Load older
            </button>
          </div>
        )}
      </div>

      <p className="mt-3 font-mono text-[10.5px] text-text-muted">
        {entries.length} of {allEntries.length} loaded entries shown · cursor pagination · append-only
      </p>
    </div>
  );
}

export default AuditSection;
