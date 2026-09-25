import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCheck,
  ChevronDown,
  Database,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  UserPlus,
} from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getModule, type ModuleKey } from '@/lib/modules';
import { ActOnIt } from '@/components/actions/ObjectActions';
import { EvidenceCanvas, type EvidenceEdge, type EvidenceNode } from './EvidenceCanvas';
import type { InsightRow, KgNodeRow, SubgraphResult } from './types';
import {
  SEVERITY_COLOR,
  evidenceObjectIris,
  resolveInstanceIri,
  iriLocalName,
  moduleKeyForIri,
  parseEvidence,
  ruleMetaFor,
} from './ruleMeta';

export type TraceTarget =
  | { kind: 'insight'; insight: InsightRow }
  | { kind: 'grounding'; centerIri: string | null; snapshot: string | null };

function resolveCenterIri(target: TraceTarget): string | null {
  if (target.kind === 'grounding') return target.centerIri;
  return resolveInstanceIri(
    target.insight.evidenceJson,
    target.insight.summary,
    target.insight.title,
  );
}

/** Cut a fetched neighborhood down to exactly the evidence set. */
function toEvidenceGraph(target: TraceTarget, sub: SubgraphResult) {
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];
  const shown = new Map<string, KgNodeRow>();

  if (target.kind === 'grounding') {
    for (const n of sub.nodes) shown.set(n.iri, n);
    for (const e of sub.edges) {
      const a = sub.nodes.find((n) => n.id === e.fromNodeId);
      const b = sub.nodes.find((n) => n.id === e.toNodeId);
      if (a && b) edges.push({ id: `e${e.id}`, source: a.iri, target: b.iri, label: e.predicateIri.split(':')[1] });
    }
  } else {
    const ev = parseEvidence(target.insight.evidenceJson);
    const nodeIdSet = new Set(ev.nodeIds);
    const edgeIdSet = new Set(ev.edgeIds);
    const byId = new Map(sub.nodes.map((n) => [n.id, n]));
    const wantedNodes =
      ev.nodeIds.length === 0
        ? sub.nodes
        : sub.nodes.filter((n) => nodeIdSet.has(n.id)).length > 0
          ? sub.nodes.filter((n) => nodeIdSet.has(n.id))
          : sub.nodes; // evidence ids outside the fetch window — show the neighborhood instead
    for (const n of wantedNodes) shown.set(n.iri, n);
    const wantedEdges = sub.edges.filter(
      (e) =>
        (edgeIdSet.size ? edgeIdSet.has(e.id) : true) &&
        byId.has(e.fromNodeId) &&
        byId.has(e.toNodeId) &&
        shown.has(byId.get(e.fromNodeId)!.iri) &&
        shown.has(byId.get(e.toNodeId)!.iri),
    );
    for (const e of wantedEdges) {
      const a = byId.get(e.fromNodeId)!;
      const b = byId.get(e.toNodeId)!;
      edges.push({ id: `e${e.id}`, source: a.iri, target: b.iri, label: e.predicateIri.split(':')[1] });
    }
    // ghost endpoints + dashed missing edges — "expected by axiom, absent"
    ev.missingEdges.forEach((m, i) => {
      const ghostId = `missing:${m.toIri}:${i}`;
      if (!shown.has(m.fromIri)) {
        // source node fell outside the subgraph window — synthesize it from the IRI
        nodes.push({
          id: m.fromIri,
          label: iriLocalName(m.fromIri),
          module: moduleKeyForIri(m.fromIri),
        });
        shown.set(m.fromIri, undefined as unknown as KgNodeRow);
      }
      nodes.push({
        id: ghostId,
        label: iriLocalName(m.toIri),
        module: moduleKeyForIri(m.toIri),
        ghost: true,
        size: 28,
      });
      edges.push({
        id: `missing-${i}`,
        source: m.fromIri,
        target: ghostId,
        label: `missing: ${m.predicate.split(':')[1] ?? m.predicate}`,
        missing: true,
      });
    });
  }

  for (const n of shown.values()) {
    if (!n) continue;
    nodes.push({
      id: n.iri,
      label: n.label,
      module: (n.moduleKey as ModuleKey) || moduleKeyForIri(n.iri),
      size: 34,
    });
  }
  return { nodes, edges };
}

