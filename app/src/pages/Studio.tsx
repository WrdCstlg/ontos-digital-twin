import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  Cpu,
  GitBranch,
  History,
  Loader2,
  LogIn,
  Rocket,
  ShieldCheck,
  TriangleAlert,
  Waypoints,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { LOGIN_PATH } from '@/const';
import { StatusDot } from '@/components/ui/status-dot';
import { GraphCanvas, type GraphEdge, type GraphNode } from '@/components/graph/GraphCanvas';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ClassTree from '@/components/studio/ClassTree';
import NewClassDialog from '@/components/studio/NewClassDialog';
import Inspector from '@/components/studio/Inspector';
import DiffView from '@/components/studio/DiffView';
import TurtleView from '@/components/studio/TurtleView';
import ConsoleBar from '@/components/studio/ConsoleBar';
import {
  buildClassTree,
  downloadText,
  moduleKeyForPrefix,
  prefixOf,
  type ClassTreeNode,
  type DiffResult,
  type ReasonerResult,
  type StudioClass,
  type StudioModule,
  type StudioProperty,
  type StudioVersion,
  type EXPORT_FORMATS,
} from '@/components/studio/studio-utils';

type ViewTab = 'graph' | 'tree' | 'diff' | 'turtle';

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'auth';
  msg: string;
}

const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: 'graph', label: 'Graph' },
  { key: 'tree', label: 'Tree' },
  { key: 'diff', label: 'Diff' },
  { key: 'turtle', label: 'Turtle' },
];

