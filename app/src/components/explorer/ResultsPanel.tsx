import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Braces, Copy, Download, ListTree, Loader2, Table2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { getModule, type ModuleKey } from '@/lib/modules';
import GraphCanvas from '@/components/graph/GraphCanvas';
import type { GraphEdge, GraphNode } from '@/components/graph/GraphCanvas';
import type { ExecResult } from './types';

export interface ResultsPanelProps {
  exec: ExecResult | null;
  running: boolean;
  elapsedMs: number | null;
  execError: string | null;
  /** Select + pulse a node on the canvas (row click) */
  onSelectIri: (iri: string) => void;
  /** Open the provenance drawer (cell trace) */
  onOpenNode: (iri: string) => void;
}

type Tab = 'table' | 'chart' | 'subgraph' | 'raw';

const MODULE_KEYS: ModuleKey[] = ['hr', 'legal', 'compliance', 'finance', 'logistics', 'custom'];

function isTraceableIri(col: string, v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (/iri$/i.test(col) && /^[a-z][a-z0-9]{1,5}:\S+/.test(v)) return true;
  // compact IRI with a path segment, e.g. "fin:Transaction/TX-0042"
  return /^[a-z][a-z0-9]{1,5}:[A-Z][\w.-]*\/\S+$/.test(v);
}

