import { useMemo } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, Loader2 } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { IRIChip } from '@/components/ui/iri-chip';
import { ModuleBadge } from '@/components/ui/module-badge';
import { StatusDot } from '@/components/ui/status-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { DisclosureChip } from './DisclosureChip';
import { TelemetryPanel } from './TelemetryPanel';
import { TwinTopologyCanvas } from './TwinTopologyCanvas';
import { TwinInspector } from './TwinInspector';
import {
  classMeta,
  presentTelemetry,
  statusKind,
  statusLabel,
  thresholdFor,
  type TopologyEdge,
  type TopologyNode,
  type TwinStateShape,
} from './meta';

export interface TwinDetailProps {
  iri: string;
  tickId: number;
  changedKeys: Set<string>;
  onBack: () => void;
  onSelectTwin: (iri: string) => void;
}

/** Contained-twin list (Capacity & Equipment) — click swaps the detail. */
function ContainedPanel({
  iri,
  topology,
  onSelectTwin,
}: {
  iri: string;
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] };
  onSelectTwin: (iri: string) => void;
}) {
  const center = topology.nodes.find((n) => n.iri === iri);
  const nodeById = new Map(topology.nodes.map((n) => [n.id, n]));
  const contained = center
    ? topology.edges
        .filter((e) => e.predicateIri === 'dtwin:contains' && e.fromNodeId === center.id)
        .map((e) => nodeById.get(e.toNodeId))
        .filter((n): n is TopologyNode => !!n)
    : [];
  if (!contained.length) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-border-hairline bg-bg-panel"
    >
      <header className="border-b border-border-hairline px-3.5 py-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">
        Contained twins
      </header>
      <div className="max-h-44 overflow-y-auto">
        {contained.map((n) => {
          const Icon = classMeta(n.classIri).icon;
          return (
            <button
              key={n.iri}
              type="button"
              onClick={() => onSelectTwin(n.iri)}
              className="flex w-full items-center gap-2.5 border-b border-border-hairline/60 px-3.5 py-2 text-left transition-colors last:border-0 hover:bg-bg-panel-raised"
            >
              <Icon className="size-3.5 shrink-0 text-module-twin" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">{n.label}</span>
              <span className="font-mono text-[9.5px] text-text-muted">{n.classIri.replace(/^dtwin:/, '')}</span>
              <ArrowUpRight className="size-3.5 text-text-muted" />
            </button>
          );
        })}
      </div>
    </motion.section>
  );
}

/**
 * TwinDetail — detail state: hero strip (IRIChip, class, DTDL badge, twinOf
 * cross-link), live telemetry panels, topology subgraph and the tabbed
 * inspector.
 */
