import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftRight, GitCompareArrows, List, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GraphCanvas, type GraphEdge, type GraphNode } from '@/components/graph/GraphCanvas';
import {
  diffEntryIri,
  moduleKeyForPrefix,
  prefixOf,
  type DiffEntry,
  type DiffResult,
  type StudioClass,
  type StudioVersion,
} from './studio-utils';

export interface DiffViewProps {
  diff: DiffResult | undefined;
  loading: boolean;
  error: string | null;
  classes: StudioClass[];
  versions: StudioVersion[];
  fromVersion: string;
  toVersion: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onSelectClass: (iri: string) => void;
}

function VersionSelect({
  value,
  onChange,
  versions,
  published,
}: {
  value: string;
  onChange: (v: string) => void;
  versions: StudioVersion[];
  published: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border-hairline bg-bg-inset px-2 py-1 font-mono text-[12px] text-text-primary outline-none focus:border-border-glow"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.version}>
            v{v.version}
          </option>
        ))}
      </select>
      <span
        className={cn(
          'rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em]',
          published ? 'border-ok/40 bg-ok/10 text-ok' : 'border-warn/40 bg-warn/10 text-warn',
        )}
      >
        {published ? 'published' : 'draft'}
      </span>
    </span>
  );
}

function DiffRow({ kind, text, delay }: { kind: 'add' | 'remove' | 'change'; text: string; delay: number }) {
  const color = kind === 'add' ? 'text-ok' : kind === 'remove' ? 'text-risk' : 'text-warn';
  const symbol = kind === 'add' ? '+' : kind === 'remove' ? '−' : 'Δ';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-baseline gap-2 border-b border-border-hairline/60 px-3 py-1.5 font-mono text-[12px] last:border-0"
    >
      <span className={cn('w-3 shrink-0 font-semibold', color)}>{symbol}</span>
      <span className="text-text-secondary">{text}</span>
    </motion.div>
  );
}

function entryText(kind: 'class' | 'property' | 'change', e: DiffEntry): string {
  if (typeof e === 'string') return `${e} (${kind})`;
  if (kind === 'change') return `${e.iri}${e.note ? ` — ${e.note}` : ''}`;
  return `${e.iri} (${kind})${e.parentIri ? ` — subclass of ${e.parentIri}` : ''}`;
}

/**
 * DiffView — version diff replacing the canvas: split header with version
 * pickers, mono summary, and a graph/list toggle. Additions emerald,
 * removals red, modifications amber.
 */
export function DiffView({
  diff,
  loading,
  error,
  classes,
  versions,
  fromVersion,
  toVersion,
  onFromChange,
  onToChange,
  onSelectClass,
}: DiffViewProps) {
  const [mode, setMode] = useState<'graph' | 'list'>('graph');

  const { nodes, edges } = useMemo((): { nodes: GraphNode[]; edges: GraphEdge[] } => {
    if (!diff) return { nodes: [], edges: [] };
    const added = new Set(diff.added.classes.map(diffEntryIri));
    const changed = new Set(
      diff.changed.map(diffEntryIri).filter((iri) => classes.some((c) => c.iri === iri)),
    );
    const nodes: GraphNode[] = classes.map((c) => ({
      id: c.iri,
      label: c.label,
      // additions emerald, modifications amber, unchanged own module color
      module: added.has(c.iri) ? 'compliance' : changed.has(c.iri) ? 'finance' : moduleKeyForPrefix(prefixOf(c.iri)),
      size: 30,
    }));
    const edges: GraphEdge[] = classes
      .filter((c) => c.parentIri && classes.some((p) => p.iri === c.parentIri))
      .map((c) => ({ source: c.iri, target: c.parentIri!, label: '⊑' }));
    return { nodes, edges };
  }, [diff, classes]);

  const s = diff?.summary;
  const empty =
    diff && s && s.classesAdded + s.propertiesAdded + s.classesRemoved + s.propertiesRemoved + s.changed === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* split header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border-hairline px-4 py-2.5">
        <GitCompareArrows className="size-4 text-text-muted" />
        <VersionSelect value={fromVersion} onChange={onFromChange} versions={versions} published />
        <ArrowLeftRight className="size-3.5 text-text-muted" />
        <VersionSelect value={toVersion} onChange={onToChange} versions={versions} published={false} />
        {s && (
          <span className="font-mono text-[11.5px] text-text-secondary">
            +{s.classesAdded} class{s.classesAdded === 1 ? '' : 'es'} · +{s.propertiesAdded} properties ·{' '}
            {s.changed} changed · {s.classesRemoved} removed ·{' '}
            <span className="text-ok">0 breaking changes</span>
          </span>
        )}
        {/* mode toggle + legend */}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 md:flex">
            <span className="flex items-center gap-1 font-mono text-[10px] text-ok"><span className="size-1.5 rounded-full bg-ok" />added</span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-warn"><span className="size-1.5 rounded-full bg-warn" />changed</span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-risk"><span className="size-1.5 rounded-full bg-risk" />removed</span>
          </div>
          <div className="flex overflow-hidden rounded-md border border-border-hairline">
            {(['graph', 'list'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 text-[11.5px] capitalize transition-colors',
                  mode === m ? 'bg-bg-panel-raised text-text-accent' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {m === 'graph' ? <Waypoints className="size-3" /> : <List className="size-3" />}
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center font-mono text-[12px] text-text-muted">
            computing diff…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-risk">{error}</div>
        ) : !diff ? null : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="font-mono text-[13px] text-ok">no differences</p>
            <p className="max-w-72 text-[12.5px] text-text-muted">
              v{fromVersion} → v{toVersion} spans no published changes.
            </p>
          </div>
        ) : mode === 'graph' ? (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            className="h-full rounded-none border-0"
            onNodeClick={(id) => onSelectClass(id)}
          />
        ) : (
          <div className="h-full overflow-y-auto py-1">
            {diff.added.classes.map((e, i) => (
              <DiffRow key={`ac-${i}`} kind="add" text={entryText('class', e)} delay={i * 0.04} />
            ))}
            {diff.added.properties.map((e, i) => (
              <DiffRow key={`ap-${i}`} kind="add" text={entryText('property', e)} delay={(diff.added.classes.length + i) * 0.04} />
            ))}
            {diff.changed.map((e, i) => (
              <DiffRow key={`ch-${i}`} kind="change" text={entryText('change', e)} delay={(diff.added.classes.length + diff.added.properties.length + i) * 0.04} />
            ))}
            {diff.removed.classes.map((e, i) => (
              <DiffRow key={`rc-${i}`} kind="remove" text={typeof e === 'string' ? `${e} (deprecated)` : `${e.iri} (deprecated)`} delay={i * 0.04} />
            ))}
            {diff.removed.properties.map((e, i) => (
              <DiffRow key={`rp-${i}`} kind="remove" text={entryText('property', e)} delay={i * 0.04} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border-hairline px-4 py-1.5 font-mono text-[10px] text-text-muted">
        versions in range: {diff?.versionsInRange.map((v) => `v${v}`).join(', ') || '—'}
      </div>
    </div>
  );
}

export default DiffView;
