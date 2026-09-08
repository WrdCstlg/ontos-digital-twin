import { useMemo, useState, type ReactNode } from 'react';
import { LayoutGrid, List, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { IRIChip } from '@/components/ui/iri-chip';
import { StatusDot } from '@/components/ui/status-dot';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TwinCard } from './TwinCard';
import {
  classLabel,
  classMeta,
  fmtValue,
  statusKind,
  statusLabel,
  type TwinGroup,
  type TwinSummary,
} from './meta';

type GroupBy = 'model' | 'status' | 'zone';
type View = 'grid' | 'list';

export interface TwinRegistryProps {
  groups: TwinGroup[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  search: string;
  onSearchChange: (q: string) => void;
  tickId: number;
  /** iri → changed telemetry keys on the last tick (already viewport-capped) */
  changedByTwin: Map<string, Set<string>>;
  onSelect: (iri: string) => void;
}

function Pill({
  active,
  onClick,
  children,
  teal,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  teal?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 font-mono text-[10.5px] transition-colors duration-150',
        active
          ? teal
            ? 'border-module-twin/40 bg-module-twin/15 text-module-twin'
            : 'border-border-glow bg-bg-panel-raised text-text-primary'
          : 'border-border-hairline text-text-muted hover:border-border-glow hover:text-text-secondary',
      )}
    >
      {children}
    </button>
  );
}