function SourceRecords({ nodes }: { nodes: KgNodeRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (nodes.length === 0) {
    return <p className="text-[13px] text-text-muted">No source records in this evidence set.</p>;
  }
  return (
    <ul className="divide-y divide-border-hairline rounded-lg border border-border-hairline">
      {nodes.slice(0, 12).map((n) => {
        const open = openId === n.iri;
        const Icon = n.sourceMappingId ? FileSpreadsheet : Database;
        return (
          <li key={n.iri}>
            <div className="flex items-center gap-2.5 px-3 py-2">
              <Icon className="size-3.5 shrink-0" style={{ color: getModule((n.moduleKey as ModuleKey) || 'custom').color }} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary">
                {n.iri}
                <span className="text-text-muted"> · row #{n.id}</span>
              </span>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : n.iri)}
                className="inline-flex items-center gap-1 rounded-md border border-border-hairline px-2 py-1 font-mono text-[10.5px] text-text-muted transition-colors hover:border-border-glow hover:text-text-primary"
              >
                View raw
                <ChevronDown className={cn('size-3 transition-transform duration-200', open && 'rotate-180')} />
              </button>
              <Link
                to="/app/explorer"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10.5px] text-text-accent transition-colors hover:bg-bg-panel-raised"
              >
                Open in Explorer <ExternalLink className="size-3" />
              </Link>
            </div>
            {open && (
              <motion.pre
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="mx-3 mb-3 overflow-hidden rounded-lg border border-border-hairline bg-bg-inset p-3 font-mono text-[11.5px] leading-[1.5] text-text-secondary"
              >
                {JSON.stringify(
                  { iri: n.iri, class: n.classIri, label: n.label, props: n.propsJson ?? {} },
                  null,
                  2,
                )}
              </motion.pre>
            )}
          </li>
        );
      })}
      {nodes.length > 12 && (
        <li className="px-3 py-2 font-mono text-[11px] text-text-muted">+ {nodes.length - 12} more records</li>
      )}
    </ul>
  );
}

/**
 * TraceDrawer — the signature one-click evidence trace. Three zones:
 * evidence subgraph (with dashed "missing" edges), rule/analytics
 * provenance, and source records with raw JSON payloads.
 */
