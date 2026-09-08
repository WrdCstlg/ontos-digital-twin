import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { BadgeCheck, Braces, Check, Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { IRIChip } from '@/components/ui/iri-chip';
import { StatusDot } from '@/components/ui/status-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DisclosureChip } from './DisclosureChip';
import { LiveValue } from './LiveValue';
import { Sparkline } from './Sparkline';
import {
  PROPERTY_KEYS,
  TWIN_COLOR,
  classLabel,
  fmtNum,
  fmtTime,
  fmtValue,
  labelFor,
  presentTelemetry,
  statusKind,
  unitFor,
  type TopologyEdge,
  type TopologyNode,
  type TwinStateShape,
} from './meta';

export interface TwinInspectorProps {
  iri: string;
  classIri: string;
  state: TwinStateShape;
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] };
  tickId: number;
  changedKeys: Set<string>;
  onSelectTwin: (iri: string) => void;
}

/* ── DTDL JSON syntax highlighting ───────────────────────────── */

const C_KEY = '#A5B4FC'; // iris — keys
const C_STR = '#34D399'; // emerald — strings
const C_NUM = '#FBBF24'; // amber — numbers
const C_KW = '#64748B'; // muted — true/false/null
const C_PUNCT = '#475569';

function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) {
      out.push(
        <span key={i++} style={{ color: C_PUNCT }}>
          {src.slice(last, m.index)}
        </span>,
      );
    }
    if (m[1] !== undefined) {
      const isDtmi = m[1].includes('dtmi:');
      out.push(
        <span key={i++} style={{ color: m[2] ? C_KEY : isDtmi ? TWIN_COLOR : C_STR }}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(<span key={i++} style={{ color: C_PUNCT }}>{m[2]}</span>);
    } else if (m[3] !== undefined) {
      out.push(<span key={i++} style={{ color: C_NUM }}>{m[3]}</span>);
    } else {
      out.push(<span key={i++} style={{ color: C_KW }}>{m[0]}</span>);
    }
    last = re.lastIndex;
  }
  if (last < src.length) {
    out.push(
      <span key={i++} style={{ color: C_PUNCT }}>
        {src.slice(last)}
      </span>,
    );
  }
  return out;
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

/* ── DTDL tab ────────────────────────────────────────────────── */

function DtdlTab({ iri, classIri }: { iri: string; classIri: string }) {
  const q = trpc.twin.exportDtdl.useQuery({ iri }, { staleTime: 60_000 });
  const content = q.data?.content ?? '';
  const [shown, setShown] = useState(0);
  const [copied, setCopied] = useState(false);

  // fast typewriter stream (~24 chars per 8ms — full doc in ~1.5s)
  useEffect(() => {
    setShown(0);
    if (!content) return;
    const iv = window.setInterval(() => {
      setShown((s) => {
        if (s >= content.length) {
          window.clearInterval(iv);
          return s;
        }
        return Math.min(content.length, s + 24);
      });
    }, 8);
    return () => window.clearInterval(iv);
  }, [content]);

  const done = shown >= content.length && content.length > 0;
  const bytes = useMemo(() => new Blob([content]).size, [content]);
  const fileName = `${classLabel(classIri)}.json`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      toast.success(`Copied ${classLabel(classIri)} DTDL (${fmtBytes(bytes)})`);
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (q.isLoading) return <Skeleton className="h-72 w-full bg-bg-inset" />;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-risk/30 bg-risk/5 p-3 font-mono text-[11.5px] text-risk">
        failed to export DTDL — {q.error.message}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] text-text-muted">
          context <span className="text-module-twin">dtmi:dtdl:context;3</span> — DTDL carries notes in description fields
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            aria-label="Copy DTDL JSON"
            className="rounded-md border border-border-hairline p-1.5 text-text-muted transition-colors hover:border-border-glow hover:text-text-primary"
          >
            {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={download}
            aria-label={`Download ${fileName}`}
            title={`Download ${fileName}`}
            className="rounded-md border border-border-hairline p-1.5 text-text-muted transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <Download className="size-3.5" />
          </button>
        </span>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-lg border border-border-hairline bg-bg-inset p-3">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed">
          {highlightJson(content.slice(0, shown))}
          {!done && (
            <span className="ml-0.5 inline-block h-3.5 w-2 animate-pulse bg-module-twin align-middle" aria-hidden />
          )}
        </pre>
      </div>

      <div className="mt-2 flex items-center gap-2">
        {done && (
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/15 px-2 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-ok"
          >
            <BadgeCheck className="size-3" /> Valid DTDL v3
          </motion.span>
        )}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted">{fmtBytes(bytes)}</span>
      </div>
    </div>
  );
}