export default function Studio() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  /* ---------------- state ---------------- */
  const [moduleKey, setModuleKey] = useState('hr');
  const [view, setView] = useState<ViewTab>('graph');
  const [selectedClassIri, setSelectedClassIri] = useState<string | null>(null);
  const [selectedPropIri, setSelectedPropIri] = useState<string | null>(null);
  const [flashIri, setFlashIri] = useState<string | null>(null);
  const [newClassOpen, setNewClassOpen] = useState(false);
  const [prefillParent, setPrefillParent] = useState<string | null>(null);
  const [deprecateTarget, setDeprecateTarget] = useState<StudioClass | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNotes, setPublishNotes] = useState('');
  const [showInferred, setShowInferred] = useState(false);
  const [showInstances, setShowInstances] = useState(false);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [fromVersion, setFromVersion] = useState<string | null>(null);
  const [toVersion, setToVersion] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  /* ---------------- queries ---------------- */
  const modulesQ = trpc.ontology.listModules.useQuery();
  const classesQ = trpc.ontology.listClasses.useQuery({ moduleKey });
  const propsQ = trpc.ontology.listProperties.useQuery({ moduleKey });
  const versionsQ = trpc.ontology.listVersions.useQuery({ moduleKey });
  const reasonerQ = trpc.ontology.runReasoner.useQuery(
    { moduleKey },
    { enabled: false, retry: false, refetchOnWindowFocus: false },
  );

  const modules = (modulesQ.data ?? []) as unknown as StudioModule[];
  const classes = useMemo(() => (classesQ.data ?? []) as unknown as StudioClass[], [classesQ.data]);
  const properties = useMemo(() => (propsQ.data ?? []) as unknown as StudioProperty[], [propsQ.data]);
  const versions = useMemo(() => (versionsQ.data ?? []) as unknown as StudioVersion[], [versionsQ.data]);
  const module = modules.find((m) => m.key === moduleKey) ?? null;
  const reasoner = (reasonerQ.data ?? null) as ReasonerResult | null;

  // default diff range: previous published → latest
  if (versions.length && (!fromVersion || !toVersion)) {
    setToVersion(versions[0].version);
    setFromVersion(versions[1]?.version ?? versions[0].version);
  }

  const diffQ = trpc.ontology.diffVersions.useQuery(
    { moduleKey, fromVersion: fromVersion ?? '0.0', toVersion: toVersion ?? '0.0' },
    { enabled: view === 'diff' && !!fromVersion && !!toVersion, retry: false },
  );
  const turtleQ = trpc.ontology.exportModule.useQuery(
    { moduleKey, format: 'turtle' },
    { enabled: view === 'turtle', retry: false, staleTime: 30_000 },
  );

  /* ---------------- toasts ---------------- */
  const pushToast = (kind: Toast['kind'], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, msg }]);
    if (kind !== 'auth') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  };

  const handleMutationError = (err: { data?: { code?: string } | null; message: string }, fallback: string) => {
    if (err.data?.code === 'UNAUTHORIZED' || err.data?.code === 'FORBIDDEN') {
      pushToast('auth', 'Sign in required to edit the ontology.');
    } else {
      pushToast('error', err.message || fallback);
    }
  };

  /* ---------------- mutations ---------------- */
  const deprecateClass = trpc.ontology.deprecateClass.useMutation({
    onSuccess: async (_d, vars) => {
      pushToast('success', `Deprecated ${vars.classIri}`);
      setDeprecateTarget(null);
      await Promise.all([classesQ.refetch(), utils.ontology.listModules.invalidate()]);
    },
    onError: (err) => handleMutationError(err, 'Deprecate failed'),
  });

  const invalidateAfterCreate = async () => {
    await Promise.all([
      utils.ontology.listClasses.invalidate({ moduleKey }),
      utils.ontology.listProperties.invalidate({ moduleKey }),
      utils.ontology.listVersions.invalidate({ moduleKey }),
      utils.ontology.listModules.invalidate(),
    ]);
  };

  /* ---------------- actions ---------------- */
  const runReasoner = async () => {
    const res = await reasonerQ.refetch();
    setLastRunAt(new Date());
    if (res.error) {
      pushToast('error', res.error.message);
    } else {
      pushToast('success', `Reasoner finished — ${res.data?.inferredSubClassOf.length ?? 0} inferences, consistent: ${res.data?.consistent}`);
    }
  };

  const doExport = async (format: (typeof EXPORT_FORMATS)[number]['format']) => {
    setExporting(true);
    try {
      const res = await utils.ontology.exportModule.fetch({ moduleKey, format });
      const ext = { turtle: '.ttl', owl: '.owl', jsonld: '.jsonld', rdfxml: '.rdf' }[format];
      downloadText(`${moduleKey}-v${res.version}${ext}`, res.content);
      pushToast('success', `Exported ${moduleKey} v${res.version} as ${format.toUpperCase()}`);
    } catch (e) {
      handleMutationError(e as { data?: { code?: string }; message: string }, 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const onCreated = async (iri: string, newVersion: string) => {
    await invalidateAfterCreate();
    setSelectedClassIri(iri);
    setSelectedPropIri(null);
    setFlashIri(iri);
    setTimeout(() => setFlashIri(null), 1200);
    pushToast('success', `Published v${newVersion} — added ${iri}`);
  };

  const locate = (iri: string) => {
    setSelectedClassIri(iri);
    setSelectedPropIri(null);
    setView('graph');
  };

  /* ---------------- graph data ---------------- */
  const { graphNodes, graphEdges } = useMemo((): { graphNodes: GraphNode[]; graphEdges: GraphEdge[] } => {
    const maxInst = Math.max(1, ...classes.map((c) => c.instanceCount));
    const nodes: GraphNode[] = classes.map((c) => ({
      id: c.iri,
      label: c.label,
      module: moduleKeyForPrefix(prefixOf(c.iri)),
      size: 28 + Math.round(12 * Math.sqrt(c.instanceCount / maxInst)),
    }));
    const edges: GraphEdge[] = [];
    for (const c of classes) {
      if (c.parentIri && classes.some((p) => p.iri === c.parentIri)) {
        edges.push({ id: `sub:${c.iri}`, source: c.iri, target: c.parentIri, label: '⊑' });
      }
    }
    for (const p of properties) {
      if (p.kind === 'object' && p.domainIri && p.rangeIri) {
        edges.push({
          id: `prop:${p.iri}`,
          source: p.domainIri,
          target: p.rangeIri,
          label: p.iri,
        });
      }
    }
    if (showInferred && reasoner) {
      for (const i of reasoner.inferredSubClassOf) {
        if (i.via !== i.child) {
          edges.push({
            id: `inf:${i.child}->${i.ancestor}`,
            source: i.child,
            target: i.ancestor,
            label: '⊑ inferred',
          });
        }
      }
    }
    if (showInstances) {
      for (const c of classes.filter((x) => x.instanceCount > 0)) {
        for (let k = 0; k < Math.min(3, c.instanceCount); k++) {
          const iid = `${c.iri}/·${k + 1}`;
          nodes.push({ id: iid, label: `${c.label} instance`, module: moduleKeyForPrefix(prefixOf(c.iri)), size: 10 });
          edges.push({ id: `type:${iid}`, source: iid, target: c.iri, label: 'rdf:type' });
        }
      }
    }
    return { graphNodes: nodes, graphEdges: edges };
  }, [classes, properties, showInferred, showInstances, reasoner]);

  /* ---------------- tree-tab outline ---------------- */
  const outlineTree = useMemo(() => buildClassTree(classes), [classes]);
  const renderOutline = (nodes: ClassTreeNode[], depth = 0): React.ReactNode => (
    <ul className={cn(depth > 0 && 'ml-5 border-l border-border-hairline/70 pl-3')}>
      {nodes.map((n) => (
        <li key={n.cls.iri} className="py-1">
          <button
            type="button"
            onClick={() => locate(n.cls.iri)}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[13px] transition-colors hover:bg-bg-panel-raised',
              n.cls.deprecated ? 'text-text-muted line-through' : 'text-text-primary',
            )}
          >
            <span style={{ color: module?.color }}>{prefixOf(n.cls.iri)}:</span>
            {n.cls.label}
            <span className="ml-2 text-[10.5px] text-text-muted">{n.cls.instanceCount}</span>
          </button>
          {n.children.length > 0 && renderOutline(n.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  /* ---------------- guards ---------------- */
  if (modulesQ.isLoading) {
    return (
      <div className="-m-6 flex h-[calc(100dvh-3.5rem)] items-center justify-center lg:-m-8">
        <Loader2 className="size-5 animate-spin text-text-muted" />
      </div>
    );
  }
  if (modulesQ.error) {
    return (
      <div className="-m-6 flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center gap-3 lg:-m-8">
        <TriangleAlert className="size-6 text-risk" />
        <p className="text-[14px] text-text-secondary">Failed to load modules: {modulesQ.error.message}</p>
        <button
          type="button"
          onClick={() => modulesQ.refetch()}
          className="rounded-md border border-border-hairline px-3 py-1.5 text-[13px] text-text-primary hover:border-border-glow"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!module) {
    return (
      <div className="-m-6 flex h-[calc(100dvh-3.5rem)] items-center justify-center lg:-m-8">
        <p className="text-[14px] text-text-muted">Module “{moduleKey}” not found in this workspace.</p>
      </div>
    );
  }

  const isDraft = module.status === 'draft';
  const canPublish = !!reasoner?.consistent;

  return (
    <div className="-m-6 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden lg:-m-8">
      {/* ================= Toolbar (48px) ================= */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-hairline bg-bg-panel px-3">
        {/* module selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setModuleMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-border-hairline px-2.5 py-1.5 transition-colors hover:border-border-glow"
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: module.color }} />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: module.color }}>
              {module.key}
            </span>
            <ChevronDown className="size-3 text-text-muted" />
          </button>
          {moduleMenuOpen && (
            <>
              <button type="button" aria-hidden className="fixed inset-0 z-30 cursor-default" onClick={() => setModuleMenuOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-lg border border-border-hairline bg-bg-panel-raised py-1 shadow-xl">
                {modules.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => {
                      setModuleKey(m.key);
                      setSelectedClassIri(null);
                      setSelectedPropIri(null);
                      setFromVersion(null);
                      setToVersion(null);
                      setModuleMenuOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-bg-panel',
                      m.key === moduleKey && 'bg-bg-panel',
                    )}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-text-primary">{m.name}</span>
                      <span className="block font-mono text-[10px] text-text-muted">
                        {m.prefix}: · v{m.version} · {m.classCount} classes
                      </span>
                    </span>
                    {m.key === moduleKey && <Check className="size-3.5 text-text-accent" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* version chip + history dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setVersionMenuOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors',
              isDraft
                ? 'border-warn/40 bg-warn/10 text-warn'
                : 'border-ok/40 bg-ok/10 text-ok',
            )}
          >
            <StatusDot status={isDraft ? 'warn' : 'ok'} pulse={isDraft} />
            {isDraft ? 'draft ' : ''}v{module.version}
            <ChevronDown className="size-3" />
          </button>
          {versionMenuOpen && (
            <>
              <button type="button" aria-hidden className="fixed inset-0 z-30 cursor-default" onClick={() => setVersionMenuOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-lg border border-border-hairline bg-bg-panel-raised py-1 shadow-xl">
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
                  <History className="size-3" /> Version history
                </div>
                {versions.length === 0 && (
                  <p className="px-3 py-2 text-[12px] text-text-muted">No published versions yet.</p>
                )}
                {versions.map((v) => (
                  <div key={v.id} className="px-3 py-2 transition-colors hover:bg-bg-panel">
                    <div className="flex items-center gap-2">
                      <GitBranch className="size-3 text-text-muted" />
                      <span className="font-mono text-[12px] text-text-primary">v{v.version}</span>
                      <span className="rounded-full border border-ok/40 bg-ok/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-ok">
                        published
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-text-muted">
                        {new Date(v.publishedAt).toLocaleDateString()}
                      </span>
                    </div>
                    {v.changelog && <p className="mt-0.5 pl-5 text-[11.5px] leading-snug text-text-muted">{v.changelog}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* view tabs */}
        <div className="ml-2 flex items-center gap-0.5 rounded-lg border border-border-hairline bg-bg-inset p-0.5">
          {VIEW_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              className={cn(
                'relative rounded-md px-3 py-1 text-[12px] transition-colors duration-200',
                view === t.key ? 'text-text-accent' : 'text-text-muted hover:text-text-primary',
              )}
            >
              {t.label}
              {view === t.key && (
                <motion.span
                  layoutId="studio-tab-underline"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-iris"
                  transition={{ duration: 0.2 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* right actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={runReasoner}
            disabled={reasonerQ.isFetching}
            className="flex items-center gap-1.5 rounded-md border border-border-hairline px-2.5 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
          >
            {reasonerQ.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Validate
          </button>
          <button
            type="button"
            onClick={runReasoner}
            disabled={reasonerQ.isFetching}
            className="flex items-center gap-1.5 rounded-md border border-border-hairline px-2.5 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
          >
            <Cpu className="size-3.5" /> Run reasoner
          </button>
          <button
            type="button"
            disabled={!isDraft}
            title={isDraft ? 'Discard unpublished draft changes' : 'No draft changes to discard'}
            onClick={() => pushToast('info', 'Draft discarded (simulated — edits publish atomically in this build).')}
            className="px-2 py-1.5 text-[12.5px] text-risk transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Discard draft
          </button>
          <motion.button
            type="button"
            onClick={() => setPublishOpen(true)}
            disabled={!canPublish}
            title={canPublish ? `Publish v${module.version}` : 'Run the reasoner — publish unlocks once validation passes'}
            animate={
              canPublish
                ? { boxShadow: ['0 0 0 0 rgba(99,102,241,0.0)', '0 0 14px 2px rgba(99,102,241,0.45)', '0 0 0 0 rgba(99,102,241,0.0)'] }
                : { boxShadow: '0 0 0 0 rgba(0,0,0,0)' }
            }
            transition={canPublish ? { duration: 1.8, repeat: Infinity } : { duration: 0.2 }}
            className="rounded-md bg-iris px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-iris-bright disabled:cursor-not-allowed disabled:opacity-40"
          >
            Publish v{module.version}
          </motion.button>
        </div>
      </div>

      {/* guest banner */}
      {!authLoading && !isAuthenticated && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-hairline bg-iris/10 px-4 py-1.5 text-[12px] text-text-secondary">
          <LogIn className="size-3.5 text-text-accent" />
          Browsing as guest — edits may require an Ontologist session.
          <Link to={LOGIN_PATH} className="font-medium text-text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
        </div>
      )}

      {/* ================= 3-pane body ================= */}
      <div className="flex min-h-0 flex-1">
        {/* left: tree */}
        <aside className="w-[280px] shrink-0 border-r border-border-hairline bg-bg-panel">
          {classesQ.isLoading ? (
            <div className="space-y-1.5 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-7 animate-pulse rounded-md bg-bg-panel-raised/70" />
              ))}
            </div>
          ) : classesQ.error ? (
            <div className="p-4 text-center">
              <p className="text-[12.5px] text-risk">{classesQ.error.message}</p>
              <button type="button" onClick={() => classesQ.refetch()} className="mt-2 rounded border border-border-hairline px-2.5 py-1 text-[12px] text-text-primary">
                Retry
              </button>
            </div>
          ) : (
            <ClassTree
              classes={classes}
              moduleColor={module.color}
              modulePrefix={module.prefix}
              selectedIri={selectedClassIri}
              flashIri={flashIri}
              onSelect={(iri) => {
                setSelectedClassIri(iri);
                setSelectedPropIri(null);
              }}
              onAddClass={(parent) => {
                setPrefillParent(parent ?? null);
                setNewClassOpen(true);
              }}
              onDeprecate={setDeprecateTarget}
              onAddPropertyInfo={() =>
                pushToast('info', 'Properties are declared inside the New class flow (domain = the new class).')
              }
            />
          )}
        </aside>

        {/* center: canvas */}
        <section className="relative min-w-0 flex-1 bg-bg-void">
          {view === 'graph' && (
            <>
              <GraphCanvas
                nodes={graphNodes}
                edges={graphEdges}
                className="h-full rounded-none border-0"
                onNodeClick={(id) => {
                  const cls = classes.find((c) => c.iri === id);
                  if (cls) {
                    setSelectedClassIri(id);
                    setSelectedPropIri(null);
                  }
                }}
              />
              {/* floating overlay pill */}
              <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full border border-border-hairline bg-bg-panel/80 px-1.5 py-1 backdrop-blur">
                <Waypoints className="mx-1 size-3.5 text-text-muted" />
                <OverlayToggle label="instances" on={showInstances} onClick={() => setShowInstances((v) => !v)} />
                <OverlayToggle
                  label="inferred"
                  on={showInferred}
                  disabled={!reasoner}
                  title={reasoner ? 'Overlay inferred subclass links' : 'Run the reasoner first'}
                  onClick={() => setShowInferred((v) => !v)}
                />
                <span className="mx-1 hidden font-mono text-[10px] text-text-muted sm:inline">
                  {graphNodes.length} nodes · {graphEdges.length} edges
                </span>
              </div>
              {classes.length === 0 && !classesQ.isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <img src="/empty-graph.svg" alt="" className="size-28 opacity-70" />
                  <p className="text-[13px] text-text-secondary">This module has no classes yet</p>
                  <button
                    type="button"
                    onClick={() => setNewClassOpen(true)}
                    className="rounded-md bg-iris px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-iris-bright"
                  >
                    Create the first class
                  </button>
                </div>
              )}
            </>
          )}

          {view === 'tree' && (
            <div className="h-full overflow-y-auto p-6">
              <div className="mb-3 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
                {module.name} · class hierarchy
              </div>
              <div className="font-mono text-[13px] text-text-secondary">
                <span className="text-text-muted">owl:Thing</span>
                {renderOutline(outlineTree)}
              </div>
            </div>
          )}

          {view === 'diff' && fromVersion && toVersion && (
            <DiffView
              diff={diffQ.data as unknown as DiffResult | undefined}
              loading={diffQ.isLoading}
              error={diffQ.error?.message ?? null}
              classes={classes}
              versions={versions}
              fromVersion={fromVersion}
              toVersion={toVersion}
              onFromChange={setFromVersion}
              onToChange={setToVersion}
              onSelectClass={locate}
            />
          )}

          {view === 'turtle' && (
            <TurtleView
              module={module}
              content={turtleQ.data?.content}
              loading={turtleQ.isLoading}
              error={turtleQ.error?.message ?? null}
            />
          )}
        </section>

        {/* right: inspector */}
        <aside className="w-[360px] shrink-0 border-l border-border-hairline bg-bg-panel">
          <Inspector
            module={module}
            classes={classes}
            properties={properties}
            selectedClassIri={selectedClassIri}
            selectedPropIri={selectedPropIri}
            onSelectClass={locate}
            onSelectProperty={setSelectedPropIri}
            onDeprecate={setDeprecateTarget}
            onExport={doExport}
            exporting={exporting}
          />
        </aside>
      </div>

      {/* ================= bottom console ================= */}
      <ConsoleBar
        result={reasoner}
        running={reasonerQ.isFetching}
        lastRunAt={lastRunAt}
        showInferred={showInferred}
        onToggleInferred={setShowInferred}
        onLocate={locate}
      />

      {/* ================= dialogs ================= */}
      <NewClassDialog
        open={newClassOpen}
        onOpenChange={setNewClassOpen}
        moduleKey={moduleKey}
        modulePrefix={module.prefix}
        moduleColor={module.color}
        classes={classes}
        prefillParentIri={prefillParent}
        onCreated={onCreated}
      />

      {/* deprecate confirm */}
      <Dialog open={!!deprecateTarget} onOpenChange={(o) => !o && setDeprecateTarget(null)}>
        <DialogContent className="max-w-md border-border-hairline bg-bg-panel text-text-primary">
          <DialogHeader>
            <DialogTitle className="font-display text-[17px] font-semibold tracking-tight">
              Deprecate <span className="font-mono text-[15px] text-warn">{deprecateTarget?.iri}</span>?
            </DialogTitle>
            <DialogDescription className="text-[12.5px] text-text-muted">
              The class remains for backward compatibility but is refused as a parent for new classes.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 font-mono text-[11.5px] text-text-secondary">
            impact · {deprecateTarget?.instanceCount ?? 0} instances affected · 0 subclasses invalidated
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeprecateTarget(null)}
              className="rounded-md px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deprecateClass.isPending}
              onClick={() => deprecateTarget && deprecateClass.mutate({ classIri: deprecateTarget.iri })}
              className="flex items-center gap-1.5 rounded-md border border-risk/50 bg-risk/10 px-3 py-1.5 text-[13px] font-medium text-risk transition-colors hover:bg-risk/20 disabled:opacity-50"
            >
              {deprecateClass.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Deprecate
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* publish confirm */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-md border-border-hairline bg-bg-panel text-text-primary">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-tight">
              <Rocket className="size-4 text-iris-bright" /> Publish {module.name} v{module.version}
            </DialogTitle>
            <DialogDescription className="text-[12.5px] text-text-muted">
              Validation passed — {reasoner?.warnings.length ?? 0} warnings, {reasoner?.issues.length ?? 0} violations.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={publishNotes}
            onChange={(e) => setPublishNotes(e.target.value)}
            rows={3}
            placeholder="Version notes (optional)…"
            className="w-full resize-none rounded-md border border-border-hairline bg-bg-inset px-2.5 py-2 text-[13px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-border-glow"
          />
          {versions[0]?.changelog && (
            <div className="rounded-md border border-border-hairline bg-bg-inset px-3 py-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Latest changelog</div>
              <p className="text-[12px] leading-snug text-text-secondary">{versions[0].changelog}</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setPublishOpen(false)}
              className="rounded-md px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setPublishOpen(false);
                pushToast('success', `Published v${module.version} — edits publish atomically in this build.`);
              }}
              className="rounded-md bg-iris px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-iris-bright"
            >
              Confirm publish
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= toasts ================= */}
      <div className="pointer-events-none fixed bottom-12 right-4 z-50 flex w-80 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-xl backdrop-blur',
                t.kind === 'success' && 'border-ok/40 bg-bg-panel-raised/95',
                t.kind === 'error' && 'border-risk/40 bg-bg-panel-raised/95',
                t.kind === 'info' && 'border-info/40 bg-bg-panel-raised/95',
                t.kind === 'auth' && 'border-iris/50 bg-bg-panel-raised/95',
              )}
            >
              {t.kind === 'success' && <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />}
              {t.kind === 'error' && <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-risk" />}
              {t.kind === 'info' && <StatusDot status="info" pulse={false} className="mt-1.5" />}
              {t.kind === 'auth' && <LogIn className="mt-0.5 size-3.5 shrink-0 text-text-accent" />}
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-snug text-text-primary">{t.msg}</p>
                {t.kind === 'auth' && (
                  <Link
                    to={LOGIN_PATH}
                    className="mt-1 inline-flex items-center gap-1 rounded bg-iris px-2 py-0.5 text-[11px] font-medium text-white hover:bg-iris-bright"
                  >
                    Sign in
                  </Link>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                className="shrink-0 text-text-muted hover:text-text-primary"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function OverlayToggle({
  label,
  on,
  onClick,
  disabled,
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded-full px-2 py-0.5 font-mono text-[10.5px] transition-colors duration-150',
        on ? 'bg-iris/20 text-text-accent' : 'text-text-muted hover:text-text-primary',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {label}
    </button>
  );
}
