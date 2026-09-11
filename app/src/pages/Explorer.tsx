import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Play, Search, ShieldAlert, Square, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { getModule, MODULES, type ModuleKey } from '@/lib/modules';
import { ModuleBadge } from '@/components/ui/module-badge';
import { NlQueryBar } from '@/components/explorer/NlQueryBar';
import { TranslationTrail } from '@/components/explorer/TranslationTrail';
import { QueryEditor } from '@/components/explorer/QueryEditor';
import { ResultsPanel } from '@/components/explorer/ResultsPanel';
import { ExplorerGraph, type ExplorerLayout } from '@/components/explorer/ExplorerGraph';
import { NodeDrawer } from '@/components/explorer/NodeDrawer';
import { QueryHistoryRail } from '@/components/explorer/QueryHistoryRail';
import type { ExecResult, ExplorerEdge, ExplorerNode, HistoryEntry, TranslateOk } from '@/components/explorer/types';

const PLACEHOLDERS = [
  'Which employees signed contracts governed by policies with open audit findings?',
  'Show spend without a cost center',
  'What changed in Logistics this week?',
];

const CHIPS = [
  'Which employees signed contracts governed by policies with open audit findings?',
  'Which vendors have payments but no active contract?',
  'Spend by cost center this quarter',
  'Show spend without a cost center',
  'Orphan employees without managers',
  'Controls lacking evidence 90+ days',
];

const MODULE_KEYS = new Set<string>(['hr', 'legal', 'compliance', 'finance', 'logistics', 'twin']);
const HISTORY_KEY = 'ontos-explorer-history';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

interface Waypoint {
  module: ModuleKey | null;
  caption: string;
}

