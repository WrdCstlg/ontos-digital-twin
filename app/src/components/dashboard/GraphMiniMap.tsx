import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2 } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { GraphCanvas, type GraphEdge, type GraphNode } from '@/components/graph/GraphCanvas';
import { MODULES, getModule, type ModuleKey } from '@/lib/modules';
import { relTime } from './utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface LeafNode {
  id: number;
  iri: string;
  label: string;
  moduleKey: string;
}

/** Five fixed queries — one per module — sampling real KG instances. */
function useModuleSamples(limit: number) {
  const hr = trpc.graph.searchNodes.useQuery({ q: ':', moduleKey: 'hr', limit });
  const legal = trpc.graph.searchNodes.useQuery({ q: ':', moduleKey: 'legal', limit });
  const compliance = trpc.graph.searchNodes.useQuery({ q: ':', moduleKey: 'compliance', limit });
  const finance = trpc.graph.searchNodes.useQuery({ q: ':', moduleKey: 'finance', limit });
  const logistics = trpc.graph.searchNodes.useQuery({ q: ':', moduleKey: 'logistics', limit });
  const queries = [hr, legal, compliance, finance, logistics];
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const byModule = useMemo(() => {
    const out = new Map<ModuleKey, LeafNode[]>();
    MODULES.forEach((m, i) => {
      out.set(
        m.key,
        (queries[i].data ?? []).map((n) => ({ id: n.id, iri: n.iri, label: n.label, moduleKey: n.moduleKey })),
      );
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hr.data, legal.data, compliance.data, finance.data, logistics.data]);
  return { byModule, isLoading, isError };
}

interface LiveToast {
  id: number;
  text: string;
}

/**
 * Dashboard §3a — Living Knowledge Graph mini-map. Real module list and real
 * sampled instances from the tRPC API; clusters bloom on mount, then withheld
 * real nodes materialize one at a time on a 6s live tick (bounded pool).
 */
export function GraphMiniMap() {
  const navigate = useNavigate();
  const overview = trpc.dashboard.overview.useQuery();
  const { byModule, isLoading, isError } = useModuleSamples(16);

  // reveal: 0 = hubs, 1 = half the leaves, 2 = all but the live pool
  const [reveal, setReveal] = useState(0);
  const [liveAdded, setLiveAdded] = useState<LeafNode[]>([]);
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const toastId = useRef(1);
  const poolIndex = useRef(0);

  // Live-insert pool: last 4 real samples per module, round-robin interleaved
  // so inserts rotate through module colors. Pure derivation from query data.
  const livePool = useMemo(() => {
    const interleaved: LeafNode[] = [];
    for (let i = 0; i < 4; i++) for (const m of MODULES) {
      const arr = (byModule.get(m.key) ?? []).slice(12);
      if (arr[i]) interleaved.push(arr[i]);
    }
    return interleaved;
  }, [byModule]);

  // Bloom: hubs → first ring → full graph (~1.4s total, per design)
  useEffect(() => {
    const t1 = window.setTimeout(() => setReveal(1), 450);
    const t2 = window.setTimeout(() => setReveal(2), 1050);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // Live tick: every 6s a withheld real node materializes (bounded by pool).
  useEffect(() => {
    if (livePool.length === 0) return;
    const iv = window.setInterval(() => {
      const next = livePool[poolIndex.current++];
      if (!next) {
        window.clearInterval(iv);
        return;
      }
      setLiveAdded((a) => [...a, next]);
      const id = toastId.current++;
      const mod = getModule((next.moduleKey as ModuleKey) ?? 'custom');
      setToasts((t) => [...t.slice(-2), { id, text: `+ ${next.iri} materialized — ${mod.label} sync` }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    }, 6000);
    return () => window.clearInterval(iv);
  }, [livePool]);

  const { nodes, edges } = useMemo(() => {
    const wsName = overview.data?.workspace.name ?? 'Acme Corp';
    const nodes: GraphNode[] = [{ id: 'ws', label: wsName, glyph: 'AC', size: 40 }];
    const edges: GraphEdge[] = [];
    const activeMods = MODULES.filter((m) => (byModule.get(m.key)?.length ?? 0) > 0);
    for (const m of activeMods) {
      nodes.push({ id: `mod:${m.key}`, label: m.name, module: m.key, size: 34 });
      edges.push({ id: `ws->${m.key}`, source: 'ws', target: `mod:${m.key}` });
    }
    // cross-module links between neighboring clusters (design: thicker iris edges)
    for (let i = 0; i + 1 < activeMods.length; i++) {
      edges.push({
        id: `x:${activeMods[i].key}->${activeMods[i + 1].key}`,
        source: `mod:${activeMods[i].key}`,
        target: `mod:${activeMods[i + 1].key}`,
      });
    }
    const visibleLeafCount = reveal === 0 ? 0 : reveal === 1 ? 6 : 12;
    for (const m of activeMods) {
      const all = byModule.get(m.key) ?? [];
      const leaves = [...all.slice(0, visibleLeafCount), ...liveAdded.filter((n) => n.moduleKey === m.key)];
      for (const n of leaves) {
        nodes.push({ id: `n:${n.id}`, label: n.label, module: m.key, size: 24 });
        edges.push({ id: `mod:${m.key}->n:${n.id}`, source: `mod:${m.key}`, target: `n:${n.id}` });
      }
    }
    return { nodes, edges };
  }, [byModule, reveal, liveAdded, overview.data]);

  const onNodeClick = (nodeId: string) => {
    if (nodeId.startsWith('n:')) {
      const node = [...byModule.values()].flat().find((n) => `n:${n.id}` === nodeId);
      if (node) navigate(`/app/explorer?q=${encodeURIComponent(node.label)}`);
    } else if (nodeId.startsWith('mod:')) {
      navigate(getModule(nodeId.slice(4) as ModuleKey).route);
    }
  };

  const snapshot = overview.data?.kpis.snapshot;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1, ease: EASE }}
      className="flex h-[420px] flex-col rounded-xl border border-border-hairline bg-bg-panel"
    >
      <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">
          Living Knowledge Graph
        </h2>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-text-muted">
            {snapshot ? `snapshot ${snapshot.label} · updated ${relTime(snapshot.createdAt)}` : 'loading snapshot…'}
          </span>
          <button
            type="button"
            aria-label="Open in Graph Explorer"
            title="Open in Graph Explorer"
            onClick={() => navigate('/app/explorer')}
            className="rounded-lg border border-border-hairline p-1.5 text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 px-3 pb-3">
        {isLoading ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-border-hairline bg-bg-void">
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="size-2.5 animate-pulse rounded-full"
                  style={{ backgroundColor: MODULES[i].color, animationDelay: `${i * 160}ms` }}
                />
              ))}
              <span className="ml-2 font-mono text-[11px] text-text-muted">sampling graph…</span>
            </div>
          </div>
        ) : isError || nodes.length <= 1 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-hairline bg-bg-void">
            <span className="size-14 rounded-full border-2 border-dashed border-border-glow" aria-hidden />
            <p className="text-[13px] text-text-muted">
              {isError ? 'Graph service unreachable — retry shortly.' : 'No instances synced yet.'}
            </p>
            <button
              type="button"
              onClick={() => navigate('/app/mapping')}
              className="rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
            >
              Open Mapping &amp; Sync
            </button>
          </div>
        ) : (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            onNodeClick={onNodeClick}
            className="h-full"
          />
        )}

        {/* Live-insert toasts, bottom-left of canvas */}
        <div className="pointer-events-none absolute bottom-6 left-6 z-10 flex flex-col gap-1.5">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                className="w-fit rounded-lg border border-border-hairline bg-bg-panel/90 px-2.5 py-1.5 font-mono text-[11px] text-text-secondary backdrop-blur"
              >
                {t.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}
