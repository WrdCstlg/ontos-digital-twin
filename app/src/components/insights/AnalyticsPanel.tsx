import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleDot, Play, Search } from 'lucide-react';
import { Scatter, ScatterChart, Tooltip as RTooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { MODULES, getModule, moduleAlpha, type ModuleKey } from '@/lib/modules';
import { ModuleBadge } from '@/components/ui/module-badge';
import { IRIChip } from '@/components/ui/iri-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EvidenceCanvas, type EvidenceEdge, type EvidenceNode } from './EvidenceCanvas';
import type { KgNodeRow, SubgraphResult } from './types';
import { EXPECTED_RELATION, formatTimestamp } from './ruleMeta';
import { betweenness, buildAdjacency, communities, pagerank, shortestPath } from './graphAnalytics';

type TabKey = 'centrality' | 'communities' | 'paths' | 'orphans';

const TABS: { key: TabKey; label: string; blurb: string; algorithms: string[] }[] = [
  {
    key: 'centrality',
    label: 'Centrality',
    blurb: 'Centrality ranks structurally important nodes. Betweenness scores how many shortest paths flow through a node — high scores are single points of failure. PageRank instead rewards nodes attached to other well-connected nodes.',
    algorithms: ['betweenness', 'pagerank'],
  },
  {
    key: 'communities',
    label: 'Communities',
    blurb: 'Connected components surface clusters that hang together through the graph — unexpected cross-module components often signal shadow processes.',
    algorithms: ['connected-components'],
  },
  {
    key: 'paths',
    label: 'Paths',
    blurb: 'Shortest-path playground: pick two instances and the engine walks the graph between them, counting hops across module boundaries.',
    algorithms: ['bfs'],
  },
  {
    key: 'orphans',
    label: 'Orphans',
    blurb: 'Island nodes: instances missing the relationship an axiom expects for their class — unbooked transactions, managerless people, detached org units.',
    algorithms: ['axiom-scan'],
  },
];

/**
 * Centrality scores span very different scales — normalized betweenness sits
 * around 1e-2 while PageRank over a few hundred nodes sits around 1e-3 — so a
 * fixed 2-decimal format would flatten a whole column to "0.00".
 */
function formatScore(value: number): string {
  if (value === 0) return '0.00';
  return value >= 0.01 ? value.toFixed(2) : value.toPrecision(2);
}

/* ── Endpoint picker for the Paths tab ────────────────────────── */

function EndpointPicker({
  label,
  value,
  onPick,
}: {
  label: string;
  value: KgNodeRow | null;
  onPick: (n: KgNodeRow | null) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const search = trpc.graph.searchNodes.useQuery(
    { q: debounced, limit: 6 },
    { enabled: debounced.trim().length >= 2 },
  );

  return (
    <div className="relative">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</span>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-iris/40 bg-iris/10 px-2.5 py-1.5">
          <IRIChip iri={value.iri} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">{value.label}</span>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="font-mono text-[11px] text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search instances…"
            className="w-full bg-transparent font-mono text-[12px] text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      )}
      {open && !value && search.data && search.data.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border-hairline bg-bg-panel-raised shadow-xl">
          {(search.data as KgNodeRow[]).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onMouseDown={() => {
                  onPick(n);
                  setOpen(false);
                  setQ('');
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-bg-panel"
              >
                <IRIChip iri={n.iri} />
                <span className="truncate text-[12px] text-text-secondary">{n.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────────── */

export function AnalyticsPanel({ hubIri }: { hubIri: string | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<TabKey>('centrality');
  const [algorithm, setAlgorithm] = useState('betweenness');
  const [scope, setScope] = useState<Set<ModuleKey>>(new Set(MODULES.map((m) => m.key)));
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState(0);
  const [pathFrom, setPathFrom] = useState<KgNodeRow | null>(null);
  const [pathTo, setPathTo] = useState<KgNodeRow | null>(null);
  const [sortKey, setSortKey] = useState<'iri' | 'moduleKey' | 'createdAt'>('iri');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const sample = trpc.graph.getSubgraph.useQuery(
    { centerIri: hubIri ?? '', depth: 2, limit: 400 },
    { enabled: !!hubIri, staleTime: 120_000, retry: false },
  );
  const data = sample.data as SubgraphResult | undefined;

  // Module scope filter
  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as KgNodeRow[], edges: [] as SubgraphResult['edges'] };
    const ns = data.nodes.filter((n) => scope.has((n.moduleKey as ModuleKey) || 'custom'));
    const ids = new Set(ns.map((n) => n.id));
    return { nodes: ns, edges: data.edges.filter((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId)) };
  }, [data, scope]);

  const adj = useMemo(() => buildAdjacency(nodes, edges), [nodes, edges]);

  // Computes — run over the filtered window
  const centrality = useMemo(() => {
    if (tab !== 'centrality' || nodes.length === 0) return [];
    const scores = algorithm === 'pagerank' ? pagerank(nodes, adj) : betweenness(nodes, adj);
    return nodes
      .map((n) => ({ node: n, score: scores.get(n.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [tab, nodes, adj, algorithm]);

  const comms = useMemo(() => (tab === 'communities' && nodes.length ? communities(nodes, adj) : []), [tab, nodes, adj]);

  const path = useMemo(() => {
    if (tab !== 'paths' || !pathFrom || !pathTo) return null;
    return shortestPath(adj, pathFrom.id, pathTo.id);
  }, [tab, adj, pathFrom, pathTo]);

  const orphans = useMemo(() => {
    if (tab !== 'orphans') return [];
    const expected = new Map<string, string>(Object.entries(EXPECTED_RELATION));
    const rows = nodes.filter((n) => {
      const pred = expected.get(n.classIri);
      if (!pred) return false;
      return !edges.some(
        (e) =>
          e.predicateIri === pred && (e.fromNodeId === n.id || e.toNodeId === n.id),
      );
    });
    const dir = sortDir;
    return rows
      .sort((a, b) => {
        const av = sortKey === 'createdAt' ? String(a.createdAt) : sortKey === 'iri' ? a.iri : a.moduleKey;
        const bv = sortKey === 'createdAt' ? String(b.createdAt) : sortKey === 'iri' ? b.iri : b.moduleKey;
        return av < bv ? -dir : av > bv ? dir : 0;
      })
      .slice(0, 50);
  }, [tab, nodes, edges, sortKey, sortDir]);

  const run = () => {
    setRunning(true);
    setRanAt((r) => r + 1);
  };
  // auto-run once the sample first arrives
  if (data && ranAt === 0) {
    setRunning(true);
    setRanAt(1);
  }

  const activeTab = TABS.find((t) => t.key === tab)!;
  const toggleScope = (k: ModuleKey) =>
    setScope((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <section className="overflow-hidden rounded-xl border border-border-hairline bg-bg-panel">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-bg-panel-raised/50"
      >
        <CircleDot className="size-4 text-iris-bright" />
        <span className="font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">
          Graph analytics
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {hubIri ? `window: depth 2 · centered at ${hubIri}` : 'waiting for graph evidence…'}
        </span>
        <span className="ml-auto font-mono text-[11px] text-text-muted">{collapsed ? 'expand ▾' : 'collapse ▴'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-border-hairline">
          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border-hairline px-4 pt-3" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => {
                  setTab(t.key);
                  setAlgorithm(t.algorithms[0]);
                }}
                className={cn(
                  'relative rounded-t-lg px-3.5 py-2 text-[13px] transition-colors',
                  tab === t.key ? 'text-text-accent' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {t.label}
                {tab === t.key && (
                  <motion.span
                    layoutId="analytics-tab"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-iris"
                  />
                )}
              </button>
            ))}
          </div>

          {!hubIri ? (
            <div className="flex h-40 items-center justify-center text-[13px] text-text-muted">
              Analytics need at least one finding with graph evidence.
            </div>
          ) : sample.isLoading ? (
            <div className="p-5">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : sample.isError || !data ? (
            <div className="flex h-40 items-center justify-center text-[13px] text-text-muted">
              The analysis window could not be loaded.
            </div>
          ) : (
            <div className="grid gap-5 p-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              {/* Left: explanation + config */}
              <div className="space-y-4">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={tab}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-[13px] leading-[1.5] text-text-secondary"
                  >
                    {activeTab.blurb}
                  </motion.p>
                </AnimatePresence>

                <div>
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                    Algorithm
                  </span>
                  <Select value={algorithm} onValueChange={setAlgorithm}>
                    <SelectTrigger className="w-full border-border-hairline bg-bg-inset font-mono text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {activeTab.algorithms.map((a) => (
                        <SelectItem key={a} value={a} className="font-mono text-[12px]">
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                    Module scope
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {MODULES.map((m) => {
                      const on = scope.has(m.key);
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => toggleScope(m.key)}
                          className={cn('transition-opacity', !on && 'opacity-35 grayscale')}
                          aria-pressed={on}
                        >
                          <ModuleBadge module={m.key} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={run}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/15 px-3.5 py-2 text-[13px] font-medium text-text-accent transition-colors hover:bg-iris/25 disabled:opacity-50"
                >
                  <Play className="size-3.5" /> {running ? 'Scanning…' : 'Run'}
                </button>

                <p className="font-mono text-[10.5px] leading-relaxed text-text-muted">
                  {nodes.length} nodes · {edges.length} edges in scope
                  <br />
                  computed client-side over the fetched window
                </p>
              </div>

              {/* Right: visualization */}
              <div className="relative min-h-[280px] overflow-hidden rounded-xl border border-border-hairline bg-bg-inset p-4">
                {/* iris scanning sweep while running */}
                {running && (
                  <motion.div
                    key={ranAt}
                    className="pointer-events-none absolute inset-y-0 z-10 w-[3px] bg-gradient-to-b from-transparent via-iris-bright to-transparent"
                    initial={{ left: '0%' }}
                    animate={{ left: '100%' }}
                    transition={{ duration: 1, ease: 'linear' }}
                    onAnimationComplete={() => setRunning(false)}
                    aria-hidden
                  />
                )}

                <AnimatePresence mode="wait">
                  <motion.div
                    key={tab + ranAt}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: running ? 0.35 : 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="h-full"
                  >
                    {tab === 'centrality' && (
                      <ul className="space-y-2">
                        {centrality.map(({ node, score }, i) => {
                          const color = getModule((node.moduleKey as ModuleKey) || 'custom').color;
                          const max = centrality[0]?.score || 1;
                          return (
                            <li key={node.id} className="flex items-center gap-3">
                              <span className="w-52 shrink-0 truncate font-mono text-[12px] text-text-secondary">
                                {node.iri}
                                <span className="text-text-muted"> · {node.label}</span>
                              </span>
                              <div className="h-4 min-w-0 flex-1 rounded-sm bg-bg-panel">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: running ? 0 : `${Math.max(3, (score / max) * 100)}%` }}
                                  transition={{ duration: 0.6, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                                  className="h-full rounded-sm"
                                  style={{ backgroundColor: moduleAlpha(color, 0.7) }}
                                />
                              </div>
                              <span className="w-16 shrink-0 text-right font-mono text-[12px] tabular-nums text-text-primary">
                                {formatScore(score)}
                              </span>
                            </li>
                          );
                        })}
                        {centrality.length === 0 && (
                          <li className="pt-16 text-center text-[13px] text-text-muted">No nodes in scope.</li>
                        )}
                      </ul>
                    )}

                    {tab === 'communities' && (
                      <div className="h-[280px]">
                        <ScatterChart width={560} height={270} style={{ width: '100%', height: '100%' }} margin={{ top: 10, right: 16, bottom: 0, left: -20 }}>
                          <XAxis type="number" dataKey="x" hide domain={['dataMin - 10', 'dataMax + 10']} />
                          <YAxis type="number" dataKey="y" hide domain={['dataMin - 10', 'dataMax + 10']} />
                          <ZAxis type="number" dataKey="z" range={[80, 800]} />
                          <RTooltip
                            cursor={false}
                            content={({ payload }) => {
                              const p = payload?.[0]?.payload as
                                | { members: number; cohesion: number; module: string }
                                | undefined;
                              if (!p) return null;
                              return (
                                <div className="rounded-lg border border-border-hairline bg-bg-panel-raised px-3 py-2 font-mono text-[11px] text-text-secondary">
                                  <div style={{ color: getModule((p.module as ModuleKey) || 'custom').color }}>
                                    {p.module} community
                                  </div>
                                  <div>{p.members} members · cohesion {p.cohesion.toFixed(2)}</div>
                                </div>
                              );
                            }}
                          />
                          <Scatter
                            data={comms.map((c, i) => {
                              const angle = i * 2.399963;
                              const r = 14 + 14 * Math.sqrt(i + 1);
                              return {
                                x: r * Math.cos(angle),
                                y: r * Math.sin(angle),
                                z: c.memberIds.length,
                                members: c.memberIds.length,
                                cohesion: c.cohesion,
                                module: c.dominantModule,
                                fill: moduleAlpha(getModule((c.dominantModule as ModuleKey) || 'custom').color, 0.75),
                              };
                            })}
                            isAnimationActive={!running}
                          />
                        </ScatterChart>
                        <p className="text-center font-mono text-[10.5px] text-text-muted">
                          {comms.length} communities detected · bubble size = members
                        </p>
                      </div>
                    )}

                    {tab === 'paths' && (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <EndpointPicker label="From instance" value={pathFrom} onPick={setPathFrom} />
                          <EndpointPicker label="To instance" value={pathTo} onPick={setPathTo} />
                        </div>
                        {pathFrom && pathTo && !running && (
                          path ? (
                            <>
                              <p className="font-mono text-[12px] text-text-secondary">
                                shortest path: <span className="text-text-accent">{path.length - 1} hops</span> ·{' '}
                                {path.length} nodes
                              </p>
                              <EvidenceCanvas
                                nodes={path.map((id): EvidenceNode => {
                                  const n = nodes.find((x) => x.id === id)!;
                                  return { id: n.iri, label: n.label, module: (n.moduleKey as ModuleKey) || 'custom' };
                                })}
                                edges={path.slice(1).map((id, i): EvidenceEdge => {
                                  const a = nodes.find((x) => x.id === path[i])!;
                                  const b = nodes.find((x) => x.id === id)!;
                                  const e = edges.find(
                                    (ed) =>
                                      (ed.fromNodeId === a.id && ed.toNodeId === b.id) ||
                                      (ed.fromNodeId === b.id && ed.toNodeId === a.id),
                                  );
                                  return {
                                    id: `p${i}`,
                                    source: a.iri,
                                    target: b.iri,
                                    label: e ? e.predicateIri.split(':')[1] : '',
                                  };
                                })}
                                className="h-[220px]"
                              />
                            </>
                          ) : (
                            <p className="pt-10 text-center text-[13px] text-text-muted">
                              No path inside the loaded analysis window — widen the module scope or pick nodes closer
                              to <span className="font-mono">{hubIri}</span>.
                            </p>
                          )
                        )}
                        {(!pathFrom || !pathTo) && (
                          <p className="pt-10 text-center text-[13px] text-text-muted">
                            Pick two instances to walk the graph between them.
                          </p>
                        )}
                      </div>
                    )}

                    {tab === 'orphans' && (
                      <div className="max-h-[300px] overflow-y-auto">
                        <table className="w-full text-left">
                          <thead className="sticky top-0 bg-bg-inset">
                            <tr className="border-b border-border-hairline">
                              {(
                                [
                                  ['iri', 'Instance'],
                                  ['moduleKey', 'Module'],
                                  ['rel', 'Missing relationship'],
                                  ['createdAt', 'Detected at'],
                                ] as const
                              ).map(([key, label]) => (
                                <th
                                  key={key}
                                  onClick={() => {
                                    if (key === 'rel') return;
                                    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
                                    else {
                                      setSortKey(key);
                                      setSortDir(1);
                                    }
                                  }}
                                  className={cn(
                                    'px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted',
                                    key !== 'rel' && 'cursor-pointer select-none hover:text-text-secondary',
                                  )}
                                >
                                  {label}
                                  {sortKey === key && <span className="ml-1">{sortDir === 1 ? '▲' : '▼'}</span>}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {orphans.map((n) => (
                              <tr key={n.id} className="border-b border-border-hairline/60 transition-colors hover:bg-bg-panel-raised/50">
                                <td className="px-2 py-1.5 font-mono text-[12px] text-text-secondary">
                                  {n.iri}
                                  <span className="ml-1.5 text-text-muted">{n.label}</span>
                                </td>
                                <td className="px-2 py-1.5">
                                  <ModuleBadge module={(n.moduleKey as ModuleKey) || 'custom'} />
                                </td>
                                <td className="px-2 py-1.5 font-mono text-[12px] text-risk">
                                  {EXPECTED_RELATION[n.classIri] ?? '—'}
                                </td>
                                <td className="px-2 py-1.5 font-mono text-[11.5px] text-text-muted">
                                  {formatTimestamp(n.createdAt)}
                                </td>
                              </tr>
                            ))}
                            {orphans.length === 0 && (
                              <tr>
                                <td colSpan={4} className="px-2 py-10 text-center text-[13px] text-text-muted">
                                  No island nodes in the current window and scope.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default AnalyticsPanel;