/* ── State tab ───────────────────────────────────────────────── */

function MiniSpark({ iri, tkey }: { iri: string; tkey: string }) {
  const q = trpc.twin.getStateHistory.useQuery(
    { iri, key: tkey, points: 24 },
    { staleTime: Infinity, refetchOnWindowFocus: false },
  );
  const points = (q.data?.points ?? []).map((p) => p.valueNum).filter((v): v is number => typeof v === 'number');
  return <Sparkline points={points} height={24} className="w-20" />;
}

function StateTab({ iri, state, topology, tickId, changedKeys, onSelectTwin }: TwinInspectorProps) {
  const props = PROPERTY_KEYS.filter((k) => state[k] !== undefined && k !== 'lastTickAt');
  const telemetry = presentTelemetry(state);
  const center = topology.nodes.find((n) => n.iri === iri);
  const rels = center
    ? topology.edges.filter((e) => e.fromNodeId === center.id || e.toNodeId === center.id)
    : [];
  const nodeById = new Map(topology.nodes.map((n) => [n.id, n]));

  return (
    <div className="space-y-4">
      {/* DTDL properties */}
      <div>
        <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">Properties</div>
        <div className="overflow-hidden rounded-lg border border-border-hairline">
          {props.length === 0 && (
            <div className="px-3 py-2 font-mono text-[11px] text-text-muted">no static properties on this twin</div>
          )}
          {props.map((k) => (
            <div key={k} className="flex items-center gap-2 border-b border-border-hairline/60 px-3 py-1.5 last:border-0">
              <span className="w-32 shrink-0 font-mono text-[11px] text-text-muted">{k}</span>
              {k === 'status' ? (
                <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-primary">
                  <StatusDot status={statusKind(state.status)} pulse={false} /> {String(state[k])}
                </span>
              ) : k === 'mirroredIri' ? (
                <IRIChip iri={String(state[k])} />
              ) : (
                <span className="min-w-0 truncate font-mono text-[11.5px] text-text-primary">{fmtValue(k, state[k])}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* DTDL telemetry — live */}
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">Telemetry — live</span>
          <DisclosureChip variant="simulated" iconOnly />
        </div>
        <div className="overflow-hidden rounded-lg border border-border-hairline">
          {telemetry.length === 0 && (
            <div className="px-3 py-2 font-mono text-[11px] text-text-muted">no live telemetry keys on this twin</div>
          )}
          {telemetry.map((k) => (
            <div key={k} className="flex items-center gap-3 border-b border-border-hairline/60 px-3 py-1.5 last:border-0">
              <span className="w-24 shrink-0 font-mono text-[11px] text-text-muted">{labelFor(k)}</span>
              <LiveValue
                value={fmtNum(k, state[k] as number)}
                unit={unitFor(k)}
                tickId={tickId}
                changed={changedKeys.has(k)}
              />
              <span className="ml-auto">
                <MiniSpark iri={iri} tkey={k} />
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-[9.5px] tabular-nums text-text-muted">
                {state.lastTickAt ? fmtTime(state.lastTickAt) : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* relationships */}
      <div>
        <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">Relationships</div>
        <div className="flex flex-wrap gap-1.5">
          {rels.length === 0 && <span className="font-mono text-[11px] text-text-muted">no topology edges</span>}
          {rels.map((e) => {
            const other = nodeById.get(e.fromNodeId === center!.id ? e.toNodeId : e.fromNodeId);
            if (!other) return null;
            const pred = e.predicateIri.split(':')[1] ?? e.predicateIri;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => other.moduleKey === 'twin' && other.classIri !== 'dtwin:TwinModel' && onSelectTwin(other.iri)}
                title={`${pred} — ${other.label}`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-border-hairline bg-bg-inset px-2 py-1 transition-colors',
                  other.moduleKey === 'twin' && 'hover:border-module-twin/40',
                )}
              >
                <span className="font-mono text-[9.5px] uppercase tracking-[0.04em] text-module-twin">{pred}</span>
                <span className="font-mono text-[10.5px] text-text-secondary">{other.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── History tab ─────────────────────────────────────────────── */

const RANGES = [
  { key: '60', label: '60 ticks', points: 60 },
  { key: '30', label: '30 ticks', points: 30 },
  { key: '24h', label: '24 h', points: 144 },
] as const;

function HistoryTab({ iri, state }: { iri: string; state: TwinStateShape }) {
  const telemetry = presentTelemetry(state);
  const [tkey, setTkey] = useState(telemetry[0] ?? 'utilization');
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('60');
  const effKey = telemetry.includes(tkey) ? tkey : (telemetry[0] ?? 'utilization');
  const points = RANGES.find((r) => r.key === range)!.points;
  const q = trpc.twin.getStateHistory.useQuery(
    { iri, key: effKey, points },
    { staleTime: Infinity, refetchOnWindowFocus: false },
  );

  const rows = useMemo(() => {
    const pts = (q.data?.points ?? []).filter((p) => p.valueNum !== null || p.valueText !== null);
    // newest first
    return [...pts].reverse();
  }, [q.data]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {telemetry.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTkey(k)}
            className={cn(
              'rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors',
              effKey === k
                ? 'border-module-twin/40 bg-module-twin/15 text-module-twin'
                : 'border-border-hairline text-text-muted hover:text-text-secondary',
            )}
          >
            {labelFor(k)}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border-hairline" aria-hidden />
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors',
              range === r.key ? 'bg-bg-panel-raised text-text-primary' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="max-h-[380px] overflow-auto rounded-lg border border-border-hairline">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-bg-panel">
            <tr className="border-b border-border-hairline text-[9.5px] font-medium uppercase tracking-[0.06em] text-text-muted">
              <th className="px-2.5 py-1.5">tick</th>
              <th className="px-2.5 py-1.5">time</th>
              <th className="px-2.5 py-1.5">field</th>
              <th className="px-2.5 py-1.5 text-right">old → new</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-3">
                  <Skeleton className="h-24 w-full bg-bg-inset" />
                </td>
              </tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center font-mono text-[11px] text-text-muted">
                  no recorded history for {effKey} yet — press Tick
                </td>
              </tr>
            )}
            {rows.map((p, i) => {
              const next = rows[i + 1];
              const changed =
                next !== undefined && (p.valueNum ?? p.valueText) !== (next.valueNum ?? next.valueText);
              return (
                <tr key={`${p.recordedAt}-${i}`} className="border-b border-border-hairline/50 transition-colors last:border-0 hover:bg-bg-panel-raised">
                  <td className="px-2.5 py-1 font-mono text-[10.5px] tabular-nums text-text-muted">
                    #{rows.length - i}
                  </td>
                  <td className="px-2.5 py-1 font-mono text-[10.5px] tabular-nums text-text-secondary">
                    {fmtTime(p.recordedAt)}
                  </td>
                  <td className="px-2.5 py-1 font-mono text-[10.5px] text-text-muted">{effKey}</td>
                  <td className={cn('px-2.5 py-1 text-right font-mono text-[10.5px] tabular-nums', changed ? 'text-module-twin' : 'text-text-secondary')}>
                    {next ? `${fmtNum(effKey, (next.valueNum ?? 0) as number)} → ` : ''}
                    {p.valueNum !== null ? fmtNum(effKey, p.valueNum as number) : p.valueText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 font-mono text-[9.5px] text-text-muted">
        state history retained for the seeded window + live ticks · simulated
      </div>
    </div>
  );
}

/* ── Topology tab (edge list) ────────────────────────────────── */

const PRED_COLOR: Record<string, string> = {
  contains: TWIN_COLOR,
  locatedIn: '#64748B',
  connectedTo: TWIN_COLOR,
  monitors: '#FBBF24',
  twinOf: '#38BDF8',
  hasModel: '#475569',
};

function TopologyTab({ iri, topology, onSelectTwin }: { iri: string; topology: TwinInspectorProps['topology']; onSelectTwin: (iri: string) => void }) {
  const nodeById = new Map(topology.nodes.map((n) => [n.id, n]));
  return (
    <div className="overflow-hidden rounded-lg border border-border-hairline">
      {topology.edges.length === 0 && (
        <div className="px-3 py-3 font-mono text-[11px] text-text-muted">no topology edges in this subgraph</div>
      )}
      {topology.edges.map((e) => {
        const from = nodeById.get(e.fromNodeId);
        const to = nodeById.get(e.toNodeId);
        if (!from || !to) return null;
        const pred = e.predicateIri.split(':')[1] ?? e.predicateIri;
        const target = from.iri === iri ? to : from;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => target.moduleKey === 'twin' && target.classIri !== 'dtwin:TwinModel' && onSelectTwin(target.iri)}
            className="flex w-full items-center gap-2 border-b border-border-hairline/60 px-3 py-1.5 text-left transition-colors last:border-0 hover:bg-bg-panel-raised"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-text-secondary">{from.label}</span>
            <span
              className="shrink-0 rounded-full px-1.5 py-0 font-mono text-[9px] uppercase tracking-[0.04em]"
              style={{ color: PRED_COLOR[pred] ?? '#64748B', backgroundColor: `${PRED_COLOR[pred] ?? '#64748B'}26` }}
            >
              {pred}
            </span>
            <span className="min-w-0 flex-1 truncate text-right font-mono text-[10.5px] text-text-secondary">{to.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Inspector shell ─────────────────────────────────────────── */

/**
 * TwinInspector — right-column tabbed inspector (State · History · Topology ·
 * DTDL) with internal scroll and a teal underline on the active tab.
 */
export function TwinInspector(props: TwinInspectorProps) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-0 w-full flex-col rounded-xl border border-border-hairline bg-bg-panel lg:w-[420px] lg:shrink-0"
    >
      <Tabs defaultValue="state" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="h-10 w-full justify-start gap-1 rounded-none border-b border-border-hairline bg-transparent px-2 [&_[data-state=active]]:border-b-2 [&_[data-state=active]]:border-module-twin [&_[data-state=active]]:bg-transparent [&_[data-state=active]]:text-module-twin">
          {(['state', 'history', 'topology', 'dtdl'] as const).map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="rounded-none px-2.5 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-text-muted transition-colors data-[state=active]:shadow-none"
            >
              {t === 'dtdl' ? (
                <span className="inline-flex items-center gap-1">
                  <Braces className="size-3" /> DTDL
                </span>
              ) : (
                t
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          <TabsContent value="state" className="m-0">
            <StateTab {...props} />
          </TabsContent>
          <TabsContent value="history" className="m-0">
            <HistoryTab iri={props.iri} state={props.state} />
          </TabsContent>
          <TabsContent value="topology" className="m-0">
            <TopologyTab iri={props.iri} topology={props.topology} onSelectTwin={props.onSelectTwin} />
          </TabsContent>
          <TabsContent value="dtdl" className="m-0">
            <DtdlTab iri={props.iri} classIri={props.classIri} />
          </TabsContent>
        </div>
      </Tabs>
    </motion.aside>
  );
}