export default function Explorer() {
  const utils = trpc.useUtils();
  const stats = trpc.graph.stats.useQuery();
  const execute = trpc.nlq.execute.useMutation();

  /* ── NL query state ─────────────────────────────────────────── */
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [stage, setStage] = useState(-1);
  const [translation, setTranslation] = useState<TranslateOk | null>(null);
  const [generation, setGeneration] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [suggests, setSuggests] = useState<string[] | null>(null);
  const [sparqlEdit, setSparqlEdit] = useState('');
  const [exec, setExec] = useState<ExecResult | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [selectedIri, setSelectedIri] = useState<string | null>(null);
  const [drawerIri, setDrawerIri] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  /* ── Browse / canvas state ──────────────────────────────────── */
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [browseCenter, setBrowseCenter] = useState<string | null>(null);
  const [depth, setDepth] = useState<1 | 2>(2);
  const [layout, setLayout] = useState<ExplorerLayout>('force');
  const [hidden, setHidden] = useState<Set<ModuleKey>>(new Set());
  const [flow, setFlow] = useState(false);
  const [tourOn, setTourOn] = useState(false);
  const [tourIdx, setTourIdx] = useState(0);
  const [focusSignal, setFocusSignal] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const searchQ = trpc.graph.searchNodes.useQuery(
    { q: debounced, limit: 12 },
    { enabled: debounced.length > 0 },
  );
  const hubQ = trpc.graph.searchNodes.useQuery({ q: 'a', limit: 1 });
  const subQ = trpc.graph.getSubgraph.useQuery(
    { centerIri: browseCenter ?? '', depth, limit: 140 },
    { enabled: !!browseCenter && !exec },
  );

  // Set default browse center once hub data arrives
  if (!browseCenter && hubQ.data?.[0]) {
    setBrowseCenter(hubQ.data[0].iri);
  }

  const persistHistory = (entries: HistoryEntry[]) => {
    setHistory(entries);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {
      /* storage unavailable */
    }
  };

  const pushHistory = (q: string, intent?: string, sparql?: string) => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      question: q,
      intent,
      sparql,
      ts: Date.now(),
      saved: false,
    };
    persistHistory([entry, ...history].slice(0, 40));
  };

  /* ── Ask pipeline ───────────────────────────────────────────── */
  const runQuery = async (sparql: string) => {
    setExecError(null);
    const t0 = performance.now();
    try {
      const res = (await execute.mutateAsync({ sparql })) as ExecResult;
      setElapsed(Math.max(1, Math.round(performance.now() - t0)));
      setExec(res);
    } catch (err) {
      setExec(null);
      setExecError(err instanceof Error ? err.message : 'Query refused');
    }
  };

  const ask = async (raw?: string) => {
    const q = (raw ?? question).trim();
    if (!q || asking) return;
    setQuestion(q);
    setAsking(true);
    setStage(-1);
    setTranslation(null);
    setRefusal(null);
    setSuggests(null);
    setExec(null);
    setExecError(null);
    try {
      const res = await utils.nlq.translate.fetch({ question: q });
      if (!res.recognized) {
        if ('refusal' in res && res.refusal) {
          setRefusal(res.refusal);
          pushHistory(q);
        } else {
          setSuggests('suggestions' in res ? (res.suggestions ?? []) : []);
          pushHistory(q);
        }
        return;
      }
      const ok = res as TranslateOk;
      setTranslation(ok);
      setSparqlEdit(ok.sparql ?? '');
      setGeneration((g) => g + 1);
      for (let s = 0; s <= 4; s++) {
        setStage(s);
        await delay(s === 4 ? 200 : 170);
      }
      pushHistory(q, ok.intent, ok.sparql);
      void runQuery(ok.sparql ?? '');
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setAsking(false);
    }
  };

  const restore = (entry: HistoryEntry) => {
    setExec(null);
    void ask(entry.question);
  };

  /* ── Tour waypoints from real stats ─────────────────────────── */
  const waypoints = useMemo<Waypoint[]>(() => {
    const bm = stats.data?.byModule;
    const n = (k: string) => bm?.[k]?.nodes ?? 0;
    return [
      { module: 'hr', caption: `${n('hr')} people, contracts & org units` },
      { module: 'legal', caption: `${n('legal')} contracts, clauses & jurisdictions` },
      { module: 'compliance', caption: `${n('compliance')} policies, controls & findings` },
      { module: 'finance', caption: `${n('finance')} transactions, vendors & cost centers` },
      { module: 'logistics', caption: `${n('logistics')} shipments, routes & carriers` },
      { module: null, caption: `the full Acme graph — ${stats.data?.totals.nodes ?? '…'} nodes · ${stats.data?.totals.edges ?? '…'} edges` },
    ];
  }, [stats.data]);

  useEffect(() => {
    if (!tourOn) return;
    const iv = setInterval(() => {
      setTourIdx((i) => (i + 1) % waypoints.length);
      setFocusSignal((s) => s + 1);
    }, 3400);
    return () => clearInterval(iv);
  }, [tourOn, waypoints.length]);

  const focusModule = tourOn ? waypoints[tourIdx]?.module ?? null : null;

  /* ── Canvas data: answer subgraph wins over browse subgraph ─── */
  const canvasData = useMemo(() => {
    const src = exec && exec.subgraph.nodes.length > 0 ? exec.subgraph : (subQ.data ?? null);
    if (!src) return { nodes: [] as ExplorerNode[], edges: [] as ExplorerEdge[] };
    const nodes = (src.nodes as ExplorerNode[]).filter(
      (n) => !hidden.has(MODULE_KEYS.has(n.moduleKey) ? (n.moduleKey as ModuleKey) : 'custom'),
    );
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (src.edges as ExplorerEdge[]).filter((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId));
    return { nodes, edges };
  }, [exec, subQ.data, hidden]);

  const toggleModule = (k: ModuleKey) => {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const openNode = (iri: string) => {
    setSelectedIri(iri);
    setDrawerIri(iri);
  };

  const navigateNode = (iri: string) => {
    setDrawerIri(iri);
    setSelectedIri(iri);
    setExec(null); // switch to browse mode centered on the neighbor
    setBrowseCenter(iri);
  };

  const communityChips = MODULES.map((m) => ({
    m,
    count: stats.data?.byModule?.[m.key]?.nodes ?? 0,
  }));

  return (
    <div className="-m-6 flex h-[calc(100dvh-3.5rem)] flex-col lg:-m-8">
      {/* Section 1 — NL query bar */}
      <NlQueryBar
        question={question}
        onQuestionChange={setQuestion}
        onAsk={() => void ask()}
        asking={asking}
        placeholders={PLACEHOLDERS}
        chips={CHIPS}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* Section 5 — history rail */}
        <QueryHistoryRail
          entries={history}
          onRestore={restore}
          onToggleSave={(id) =>
            persistHistory(history.map((e) => (e.id === id ? { ...e, saved: !e.saved } : e)))
          }
        />

        <div className="grid min-h-0 flex-1 grid-cols-1 pl-12 lg:grid-cols-[46%_54%]">
          {/* Left pane — translation, query, results */}
          <div className="min-h-0 space-y-3 overflow-y-auto border-b border-border-hairline p-4 lg:border-b-0 lg:border-r">
            {/* Refusal guard state */}
            <AnimatePresence>
              {refusal && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="rounded-xl border border-risk/40 border-l-2 border-l-risk bg-risk/10 px-4 py-3"
                >
                  <div className="flex items-center gap-2 font-mono text-[12px] font-medium text-risk">
                    <ShieldAlert className="size-4" /> Request refused — read-only guard
                  </div>
                  <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-risk/80">{refusal}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* No-match suggestions */}
            <AnimatePresence>
              {suggests && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="rounded-xl border border-border-hairline bg-bg-panel px-4 py-3"
                >
                  <div className="font-mono text-[12px] text-text-secondary">
                    No intent matched — the translator recognizes ~12 ontology-grounded shapes. Try:
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggests.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void ask(s)}
                        className="rounded-full border border-border-hairline px-2.5 py-1 font-mono text-[11.5px] text-text-secondary transition-colors hover:border-border-glow hover:bg-bg-panel-raised hover:text-text-primary"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Translation trail */}
            {translation && (
              <TranslationTrail
                stage={stage}
                grounding={translation.grounding}
                validatedExtra={exec ? `${exec.rows.length} result rows` : undefined}
              />
            )}
            {asking && !translation && (
              <div className="flex items-center gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5 font-mono text-[12px] text-text-muted">
                <Loader2 className="size-3.5 animate-spin text-iris-bright" /> translating against the ontology …
              </div>
            )}

            {/* Generated query */}
            {translation?.sparql && (
              <QueryEditor
                sparql={sparqlEdit}
                cypher={translation.cypher ?? ''}
                generation={generation}
                onSparqlChange={setSparqlEdit}
                onRun={() => void runQuery(sparqlEdit)}
                running={execute.isPending}
              />
            )}
            {translation?.explanation && (
              <p className="px-1 font-mono text-[11.5px] leading-relaxed text-text-muted">
                <span className="text-info">explain:</span> {translation.explanation}
              </p>
            )}

            {/* Results */}
            <ResultsPanel
              exec={exec}
              running={execute.isPending}
              elapsedMs={elapsed}
              execError={execError}
              onSelectIri={(iri) => setSelectedIri(iri)}
              onOpenNode={openNode}
            />
          </div>

          {/* Right pane — living graph canvas */}
          <div className="relative min-h-[420px] lg:min-h-0">
            {/* Browse toolbar */}
            <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
              <div className="relative">
                <div className="flex h-8 items-center gap-2 rounded-lg border border-border-hairline bg-bg-panel/90 px-2.5 backdrop-blur">
                  <Search className="size-3.5 text-text-muted" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search nodes…"
                    className="w-40 bg-transparent font-mono text-[11.5px] text-text-primary outline-none placeholder:text-text-muted"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="text-text-muted hover:text-text-primary">
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                {debounced && searchQ.data && (
                  <div className="absolute left-0 top-9 z-20 max-h-64 w-72 overflow-auto rounded-lg border border-border-hairline bg-bg-panel-raised shadow-xl">
                    {searchQ.data.length === 0 && (
                      <div className="px-3 py-2.5 font-mono text-[11px] text-text-muted">no nodes match “{debounced}”</div>
                    )}
                    {searchQ.data.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          setExec(null);
                          setBrowseCenter(n.iri);
                          setSelectedIri(n.iri);
                          setSearch('');
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-panel"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: getModule(MODULE_KEYS.has(n.moduleKey) ? (n.moduleKey as ModuleKey) : 'custom').color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">{n.label}</span>
                        <span className="shrink-0 font-mono text-[9.5px] text-text-muted">{n.classIri}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Depth toggle */}
              <div className="flex overflow-hidden rounded-lg border border-border-hairline bg-bg-panel/90 backdrop-blur">
                {([1, 2] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDepth(d)}
                    className={cn(
                      'px-2 py-1.5 font-mono text-[10px] transition-colors',
                      depth === d ? 'bg-iris/15 text-text-accent' : 'text-text-muted hover:text-text-secondary',
                    )}
                  >
                    depth {d}
                  </button>
                ))}
              </div>

              {exec && (
                <button
                  type="button"
                  onClick={() => setExec(null)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/15 px-2.5 font-mono text-[10.5px] text-text-accent backdrop-blur transition-colors hover:bg-iris/25"
                >
                  <X className="size-3" /> clear answer · back to browse
                </button>
              )}
            </div>

            {/* Floating pill: layout + module toggles + provenance */}
            <div className="absolute left-3 top-14 z-10 flex flex-wrap items-center gap-1.5 rounded-xl border border-border-hairline bg-bg-panel/90 px-2 py-1.5 backdrop-blur">
              {(['force', 'radial', 'hierarchy', 'timeline'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLayout(l)}
                  className={cn(
                    'rounded-md px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors',
                    layout === l ? 'bg-iris/15 text-text-accent' : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {l}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border-hairline" />
              {communityChips.map(({ m, count }) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleModule(m.key)}
                  className={cn('transition-opacity duration-200', hidden.has(m.key) && 'opacity-30')}
                  title={`${m.name} — ${count} nodes`}
                >
                  <ModuleBadge module={m.key} />
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border-hairline" />
              <button
                type="button"
                onClick={() => setFlow((f) => !f)}
                className={cn(
                  'rounded-md px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors',
                  flow ? 'bg-info/15 text-info' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                provenance
              </button>
            </div>

            {/* Tour button */}
            <button
              type="button"
              onClick={() => {
                if (tourOn) {
                  setTourOn(false);
                } else {
                  setTourIdx(0);
                  setTourOn(true);
                  setFocusSignal((s) => s + 1);
                }
              }}
              className="absolute bottom-3 left-12 z-10 ml-10 flex items-center gap-1.5 rounded-lg border border-border-hairline bg-bg-panel/90 px-2.5 py-2 font-mono text-[10px] text-text-secondary backdrop-blur transition-colors hover:border-border-glow hover:text-text-primary"
            >
              {tourOn ? <Square className="size-3" /> : <Play className="size-3" />}
              {tourOn ? 'stop tour' : 'cinematic tour'}
            </button>

            {/* Tour caption */}
            <AnimatePresence>
              {tourOn && waypoints[tourIdx] && (
                <motion.div
                  key={tourIdx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-border-hairline bg-bg-void/85 px-3 py-1.5 font-mono text-[11px] text-text-secondary backdrop-blur"
                >
                  <span className="text-iris-bright">{tourIdx + 1}/{waypoints.length}</span>{' '}
                  {waypoints[tourIdx].caption}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Canvas */}
            {canvasData.nodes.length > 0 ? (
              <ExplorerGraph
                nodes={canvasData.nodes}
                edges={canvasData.edges}
                className="absolute inset-0"
                layout={layout}
                provenanceFlow={flow}
                focusModule={focusModule}
                focusSignal={focusSignal}
                selectedIri={selectedIri}
                onNodeClick={openNode}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-void">
                {subQ.isLoading || hubQ.isLoading ? (
                  <>
                    <Loader2 className="size-5 animate-spin text-iris-bright" />
                    <span className="font-mono text-[12px] text-text-muted">loading the living graph …</span>
                  </>
                ) : (
                  <>
                    <motion.img
                      src="/empty-graph.svg"
                      alt=""
                      className="size-20 opacity-80"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <span className="font-mono text-[12px] text-text-muted">
                      Search for a node above, or ask a question to light up the graph.
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Community count legend */}
            <div className="absolute right-3 top-3 z-10 hidden flex-col items-end gap-1 xl:flex">
              {communityChips.map(({ m, count }) => (
                <span key={m.key} className="font-mono text-[9.5px] uppercase tracking-[0.08em]" style={{ color: m.color }}>
                  {m.label} · {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Node drawer */}
      <NodeDrawer iri={drawerIri} onClose={() => setDrawerIri(null)} onNavigate={navigateNode} />
    </div>
  );
}