function toggle(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

interface Row {
  twin: TwinSummary;
  group: string;
}

/**
 * TwinRegistry — toolbar (search / model & status pills / group-by / view
 * toggle) + grouped card grid or dense list. All data from tRPC listTwins.
 */
export function TwinRegistry({
  groups,
  loading,
  error,
  onRetry,
  search,
  onSearchChange,
  tickId,
  changedByTwin,
  onSelect,
}: TwinRegistryProps) {
  const [classFilter, setClassFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>('model');
  const [view, setView] = useState<View>('grid');

  const allTwins = useMemo(() => groups.flatMap((g) => g.twins), [groups]);
  const statuses = useMemo(
    () => [...new Set(allTwins.map((t) => t.state.status ?? 'unknown'))].sort(),
    [allTwins],
  );

  const filtered = useMemo(() => {
    return allTwins.filter((t) => {
      if (classFilter.size && !classFilter.has(t.classIri)) return false;
      if (statusFilter.size && !statusFilter.has(t.state.status ?? 'unknown')) return false;
      return true;
    });
  }, [allTwins, classFilter, statusFilter]);

  const regrouped = useMemo(() => {
    const key = (t: TwinSummary): string => {
      if (groupBy === 'status') return t.state.status ?? 'unknown';
      if (groupBy === 'zone') return t.state.zoneType ?? (t.classIri === 'dtwin:ZoneTwin' ? 'other' : '—');
      return t.classIri;
    };
    const map = new Map<string, TwinSummary[]>();
    for (const t of filtered) {
      const k = key(t);
      const arr = map.get(k) ?? [];
      arr.push(t);
      map.set(k, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  const degraded = allTwins.filter((t) => statusKind(t.state.status) === 'warn').length;
  const hasFilters = classFilter.size > 0 || statusFilter.size > 0 || search.trim().length > 0;

  const groupHeading = (key: string) =>
    groupBy === 'model' ? classLabel(key) : groupBy === 'status' ? statusLabel(key) : key === '—' ? 'no zone' : `${key} zones`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Section 2 — toolbar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.1 }}
        className="flex flex-wrap items-center gap-2 border-b border-border-hairline px-1 pb-3"
      >
        {/* search — teal focus ring (per-page module accent override) */}
        <div className="flex h-9 w-80 max-w-full items-center gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 transition-colors focus-within:border-module-twin/50 focus-within:ring-2 focus-within:ring-module-twin/25">
          <Search className="size-3.5 shrink-0 text-text-muted" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search twins, IRIs, locations…"
            className="w-full bg-transparent font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted"
          />
          {search && (
            <button type="button" onClick={() => onSearchChange('')} aria-label="Clear search" className="text-text-muted hover:text-text-primary">
              <X className="size-3" />
            </button>
          )}
        </div>

        {/* model pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {groups.map((g) => {
            const Icon = classMeta(g.classIri).icon;
            return (
              <Pill
                key={g.classIri}
                teal
                active={classFilter.has(g.classIri)}
                onClick={() => setClassFilter((s) => toggle(s, g.classIri))}
              >
                <span className="inline-flex items-center gap-1">
                  <Icon className="size-3" /> {classLabel(g.classIri)}
                </span>
              </Pill>
            );
          })}
          <span className="mx-0.5 h-4 w-px bg-border-hairline" aria-hidden />
          {statuses.map((s) => (
            <Pill key={s} active={statusFilter.has(s)} onClick={() => setStatusFilter((prev) => toggle(prev, s))}>
              <span className="inline-flex items-center gap-1.5">
                <StatusDot status={statusKind(s)} pulse={false} /> {statusLabel(s)}
              </span>
            </Pill>
          ))}
        </div>

        {/* group-by */}
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="h-8 w-[136px] border-border-hairline bg-bg-panel font-mono text-[11px] text-text-secondary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="model">Group: Model</SelectItem>
            <SelectItem value="status">Group: Status</SelectItem>
            <SelectItem value="zone">Group: Zone</SelectItem>
          </SelectContent>
        </Select>

        {/* right cluster */}
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11px] tabular-nums text-text-muted">
            {filtered.length} twins · {groups.length} models{degraded > 0 ? ` · ${degraded} degraded` : ''}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-border-hairline">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-label={`${v} view`}
                className={cn(
                  'px-2 py-1.5 transition-colors',
                  view === v ? 'bg-module-twin/15 text-module-twin' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {v === 'grid' ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Section 3 — registry body */}
      <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-1">
        {loading ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl bg-bg-panel" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-risk/30 bg-risk/5 px-6 py-12 text-center">
            <span className="font-mono text-[12px] text-risk">failed to load the twin registry</span>
            <span className="max-w-md font-mono text-[11px] text-text-muted">{error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-border-hairline px-3 py-1.5 font-mono text-[11.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
            >
              retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <motion.img
              src="/empty-graph.svg"
              alt=""
              className="size-24 opacity-70"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
            <p className="max-w-sm font-mono text-[12px] text-text-muted">
              No twins match — clear filters to see all {allTwins.length}.
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setClassFilter(new Set());
                  setStatusFilter(new Set());
                  onSearchChange('');
                }}
                className="rounded-lg border border-module-twin/40 bg-module-twin/15 px-3 py-1.5 font-mono text-[11.5px] text-module-twin transition-colors hover:bg-module-twin/25"
              >
                clear filters
              </button>
            )}
          </div>
        ) : view === 'grid' ? (
          <div className="space-y-6">
            {regrouped.map(([key, twins], gi) => (
              <motion.section
                key={key}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: Math.min(gi, 4) * 0.08 }}
              >
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-[16px] font-semibold text-text-primary">{groupHeading(key)}</h3>
                  {groupBy === 'model' && <IRIChip iri={key} />}
                  <span className="font-mono text-[11px] tabular-nums text-text-muted">{twins.length} twins</span>
                  <span className="h-px flex-1 bg-module-twin/30" aria-hidden />
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                  {twins.map((t) => (
                    <TwinCard
                      key={t.iri}
                      twin={t}
                      tickId={tickId}
                      changedKeys={changedByTwin.get(t.iri) ?? EMPTY_SET}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </motion.section>
            ))}
          </div>
        ) : (
          /* dense list view — same data */
          <div className="overflow-hidden rounded-xl border border-border-hairline">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-bg-panel">
                <tr className="border-b border-border-hairline text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Twin</th>
                  <th className="px-3 py-2">IRI</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Mirrors</th>
                  <th className="px-3 py-2">Telemetry</th>
                  <th className="px-3 py-2 text-right">Last tick</th>
                </tr>
              </thead>
              <tbody>
                {regrouped.flatMap(([key, twins]) =>
                  twins.map((t) => (
                    <ListRow
                      key={t.iri}
                      row={{ twin: t, group: key }}
                      tickId={tickId}
                      changedKeys={changedByTwin.get(t.iri) ?? EMPTY_SET}
                      onSelect={onSelect}
                    />
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_SET = new Set<string>();

function ListRow({
  row,
  tickId,
  changedKeys,
  onSelect,
}: {
  row: Row;
  tickId: number;
  changedKeys: Set<string>;
  onSelect: (iri: string) => void;
}) {
  const t = row.twin;
  const meta = classMeta(t.classIri);
  const vals = meta.cardKeys.filter((k) => typeof t.state[k] === 'number').slice(0, 3);
  return (
    <tr
      onClick={() => onSelect(t.iri)}
      className="cursor-pointer border-b border-border-hairline/60 text-[12px] transition-colors last:border-0 hover:bg-bg-panel-raised"
    >
      <td className="px-3 py-1.5">
        <span className="flex items-center gap-2">
          <StatusDot status={statusKind(t.state.status)} pulse={false} />
          <span className="font-mono text-[10.5px] text-text-secondary">{statusLabel(t.state.status)}</span>
        </span>
      </td>
      <td className="max-w-44 truncate px-3 py-1.5 font-medium text-text-primary">{t.label}</td>
      <td className="max-w-52 truncate px-3 py-1.5 font-mono text-[11px] text-text-muted">{t.iri}</td>
      <td className="px-3 py-1.5 font-mono text-[10.5px] text-module-twin">{classLabel(t.classIri)}</td>
      <td className="max-w-40 truncate px-3 py-1.5 font-mono text-[11px] text-module-logistics">
        {t.state.mirroredIri ?? '—'}
      </td>
      <td className="px-3 py-1.5">
        <span className="flex gap-3 font-mono text-[11px] tabular-nums text-text-secondary">
          <AnimatePresence>
            {vals.map((k) => (
              <motion.span
                key={k}
                animate={changedKeys.has(k) ? { backgroundColor: ['#2DD4BF33', '#2DD4BF00'] } : {}}
                transition={{ duration: 0.6 }}
                className="rounded px-0.5"
                data-tick={tickId}
              >
                {fmtValue(k, t.state[k])}
              </motion.span>
            ))}
          </AnimatePresence>
        </span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono text-[10.5px] tabular-nums text-text-muted">
        {t.state.lastTickAt ? new Date(String(t.state.lastTickAt)).toLocaleTimeString('en-GB', { hour12: false }) : '—'}
      </td>
    </tr>
  );
}