function looksIri(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z][a-z0-9]{1,5}:[A-Za-z][\w.:-]*$/.test(v);
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = fmtCell(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * ResultsPanel — Table | Chart | Subgraph | Raw tabs over the executed
 * result set, with row→canvas selection, cell-level provenance trace,
 * CSV/JSON export and a sources row.
 */
export function ResultsPanel({ exec, running, elapsedMs, execError, onSelectIri, onOpenNode }: ResultsPanelProps) {
  const [tab, setTab] = useState<Tab>('table');
  const [rawCopied, setRawCopied] = useState(false);

  const chartData = useMemo(() => {
    if (!exec || exec.rows.length === 0) return null;
    const numCol = exec.columns.find((c) => typeof exec.rows[0]?.[c] === 'number');
    const labelCol = exec.columns.find((c) => c !== numCol && typeof exec.rows[0]?.[c] === 'string' && !looksIri(exec.rows[0]?.[c]));
    if (!numCol || !labelCol) return null;
    return exec.rows.slice(0, 14).map((r) => ({
      label: String(r[labelCol]).slice(0, 26),
      value: Number(r[numCol]) || 0,
      module: typeof r.module === 'string' ? r.module : undefined,
    }));
  }, [exec]);

  const graph = useMemo(() => {
    if (!exec || exec.subgraph.nodes.length === 0) return null;
    const iriById = new Map(exec.subgraph.nodes.map((n) => [n.id, n.iri]));
    const nodes: GraphNode[] = exec.subgraph.nodes.slice(0, 160).map((n) => ({
      id: n.iri,
      label: n.label,
      module: (MODULE_KEYS as string[]).includes(n.moduleKey) ? (n.moduleKey as ModuleKey) : 'custom',
    }));
    const keep = new Set(nodes.map((n) => n.id));
    const edges: GraphEdge[] = exec.subgraph.edges
      .filter((e) => keep.has(iriById.get(e.fromNodeId) ?? '') && keep.has(iriById.get(e.toNodeId) ?? ''))
      .slice(0, 300)
      .map((e) => ({
        id: String(e.id),
        source: iriById.get(e.fromNodeId)!,
        target: iriById.get(e.toNodeId)!,
        label: e.predicateIri.split(':').pop(),
      }));
    return { nodes, edges };
  }, [exec]);

  const tabs: { key: Tab; label: string; icon: typeof Table2 }[] = [
    { key: 'table', label: 'Table', icon: Table2 },
    { key: 'chart', label: 'Chart', icon: ListTree },
    { key: 'subgraph', label: 'Subgraph', icon: Braces },
    { key: 'raw', label: 'Raw', icon: Braces },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border-hairline bg-bg-panel">
      {/* Tab bar + meta */}
      <div className="flex items-center gap-1 border-b border-border-hairline px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors duration-150',
              tab === t.key ? 'bg-bg-panel-raised text-text-accent' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {exec && (
            <span className="font-mono text-[10.5px] text-text-muted">
              {exec.rows.length} rows{elapsedMs !== null ? ` · ${elapsedMs} ms` : ''} · traced to {exec.subgraph.nodes.length} graph nodes
            </span>
          )}
          {exec && (
            <>
              <button
                type="button"
                onClick={() => download('ontos-results.csv', toCsv(exec.columns, exec.rows), 'text/csv')}
                className="rounded-md border border-border-hairline p-1.5 text-text-muted transition-colors hover:border-border-glow hover:text-text-primary"
                title="Export CSV"
              >
                <Download className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => download('ontos-results.json', JSON.stringify(exec.rows, null, 2), 'application/json')}
                className="rounded-md border border-border-hairline p-1.5 font-mono text-[9px] text-text-muted transition-colors hover:border-border-glow hover:text-text-primary"
                title="Export JSON"
              >
                {'{}'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-[220px]">
        {running && (
          <div className="flex h-[220px] items-center justify-center gap-2 font-mono text-[12px] text-text-muted">
            <Loader2 className="size-4 animate-spin text-iris-bright" /> executing validated query …
          </div>
        )}

        {!running && execError && (
          <div className="m-4 rounded-lg border-l-2 border-risk bg-risk/10 px-3 py-2.5 font-mono text-[12px] text-risk">
            {execError}
          </div>
        )}

        {!running && !execError && !exec && (
          <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
            <img src="/empty-graph.svg" alt="" className="size-16 opacity-70" />
            <p className="font-mono text-[12px] text-text-muted">Ask a question — results render here as table, chart or subgraph.</p>
          </div>
        )}

        {!running && !execError && exec && exec.rows.length === 0 && (
          <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
            <motion.img
              src="/empty-graph.svg"
              alt=""
              className="size-16 opacity-80"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
            <p className="font-mono text-[12px] text-text-muted">No matches — try broadening the query.</p>
          </div>
        )}

        {!running && !execError && exec && exec.rows.length > 0 && (
          <motion.div
            key={`${exec.intent}-${exec.rows.length}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === 'table' && (
              <div className="max-h-[300px] overflow-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="sticky top-0 z-10 bg-bg-panel">
                    <tr>
                      {exec.columns.map((c) => (
                        <th
                          key={c}
                          className="border-b border-border-hairline px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted"
                        >
                          ?{c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exec.rows.map((row, i) => {
                      const firstIri = exec.columns.map((c) => row[c]).find((v) => typeof v === 'string' && /^[a-z][a-z0-9]{1,5}:\S+/.test(v));
                      return (
                        <tr
                          key={i}
                          onClick={() => typeof firstIri === 'string' && onSelectIri(firstIri)}
                          className="cursor-pointer transition-colors duration-150 hover:bg-bg-panel-raised"
                        >
                          {exec.columns.map((c) => {
                            const v = row[c];
                            const traceable = isTraceableIri(c, v);
                            return (
                              <td key={c} className="h-9 border-b border-border-hairline/60 px-3 py-0 align-middle">
                                {traceable ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenNode(v);
                                    }}
                                    className="font-mono text-[11.5px] text-sky-300 transition-colors hover:text-sky-200 hover:underline"
                                    title="Trace provenance"
                                  >
                                    {v.length > 34 ? `…${v.slice(-32)}` : v}
                                  </button>
                                ) : looksIri(v) ? (
                                  <span className="font-mono text-[11.5px] text-text-secondary">{v}</span>
                                ) : typeof v === 'number' ? (
                                  <span className="font-mono text-[12px] tabular-nums text-text-primary">{fmtCell(v)}</span>
                                ) : (
                                  <span className="text-text-primary">{fmtCell(v)}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'chart' &&
              (chartData ? (
                <div className="h-[300px] px-3 py-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                      <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }} stroke="#1E293B" />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={150}
                        tick={{ fill: '#94A3B8', fontSize: 10.5, fontFamily: 'JetBrains Mono' }}
                        stroke="#1E293B"
                      />
                      <RTooltip
                        contentStyle={{
                          background: '#16202F',
                          border: '1px solid #1E293B',
                          borderRadius: 8,
                          fontFamily: 'JetBrains Mono',
                          fontSize: 11,
                        }}
                        labelStyle={{ color: '#F1F5F9' }}
                        itemStyle={{ color: '#A5B4FC' }}
                      />
                      <Bar dataKey="value" isAnimationActive animationDuration={500} radius={[0, 4, 4, 0]}>
                        {chartData.map((d, i) => (
                          <Cell
                            key={i}
                            fill={
                              d.module && (MODULE_KEYS as string[]).includes(d.module)
                                ? getModule(d.module as ModuleKey).color
                                : '#6366F1'
                            }
                            fillOpacity={0.85}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[220px] items-center justify-center font-mono text-[12px] text-text-muted">
                  Result shape isn’t chartable (needs a label + numeric column) — see Table or Subgraph.
                </div>
              ))}

            {tab === 'subgraph' &&
              (graph ? (
                <GraphCanvas
                  nodes={graph.nodes}
                  edges={graph.edges}
                  className="m-3 h-[300px] rounded-lg"
                  onNodeClick={(iri) => onOpenNode(iri)}
                />
              ) : (
                <div className="flex h-[220px] items-center justify-center font-mono text-[12px] text-text-muted">
                  This answer is a projection — no subgraph attached.
                </div>
              ))}

            {tab === 'raw' && (
              <div className="relative max-h-[300px] overflow-auto bg-bg-inset">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(exec, null, 2));
                      setRawCopied(true);
                      setTimeout(() => setRawCopied(false), 1200);
                    } catch {
                      /* no-op */
                    }
                  }}
                  className="absolute right-2 top-2 z-10 rounded-md border border-border-hairline bg-bg-panel p-1.5 text-text-muted transition-colors hover:text-text-primary"
                  title="Copy JSON"
                >
                  {rawCopied ? <span className="px-1 font-mono text-[10px] text-ok">copied</span> : <Copy className="size-3.5" />}
                </button>
                <pre className="px-3 py-3 font-mono text-[11.5px] leading-relaxed text-text-secondary">
                  {JSON.stringify(exec.rows, null, 2)}
                </pre>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Provenance row */}
      {exec && !running && (
        <div className="border-t border-border-hairline px-3 py-2 font-mono text-[10.5px] text-text-muted">
          Sources:{' '}
          <span className="text-text-secondary">
            {exec.subgraph.nodes.length > 0
              ? `${exec.subgraph.nodes.length} nodes · ${exec.subgraph.edges.length} edges in answer graph`
              : 'audit-log projection'}
          </span>{' '}
          — click any <span className="text-sky-300">mono identifier</span> cell to trace.
        </div>
      )}
    </div>
  );
}

export default ResultsPanel;
