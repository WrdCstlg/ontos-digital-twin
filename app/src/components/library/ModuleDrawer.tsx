import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  FileDiff,
  Play,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { getModule, MODULES, type ModuleKey } from '@/lib/modules';
import { StatusDot } from '@/components/ui/status-dot';
import { ClassChip } from './chips';
import { CodeBlock } from './CodeBlock';
import {
  alpha,
  DEPENDENCIES,
  downloadExport,
  fmtDate,
  parseShacl,
  relTime,
  shaclToTurtle,
  type ClassRow,
  type LibraryModule,
  type PropRow,
  type VersionRow,
} from './lib';
import type { DrawerTab } from './ModuleCard';

const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'classes', label: 'Classes' },
  { id: 'properties', label: 'Properties' },
  { id: 'constraints', label: 'Constraints' },
  { id: 'versions', label: 'Versions' },
  { id: 'docs', label: 'Docs' },
];

function glyphFor(key: string): string {
  return MODULES.find((m) => m.key === key)?.glyph ?? '/empty-graph.svg';
}

function DepChip({ moduleKey, mods }: { moduleKey: string; mods: LibraryModule[] | undefined }) {
  const m = mods?.find((x) => x.key === moduleKey);
  const color = m?.color ?? '#94A3B8';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
      style={{ color, backgroundColor: alpha(color, 0.15), border: `1px solid ${alpha(color, 0.3)}` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {m?.name ?? moduleKey}
    </span>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</div>
      <div className="mt-1 font-mono text-[18px] font-medium tabular-nums text-text-primary">{value}</div>
    </div>
  );
}

/* ── Overview ───────────────────────────────────────────────── */

function OverviewTab({ mod, classes, props_ }: { mod: LibraryModule; classes: ClassRow[]; props_: PropRow[] }) {
  const objectProps = props_.filter((p) => p.kind === 'object').length;
  const datatypeProps = props_.filter((p) => p.kind === 'datatype').length;
  const shapes = classes.filter((c) => c.shaclJson != null).length;
  const deps = DEPENDENCIES[mod.key] ?? { dependsOn: [], dependedBy: [] };
  const modsQ = trpc.ontology.listModules.useQuery();

  return (
    <div className="space-y-5">
      <p className="text-[13.5px] leading-relaxed text-text-secondary">{mod.description}</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <MiniKpi label="Classes" value={String(mod.classCount)} />
        <MiniKpi label="Object props" value={String(objectProps)} />
        <MiniKpi label="Datatype props" value={String(datatypeProps)} />
        <MiniKpi label="SHACL shapes" value={String(shapes)} />
        <MiniKpi label="Instances mapped" value={mod.instanceCount.toLocaleString()} />
        <MiniKpi label="Last sync" value={relTime(mod.updatedAt)} />
      </div>
      <div className="space-y-2.5 rounded-xl border border-border-hairline bg-bg-inset p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">depends on</span>
          {deps.dependsOn.length === 0 ? (
            <span className="font-mono text-[12px] text-text-muted">—</span>
          ) : (
            deps.dependsOn.map((k) => <DepChip key={k} moduleKey={k} mods={modsQ.data as LibraryModule[] | undefined} />)
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-28 font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted">depended on by</span>
          {deps.dependedBy.length === 0 ? (
            <span className="font-mono text-[12px] text-text-muted">—</span>
          ) : (
            deps.dependedBy.map((k) => <DepChip key={k} moduleKey={k} mods={modsQ.data as LibraryModule[] | undefined} />)
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Classes tree ───────────────────────────────────────────── */

interface TreeNode {
  cls: ClassRow;
  children: TreeNode[];
}

function buildTree(classes: ClassRow[]): TreeNode[] {
  const byIri = new Map(classes.map((c) => [c.iri, c]));
  const nodes = new Map<string, TreeNode>(classes.map((c) => [c.iri, { cls: c, children: [] }]));
  const roots: TreeNode[] = [];
  for (const c of classes) {
    const n = nodes.get(c.iri)!;
    if (c.parentIri && byIri.has(c.parentIri)) {
      nodes.get(c.parentIri)!.children.push(n);
    } else {
      roots.push(n);
    }
  }
  return roots;
}

function sampleInstanceJson(cls: ClassRow, props: PropRow[]): string {
  const own = props.filter((p) => p.domainIri === cls.iri).slice(0, 5);
  const obj: Record<string, unknown> = {
    '@id': `${cls.iri}/EX-0001`,
    '@type': cls.iri,
  };
  for (const p of own) {
    if (p.kind === 'object') obj[p.iri] = `${p.rangeIri ?? 'ext:Thing'}/EX-0001`;
    else if (p.rangeDatatype?.includes('date')) obj[p.iri] = '2025-09-14';
    else if (p.rangeDatatype?.includes('decimal') || p.rangeDatatype?.includes('integer')) obj[p.iri] = 4200;
    else if (p.rangeDatatype?.includes('boolean')) obj[p.iri] = true;
    else obj[p.iri] = `sample-${p.label}`;
  }
  return JSON.stringify(obj, null, 2);
}

function ClassTreeRow({
  node,
  depth,
  color,
  props_,
  index,
}: {
  node: TreeNode;
  depth: number;
  color: string;
  props_: PropRow[];
  index: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const [detail, setDetail] = useState(false);
  const c = node.cls;

  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index, 10) * 0.03 }}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-bg-panel-raised/60',
          detail && 'bg-bg-panel-raised/60',
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
        <button type="button" onClick={() => setDetail((d) => !d)} className="min-w-0 flex-1 text-left">
          <ClassChip iri={c.iri} color={color} deprecated={c.deprecated} />
          {c.isCustom && (
            <span className="ml-2 rounded-full border border-border-glow bg-bg-panel px-1.5 py-0 font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
              custom
            </span>
          )}
        </button>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
          {c.instanceCount.toLocaleString()}
        </span>
      </div>
      <AnimatePresence>
        {detail && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mx-2 mb-2 space-y-2 rounded-lg border border-border-hairline bg-bg-inset p-3" style={{ marginLeft: `${depth * 20 + 34}px` }}>
              <p className="text-[12.5px] leading-relaxed text-text-secondary">{c.definition ?? 'No definition provided.'}</p>
              {c.parentIri && (
                <p className="font-mono text-[11px] text-text-muted">
                  rdfs:subClassOf <span style={{ color }}>{c.parentIri.split(':')[0]}:</span>
                  <span className="text-text-primary">{c.parentIri.split(':')[1]}</span>
                </p>
              )}
              <CodeBlock code={sampleInstanceJson(c, props_)} lang="instance · json" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((ch, i) => (
            <ClassTreeRow key={ch.cls.id} node={ch} depth={depth + 1} color={color} props_={props_} index={i} />
          ))}
        </ul>
      )}
    </motion.li>
  );
}

function ClassesTab({ classes, props_, color }: { classes: ClassRow[]; props_: PropRow[]; color: string }) {
  const tree = useMemo(() => buildTree(classes), [classes]);
  if (classes.length === 0) {
    return <p className="py-8 text-center font-mono text-[12px] text-text-muted">No classes in this module yet.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {tree.map((n, i) => (
        <ClassTreeRow key={n.cls.id} node={n} depth={0} color={color} props_={props_} index={i} />
      ))}
    </ul>
  );
}

/* ── Properties table ───────────────────────────────────────── */

type SortCol = 'property' | 'domain' | 'range' | 'cardinality' | 'usedBy';

function PropertiesTab({ props_, classes, color }: { props_: PropRow[]; classes: ClassRow[]; color: string }) {
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: 'property', dir: 1 });
  const instByIri = useMemo(() => new Map(classes.map((c) => [c.iri, c.instanceCount])), [classes]);

  const rows = useMemo(() => {
    const withUse = props_.map((p) => ({ ...p, usedBy: p.domainIri ? (instByIri.get(p.domainIri) ?? 0) : 0 }));
    const val = (p: (typeof withUse)[number]): string | number => {
      switch (sort.col) {
        case 'property': return p.iri;
        case 'domain': return p.domainIri ?? '';
        case 'range': return p.rangeIri ?? p.rangeDatatype ?? '';
        case 'cardinality': return p.cardinality ?? '';
        case 'usedBy': return p.usedBy;
      }
    };
    return [...withUse].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return cmp * sort.dir;
    });
  }, [props_, instByIri, sort]);

  const header = (col: SortCol, label: string, alignRight = false) => (
    <th
      className={cn('px-3 py-2 font-medium', alignRight && 'text-right')}
      aria-sort={sort.col === col ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        onClick={() => setSort((s) => ({ col, dir: s.col === col && s.dir === 1 ? -1 : 1 }))}
        className={cn(
          'inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.06em] transition-colors hover:text-text-primary',
          sort.col === col ? 'text-text-accent' : 'text-text-muted',
        )}
      >
        {label}
        <ArrowDownUp className="size-3" />
      </button>
    </th>
  );

  if (props_.length === 0) {
    return <p className="py-8 text-center font-mono text-[12px] text-text-muted">No properties in this module yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-hairline">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-border-hairline bg-bg-inset">
          <tr>
            {header('property', 'Property')}
            {header('domain', 'Domain')}
            {header('range', 'Range')}
            {header('cardinality', 'Card.')}
            {header('usedBy', 'Used-by', true)}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-border-hairline/60 transition-colors last:border-0 hover:bg-bg-panel-raised/50">
              <td className="px-3 py-2">
                <span className="font-mono text-[12px]">
                  <span style={{ color }}>{p.iri.split(':')[0]}:</span>
                  <span className="text-text-primary">{p.iri.split(':')[1]}</span>
                </span>
                <span
                  className={cn(
                    'ml-2 rounded px-1 py-0 font-mono text-[9px] uppercase tracking-[0.06em]',
                    p.kind === 'object' ? 'bg-info/15 text-info' : 'bg-bg-panel-raised text-text-muted',
                  )}
                >
                  {p.kind}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-text-secondary">{p.domainIri ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-text-secondary">{p.rangeIri ?? p.rangeDatatype ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-text-muted">{p.cardinality ?? '—'}</td>
              <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-text-secondary">
                {p.usedBy.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Constraints (SHACL) ────────────────────────────────────── */

function ConstraintsTab({ mod, classes }: { mod: LibraryModule; classes: ClassRow[] }) {
  const [openShape, setOpenShape] = useState<string | null>(null);
  const [reasonerOn, setReasonerOn] = useState(false);
  const reasonerQ = trpc.ontology.runReasoner.useQuery({ moduleKey: mod.key }, { enabled: reasonerOn });

  const shapes = classes
    .map((c) => ({ cls: c, shape: parseShacl(c.shaclJson) }))
    .filter((x): x is { cls: ClassRow; shape: NonNullable<ReturnType<typeof parseShacl>> } => x.shape != null);

  return (
    <div className="space-y-4">
      {/* reasoner bar */}
      <div className="flex items-center justify-between rounded-xl border border-border-hairline bg-bg-inset px-4 py-3">
        <div className="flex items-center gap-2">
          {reasonerOn && reasonerQ.data ? (
            reasonerQ.data.consistent ? (
              <StatusDot status="ok" pulse={false} />
            ) : (
              <StatusDot status="risk" pulse={false} />
            )
          ) : (
            <StatusDot status="idle" pulse={false} />
          )}
          <span className="font-mono text-[11.5px] text-text-secondary">
            {reasonerOn
              ? reasonerQ.isLoading
                ? 'classifying…'
                : reasonerQ.data
                  ? `${reasonerQ.data.consistent ? 'consistent' : 'inconsistent'} · ${reasonerQ.data.classesClassified} classes · ${reasonerQ.data.inferredSubClassOf.length} inferred links · ${reasonerQ.data.durationMs}ms`
                  : 'reasoner error'
              : 'ontos-sim reasoner idle'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setReasonerOn(true);
            if (reasonerOn) reasonerQ.refetch();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/15 px-3 py-1.5 text-[12px] font-medium text-text-accent transition-colors hover:bg-iris/25"
        >
          <Play className="size-3.5" />
          Run reasoner
        </button>
      </div>

      {reasonerOn && reasonerQ.data && (reasonerQ.data.issues.length > 0 || reasonerQ.data.warnings.length > 0) && (
        <div className="space-y-1.5 rounded-xl border border-warn/25 bg-warn/5 p-3.5">
          {reasonerQ.data.issues.map((i) => (
            <p key={i} className="flex items-start gap-2 font-mono text-[11.5px] text-risk">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {i}
            </p>
          ))}
          {reasonerQ.data.warnings.slice(0, 6).map((w) => (
            <p key={w} className="flex items-start gap-2 font-mono text-[11.5px] text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
            </p>
          ))}
          {reasonerQ.data.warnings.length > 6 && (
            <p className="font-mono text-[10.5px] text-text-muted">+{reasonerQ.data.warnings.length - 6} more warnings</p>
          )}
        </div>
      )}

      {shapes.length === 0 ? (
        <p className="py-8 text-center font-mono text-[12px] text-text-muted">No SHACL shapes defined for this module.</p>
      ) : (
        <div className="space-y-2.5">
          {shapes.map(({ cls, shape }) => {
            const hasViolation = shape.constraints.some((c) => c.severity === 'Violation');
            const open = openShape === shape.shape;
            return (
              <div key={shape.shape} className="overflow-hidden rounded-xl border border-border-hairline bg-bg-panel">
                <button
                  type="button"
                  onClick={() => setOpenShape(open ? null : shape.shape)}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-bg-panel-raised/60"
                >
                  {open ? (
                    <ChevronDown className="size-3.5 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-text-muted" />
                  )}
                  <span className="font-mono text-[12.5px] text-text-primary">{shape.shape}</span>
                  <span className="font-mono text-[10.5px] text-text-muted">on {cls.iri}</span>
                  <span
                    className={cn(
                      'ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
                      hasViolation ? 'border-warn/30 bg-warn/10 text-warn' : 'border-ok/30 bg-ok/10 text-ok',
                    )}
                  >
                    {hasViolation ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
                    {hasViolation ? `warnings (${shape.constraints.filter((c) => c.severity !== 'Violation').length})` : 'valid'}
                  </span>
                </button>
                <AnimatePresence>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4">
                        <CodeBlock code={shaclToTurtle(shape, mod.prefix)} lang="turtle" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Versions timeline ──────────────────────────────────────── */

interface DiffSummary {
  classesAdded: number;
  propertiesAdded: number;
  classesRemoved: number;
  propertiesRemoved: number;
  changed: number;
}

function VersionDiffPanel({ moduleKey, from, to }: { moduleKey: string; from: string; to: string }) {
  const diffQ = trpc.ontology.diffVersions.useQuery({ moduleKey, fromVersion: from, toVersion: to });
  if (diffQ.isLoading) return <p className="px-1 py-2 font-mono text-[11px] text-text-muted">computing diff…</p>;
  if (diffQ.error || !diffQ.data)
    return <p className="px-1 py-2 font-mono text-[11px] text-risk">diff failed to load</p>;
  const s = diffQ.data.summary as DiffSummary;
  const addedC = diffQ.data.added.classes as { iri?: string }[];
  const addedP = diffQ.data.added.properties as { iri?: string }[];
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border-hairline bg-bg-inset p-3">
      <p className="font-mono text-[11.5px] text-text-secondary">
        v{from} → v{to}: <span className="text-ok">+{s.classesAdded} classes, +{s.propertiesAdded} properties</span>
        {s.classesRemoved + s.propertiesRemoved > 0 && (
          <span className="text-risk"> · −{s.classesRemoved + s.propertiesRemoved} removed</span>
        )}
        {s.changed > 0 && <span className="text-warn"> · {s.changed} changed</span>}
      </p>
      {(addedC.length > 0 || addedP.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {addedC.map((c, i) => (
            <span key={`c${i}`} className="rounded border border-ok/25 bg-ok/10 px-1.5 py-0.5 font-mono text-[10.5px] text-ok">
              + {typeof c === 'string' ? c : (c.iri ?? 'class')}
            </span>
          ))}
          {addedP.map((p, i) => (
            <span key={`p${i}`} className="rounded border border-info/25 bg-info/10 px-1.5 py-0.5 font-mono text-[10.5px] text-info">
              + {typeof p === 'string' ? p : (p.iri ?? 'prop')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VersionsTab({
  mod,
  versions,
  onToast,
}: {
  mod: LibraryModule;
  versions: VersionRow[];
  onToast: (msg: string, kind?: 'ok' | 'info') => void;
}) {
  const [diffFor, setDiffFor] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const exportVersion = async () => {
    try {
      const res = await utils.ontology.exportModule.fetch({ moduleKey: mod.key, format: 'turtle' });
      const size = downloadExport(`${mod.key}-v${res.version}.ttl`, res.content, 'text/turtle');
      onToast(`Exported ${mod.key}-v${res.version}.ttl (Turtle, ${size})`, 'ok');
    } catch (e) {
      onToast(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'info');
    }
  };

  if (versions.length === 0) {
    return <p className="py-8 text-center font-mono text-[12px] text-text-muted">No published versions.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-border-hairline pl-5">
      {versions.map((v, i) => {
        const current = v.version === mod.version;
        const prev = versions[i + 1];
        const diff = v.diffJson as {
          added?: { classes?: unknown[]; properties?: unknown[] };
          removed?: { classes?: unknown[]; properties?: unknown[] };
          changed?: unknown[];
        } | null;
        const ac = diff?.added?.classes?.length ?? 0;
        const ap = diff?.added?.properties?.length ?? 0;
        const rc = (diff?.removed?.classes?.length ?? 0) + (diff?.removed?.properties?.length ?? 0);
        const ch = diff?.changed?.length ?? 0;
        return (
          <li key={v.id} className="relative">
            <span
              aria-hidden
              className={cn(
                'absolute -left-[26.5px] top-1.5 size-3 rounded-full border-2',
                current ? 'border-ok bg-ok/30 shadow-[0_0_10px_rgba(52,211,153,0.6)]' : 'border-border-glow bg-bg-panel',
              )}
            />
            <div
              className={cn(
                'rounded-xl border p-4',
                current ? 'border-ok/40 bg-ok/5 ring-1 ring-ok/30' : 'border-border-hairline bg-bg-panel',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5 font-mono text-[11.5px] font-medium',
                    current ? 'bg-ok/15 text-ok' : 'bg-bg-panel-raised text-text-secondary',
                  )}
                >
                  v{v.version}
                </span>
                {current && (
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ok">current</span>
                )}
                <span className="ml-auto font-mono text-[10.5px] text-text-muted">{fmtDate(v.publishedAt)}</span>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-text-secondary">{v.changelog ?? '—'}</p>
              <p className="mt-1.5 font-mono text-[10.5px] text-text-muted">
                +{ac} classes, +{ap} properties{rc > 0 ? `, −${rc} removed` : ''}
                {ch > 0 ? `, ${ch} deprecation${ch === 1 ? '' : 's'}/change${ch === 1 ? '' : 's'}` : ''}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {prev && (
                  <button
                    type="button"
                    onClick={() => setDiffFor(diffFor === v.id ? null : v.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-2.5 py-1 font-mono text-[10.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
                  >
                    <FileDiff className="size-3.5" />
                    Diff v{prev.version} → v{v.version}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => exportVersion()}
                  aria-label={`Export v${v.version}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-2.5 py-1 font-mono text-[10.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
                >
                  <Download className="size-3.5" />
                  Export
                </button>
              </div>
              {diffFor === v.id && prev && <VersionDiffPanel moduleKey={mod.key} from={prev.version} to={v.version} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Docs ───────────────────────────────────────────────────── */

function renderInline(text: string, color: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = part.slice(1, -1);
      const [prefix, local] = code.includes(':') ? code.split(':') : [null, code];
      return (
        <code key={i} className="rounded border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[11.5px]">
          {prefix != null && <span style={{ color }}>{prefix}:</span>}
          <span className="text-text-primary">{local}</span>
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function DocsTab({ mod, classes, props_, onToast }: { mod: LibraryModule; classes: ClassRow[]; props_: PropRow[]; onToast: (m: string, k?: 'ok' | 'info') => void }) {
  const doc = mod.documentation ?? '';
  const blocks = doc.split(/\n{2,}/).filter(Boolean);
  const exampleCls = classes.find((c) => !c.deprecated) ?? classes[0];
  const ttl = exampleCls
    ? [
        `@prefix ${mod.prefix}: <https://ontos.acme.corp/ontology/${mod.prefix}/> .`,
        `@prefix owl: <http://www.w3.org/2002/07/owl#> .`,
        ``,
        `${exampleCls.iri} a owl:Class ;`,
        `  rdfs:label "${exampleCls.label}"${exampleCls.parentIri ? ' ;' : ' .'}`,
        ...(exampleCls.parentIri ? [`  rdfs:subClassOf ${exampleCls.parentIri} .`] : []),
        ``,
        `${exampleCls.iri}/EX-0001 a ${exampleCls.iri}${props_.find((p) => p.domainIri === exampleCls.iri && p.kind === 'datatype') ? ' ;' : ' .'}`,
        ...(props_.find((p) => p.domainIri === exampleCls.iri && p.kind === 'datatype')
          ? [`  ${props_.find((p) => p.domainIri === exampleCls.iri)!.iri} "sample" .`]
          : []),
      ].join('\n')
    : '';

  return (
    <div className="space-y-4">
      {blocks.length === 0 && (
        <p className="py-8 text-center font-mono text-[12px] text-text-muted">No documentation for this module yet.</p>
      )}
      {blocks.map((b, i) => {
        if (b.startsWith('# ')) {
          return (
            <h3 key={i} className="font-display text-[16px] font-semibold text-text-primary">
              {renderInline(b.slice(2), mod.color)}
            </h3>
          );
        }
        return (
          <p key={i} className="text-[13.5px] leading-relaxed text-text-secondary">
            {renderInline(b, mod.color)}
          </p>
        );
      })}
      {ttl && <CodeBlock code={ttl} lang="turtle · example" />}
      <button
        type="button"
        onClick={() => onToast('Modeling guides live in Decisions & Architecture (demo link)', 'info')}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-accent transition-colors hover:text-iris-bright"
      >
        Full guide
        <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}

/* ── Drawer shell ───────────────────────────────────────────── */

export function ModuleDrawer({
  moduleKey,
  initialTab,
  onClose,
  onToast,
}: {
  moduleKey: string | null;
  initialTab: DrawerTab;
  onClose: () => void;
  onToast: (msg: string, kind?: 'ok' | 'info') => void;
}) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);

  /* reset the active tab when a new drawer target arrives (render-phase
     state adjustment — avoids cascading effect renders) */
  const incoming = moduleKey ? `${moduleKey}|${initialTab}` : null;
  const [applied, setApplied] = useState<string | null>(null);
  if (incoming !== applied) {
    setApplied(incoming);
    if (incoming) setTab(initialTab);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const enabled = moduleKey != null;
  const modQ = trpc.ontology.getModule.useQuery({ key: moduleKey ?? '' }, { enabled });
  const classesQ = trpc.ontology.listClasses.useQuery({ moduleKey: moduleKey ?? '' }, { enabled });
  const propsQ = trpc.ontology.listProperties.useQuery({ moduleKey: moduleKey ?? '' }, { enabled });
  const versionsQ = trpc.ontology.listVersions.useQuery({ moduleKey: moduleKey ?? '' }, { enabled });

  const mod = modQ.data as LibraryModule | undefined;
  const classes = (classesQ.data ?? []) as ClassRow[];
  const props_ = (propsQ.data ?? []) as PropRow[];
  const versions = (versionsQ.data ?? []) as VersionRow[];
  const libMod = (MODULES as readonly { key: string }[]).some((m) => m.key === moduleKey)
    ? getModule(moduleKey as ModuleKey)
    : null;

  return (
    <AnimatePresence>
      {enabled && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]"
          />
          <motion.aside
            key="drawer"
            initial={{ x: 560 }}
            animate={{ x: 0 }}
            exit={{ x: 560 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[560px] flex-col border-l border-border-hairline bg-bg-panel shadow-2xl"
            role="dialog"
            aria-label="Module details"
          >
            {/* header */}
            <div className="flex items-center gap-3 border-b border-border-hairline px-6 py-4">
              {mod ? (
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-hairline bg-bg-inset"
                >
                  <img src={glyphFor(mod.key)} alt="" className="size-7" />
                </span>
              ) : (
                <span className="size-10 animate-pulse rounded-lg bg-bg-panel-raised" />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-[17px] font-semibold text-text-primary">
                  {mod?.name ?? 'Loading…'}
                </h2>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.08em]" style={{ color: mod?.color ?? '#64748B' }}>
                  {mod ? `${mod.key} module · v${mod.version}` : '…'}
                </p>
              </div>
              {libMod && (
                <span
                  className="rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
                  style={{
                    color: mod?.color,
                    backgroundColor: alpha(mod?.color ?? '#94A3B8', 0.15),
                    border: `1px solid ${alpha(mod?.color ?? '#94A3B8', 0.3)}`,
                  }}
                >
                  OWL 2 DL
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* tabs */}
            <div className="flex gap-1 overflow-x-auto border-b border-border-hairline px-4 py-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'relative whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                    tab === t.id ? 'text-text-accent' : 'text-text-muted hover:text-text-primary',
                  )}
                >
                  {t.label}
                  {tab === t.id && (
                    <motion.span
                      layoutId="library-drawer-tab"
                      className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full bg-iris"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {modQ.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="block h-16 animate-pulse rounded-xl bg-bg-panel-raised" />
                  ))}
                </div>
              ) : modQ.error || !mod ? (
                <p className="py-12 text-center font-mono text-[12px] text-risk">Failed to load module.</p>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tab}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {tab === 'overview' && <OverviewTab mod={mod} classes={classes} props_={props_} />}
                    {tab === 'classes' && <ClassesTab classes={classes} props_={props_} color={mod.color} />}
                    {tab === 'properties' && <PropertiesTab props_={props_} classes={classes} color={mod.color} />}
                    {tab === 'constraints' && <ConstraintsTab mod={mod} classes={classes} />}
                    {tab === 'versions' && <VersionsTab mod={mod} versions={versions} onToast={onToast} />}
                    {tab === 'docs' && <DocsTab mod={mod} classes={classes} props_={props_} onToast={onToast} />}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