export function TwinDetail({ iri, tickId, changedKeys, onBack, onSelectTwin }: TwinDetailProps) {
  const q = trpc.twin.getTwin.useQuery({ iri });

  // hide dtwin:hasModel edges + TwinModel descriptor nodes — the canvas shows
  // the five runtime predicates only (contains/locatedIn/connectedTo/monitors/twinOf)
  const topology = useMemo(() => {
    const nodes = ((q.data?.topology.nodes ?? []) as TopologyNode[]).filter(
      (n) => n.classIri !== 'dtwin:TwinModel',
    );
    const ids = new Set(nodes.map((n) => n.id));
    const edges = ((q.data?.topology.edges ?? []) as TopologyEdge[]).filter(
      (e) => e.predicateIri !== 'dtwin:hasModel' && ids.has(e.fromNodeId) && ids.has(e.toNodeId),
    );
    return { nodes, edges };
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <Skeleton className="h-24 w-full rounded-xl bg-bg-panel" />
        <div className="grid gap-4 lg:grid-cols-[46%_1fr]">
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-xl bg-bg-panel" />
            <Skeleton className="h-48 w-full rounded-xl bg-bg-panel" />
          </div>
          <Skeleton className="h-96 w-full rounded-xl bg-bg-panel" />
        </div>
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="font-mono text-[12px] text-risk">
          {q.error?.message ?? 'twin not found'}
        </span>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-border-hairline px-3 py-1.5 font-mono text-[11.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
        >
          ← all twins
        </button>
      </div>
    );
  }

  const state = (q.data.state ?? {}) as TwinStateShape;
  const meta = classMeta(q.data.twin.classIri);
  const Icon = meta.icon;
  const twinOf = q.data.twinOf;
  const dtdlId = q.data.model.dtdlId;

  // choose up to 3 telemetry panels; pair humidity beside temperature
  const telemetry = presentTelemetry(state);
  const panels: { tkey: string; secondaryKey?: string; title: string }[] = [];
  const used = new Set<string>();
  for (const k of telemetry) {
    if (used.has(k) || panels.length >= 3) continue;
    const secondaryKey = k === 'temperature' && telemetry.includes('humidity') ? 'humidity' : undefined;
    if (secondaryKey) used.add(secondaryKey);
    used.add(k);
    const title =
      k === 'temperature'
        ? 'Telemetry — Environment'
        : k === 'utilization'
          ? 'Telemetry — Utilization'
          : k === 'etaMinutes'
            ? 'Telemetry — Routing'
            : k === 'batteryLevel'
              ? 'Telemetry — Power'
              : `Telemetry — ${k}`;
    panels.push({ tkey: k, secondaryKey, title });
  }

  const breached = telemetry.some((k) => {
    const th = thresholdFor(q.data.twin.classIri, k, state);
    return th != null && typeof state[k] === 'number' && (state[k] as number) > th;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      {/* back link */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-text-muted transition-colors hover:text-module-twin"
        >
          <ArrowLeft className="size-3.5" /> All twins
        </button>
      </div>

      {/* 4a — hero strip */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border-hairline bg-bg-panel px-5 py-4"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-module-twin/30 bg-module-twin/15">
            <Icon className="size-7 text-module-twin" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-[24px] font-semibold leading-tight text-text-primary">
                {q.data.twin.label}
              </h1>
              <ModuleBadge module="twin" long />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <IRIChip iri={q.data.twin.iri} />
              <span className="inline-flex items-center gap-1.5">
                <StatusDot status={statusKind(state.status)} />
                <span className={breached ? 'font-mono text-[11px] uppercase tracking-[0.04em] text-warn' : 'font-mono text-[11px] uppercase tracking-[0.04em] text-text-secondary'}>
                  {statusLabel(state.status)}
                  {breached ? ' — above threshold' : ''}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* twinOf cross-link card */}
        {twinOf && (
          <motion.div
            initial={{ borderColor: '#2DD4BF00' }}
            animate={{ borderColor: '#2DD4BF4D' }}
            transition={{ duration: 0.5 }}
            className="flex items-center gap-3 rounded-xl border bg-module-twin/10 px-3.5 py-2.5"
          >
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-module-twin">twinOf</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-text-secondary">
                This twin mirrors{' '}
                <span className="text-module-logistics">{twinOf.iri.split(':')[0]}:</span>
                <span className="font-medium text-text-primary">{twinOf.iri.split(':').slice(1).join(':')}</span>
              </div>
            </div>
            <Link
              to="/app/explorer"
              className="group inline-flex shrink-0 items-center gap-1 rounded-lg border border-border-hairline px-2.5 py-1.5 font-mono text-[10.5px] text-text-secondary transition-colors hover:border-module-logistics/50 hover:text-module-logistics"
            >
              Open in Graph Explorer
              <ArrowUpRight className="size-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </motion.div>
        )}

        {/* right: disclosures + DTMI */}
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <DisclosureChip variant="simulated" />
            <DisclosureChip variant="dtdl" />
          </div>
          {dtdlId && <span className="font-mono text-[10px] text-text-muted">{dtdlId}</span>}
        </div>
      </motion.div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        {/* main column: live panels + topology */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[46%_1fr]">
            {/* 4b — live state panels */}
            <div className="flex min-w-0 flex-col gap-4">
              {panels.length === 0 && (
                <div className="rounded-xl border border-border-hairline bg-bg-panel px-4 py-6 text-center font-mono text-[11.5px] text-text-muted">
                  this twin carries no live telemetry keys
                </div>
              )}
              {panels.map((p) => (
                <TelemetryPanel
                  key={p.tkey}
                  iri={iri}
                  classIri={q.data.twin.classIri}
                  state={state}
                  tkey={p.tkey}
                  secondaryKey={p.secondaryKey}
                  title={p.title}
                  tickId={tickId}
                  changedKeys={changedKeys}
                />
              ))}
              <ContainedPanel iri={iri} topology={topology} onSelectTwin={onSelectTwin} />
            </div>

            {/* 4c — topology subgraph */}
            <div className="min-h-[420px]">
              {topology.nodes.length > 0 ? (
                <TwinTopologyCanvas
                  nodes={topology.nodes}
                  edges={topology.edges}
                  centerIri={iri}
                  className="h-full min-h-[420px]"
                  onNodeClick={(nodeIri, moduleKey) => {
                    if (moduleKey === 'twin' && nodeIri !== iri) onSelectTwin(nodeIri);
                  }}
                />
              ) : (
                <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-border-hairline bg-bg-void">
                  <Loader2 className="size-5 animate-spin text-module-twin" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 4d — inspector */}
        <TwinInspector
          iri={iri}
          classIri={q.data.twin.classIri}
          state={state}
          topology={topology}
          tickId={tickId}
          changedKeys={changedKeys}
          onSelectTwin={onSelectTwin}
        />
      </div>
    </div>
  );
}