export function TraceDrawer({
  target,
  onClose,
  onAcknowledge,
}: {
  target: TraceTarget | null;
  onClose: () => void;
  onAcknowledge: (insight: InsightRow) => void;
}) {
  const open = target !== null;
  const centerIri = target ? resolveCenterIri(target) : null;
  const stats = trpc.graph.stats.useQuery(undefined, { staleTime: 60_000 });
  const sub = trpc.graph.getSubgraph.useQuery(
    { centerIri: centerIri ?? '', depth: 2, limit: 160 },
    { enabled: open && !!centerIri, retry: false },
  );

  const graph = useMemo(
    () => (target && sub.data ? toEvidenceGraph(target, sub.data as SubgraphResult) : { nodes: [], edges: [] }),
    [target, sub.data],
  );
  const evidenceNodes = useMemo(() => {
    if (!target || !sub.data) return [];
    const data = sub.data as SubgraphResult;
    if (target.kind === 'grounding') return data.nodes.slice(0, 12);
    const ev = parseEvidence(target.insight.evidenceJson);
    const set = new Set(ev.nodeIds);
    return ev.nodeIds.length ? data.nodes.filter((n) => set.has(n.id)) : data.nodes;
  }, [target, sub.data]);

  const insight = target?.kind === 'insight' ? target.insight : null;
  const meta = insight ? ruleMetaFor(insight.ruleId) : null;
  // Objects the evidence names: missing-edge endpoints, and evidence node ids the subgraph resolved.
  const actIris = useMemo(() => {
    if (!insight) return [];
    const ev = parseEvidence(insight.evidenceJson);
    const ids = new Set(ev.nodeIds);
    const resolved = ((sub.data as SubgraphResult | undefined)?.nodes ?? []).filter((n) => ids.has(n.id)).map((n) => n.iri);
    return evidenceObjectIris(insight.evidenceJson, resolved);
  }, [insight, sub.data]);
  const snapshotLabel = target?.kind === 'grounding' ? target.snapshot : (stats.data?.snapshot?.label ?? null);

  const share = async () => {
    try {
      const url = new URL(window.location.href);
      if (insight) url.searchParams.set('insight', String(insight.id));
      await navigator.clipboard.writeText(url.toString());
      toast.success('Deep link copied');
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-l border-border-hairline bg-bg-panel p-0 sm:max-w-[560px]"
      >
        <SheetHeader className="border-b border-border-hairline p-5">
          <div className="flex items-center gap-2">
            {insight && (
              <span
                className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em]"
                style={{
                  color: SEVERITY_COLOR[insight.severity],
                  backgroundColor: `${SEVERITY_COLOR[insight.severity]}26`,
                  border: `1px solid ${SEVERITY_COLOR[insight.severity]}4d`,
                }}
              >
                {insight.severity.toUpperCase()}
              </span>
            )}
            {meta && (
              <span className="rounded-md border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[10px] tracking-[0.06em] text-text-muted">
                {meta.typeChip}
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] text-text-muted">evidence trace</span>
          </div>
          <SheetTitle className="pt-2 text-left font-display text-[18px] font-semibold leading-snug text-text-primary">
            {insight ? insight.title : 'Narrative grounding subgraph'}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 p-5">
          {/* Zone 1 — subgraph */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                Evidence subgraph
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-risk/40 bg-risk/10 px-2 py-0.5 font-mono text-[10px] text-risk">
                <span className="inline-block h-0 w-4 border-t border-dashed border-risk" aria-hidden />
                dashed red = expected but absent
              </span>
            </div>
            {!centerIri ? (
              <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-border-hairline text-[13px] text-text-muted">
                This finding carries no graph reference.
              </div>
            ) : sub.isLoading ? (
              <Skeleton className="h-[260px] w-full rounded-xl" />
            ) : sub.isError ? (
              <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-border-hairline px-6 text-center text-[13px] text-text-muted">
                Evidence node <span className="mx-1 font-mono text-text-secondary">{centerIri}</span> is no longer in
                the graph — it may have been resolved already.
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                <EvidenceCanvas nodes={graph.nodes} edges={graph.edges} className="h-[260px]" />
              </motion.div>
            )}
          </section>

          {/* Zone 2 — rule / analytics provenance */}
          <section>
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Rule · provenance
            </span>
            <div className="mt-2 rounded-lg border border-border-hairline bg-bg-inset p-3.5 font-mono text-[12px] leading-[1.6]">
              {meta && <pre className="whitespace-pre-wrap text-text-secondary">{meta.ruleText}</pre>}
              {target?.kind === 'grounding' && (
                <pre className="whitespace-pre-wrap text-text-secondary">
                  grounded template · weekly-narrative{'\n'}cites snapshot stats + open findings only
                </pre>
              )}
              <div className="mt-3 space-y-1 border-t border-border-hairline pt-3 text-[11px] text-text-muted">
                <div>engine: rules-v1.6 · deterministic · no LLM in rule path</div>
                {insight && <div>run id: #{insight.id} · rule {insight.ruleId ?? 'n/a'}</div>}
                <div>snapshot: {snapshotLabel ?? '…'} · status {insight?.status ?? 'open'}</div>
              </div>
            </div>
          </section>

          {/* Zone 3 — source records */}
          <section>
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
              Source records ({evidenceNodes.length})
            </span>
            <div className="mt-2">
              {sub.isLoading ? <Skeleton className="h-24 w-full" /> : <SourceRecords nodes={evidenceNodes} />}
            </div>
          </section>

          {/* Zone 4 — actions on the objects the evidence names */}
          {insight && actIris.length > 0 && (
            <section>
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">Act on it</span>
              <p className="mt-1 text-[12.5px] text-text-muted">
                Governed edits that apply to the objects in this evidence. Each opens with the object filled in; preview
                shows exactly what would change.
              </p>
              <div className="mt-2">
                <ActOnIt iris={actIris} />
              </div>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-border-hairline bg-bg-panel/95 p-4 backdrop-blur">
          {insight && insight.status === 'open' && (
            <button
              type="button"
              onClick={() => {
                onAcknowledge(insight);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ok/40 bg-ok/10 px-3 py-1.5 text-[13px] font-medium text-ok transition-colors hover:bg-ok/20"
            >
              <CheckCheck className="size-3.5" /> Mark resolved
            </button>
          )}
          <button
            type="button"
            onClick={() => toast.info('Assignment is not persisted in the evaluation build')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <UserPlus className="size-3.5" /> Assign
          </button>
          <button
            type="button"
            onClick={() => void share()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <Link2 className="size-3.5" /> Share link
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default TraceDrawer;
