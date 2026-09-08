import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, NodeSingular, StylesheetCSS } from 'cytoscape';
import cytoscapeFcose from 'cytoscape-fcose';
import { Eye, EyeOff, Maximize2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKY_COLOR, TWIN_COLOR, classMeta, type TopologyEdge, type TopologyNode } from './meta';

cytoscape.use(cytoscapeFcose);

const SLATE = '#64748B';
const AMBER = '#FBBF24';

/** Edge vocabulary — colors/dashes per twin predicate (design §4c). */
const EDGE_STYLE: Record<string, { color: string; dash?: number[]; width: number; label: string }> = {
  'dtwin:contains': { color: TWIN_COLOR, width: 1.5, label: 'contains' },
  'dtwin:locatedIn': { color: SLATE, width: 1.5, label: 'locatedIn' },
  'dtwin:connectedTo': { color: TWIN_COLOR, width: 1.5, dash: [6, 4], label: 'connectedTo' },
  'dtwin:monitors': { color: AMBER, width: 1.5, label: 'monitors' },
  'dtwin:twinOf': { color: TWIN_COLOR, width: 2.5, dash: [10, 6], label: 'twinOf' },
};

const LEGEND = [
  { key: 'contains', color: TWIN_COLOR, dash: false, note: 'warehouse → zones · zone → equipment' },
  { key: 'locatedIn', color: SLATE, dash: false, note: 'asset → facility' },
  { key: 'connectedTo', color: TWIN_COLOR, dash: true, note: 'peer twins' },
  { key: 'twinOf', color: `linear ${TWIN_COLOR}→${SKY_COLOR}`, dash: true, note: 'twin → physical KG node' },
  { key: 'monitors', color: AMBER, dash: false, note: 'sensor → zone/asset' },
];

export interface TwinTopologyCanvasProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  centerIri: string;
  onNodeClick?: (iri: string, moduleKey: string) => void;
  className?: string;
}

type LayoutMode = 'force' | 'hierarchy';

function toElements(nodes: TopologyNode[], edges: TopologyEdge[]): ElementDefinition[] {
  const els: ElementDefinition[] = nodes.map((n) => {
    const physical = n.moduleKey !== 'twin';
    return {
      data: {
        id: n.iri,
        label: n.label,
        glyph: physical ? n.label.slice(0, 2).toUpperCase() : classMeta(n.classIri).glyph,
        color: physical ? SKY_COLOR : TWIN_COLOR,
        size: physical ? 26 : 32,
        physical,
        moduleKey: n.moduleKey,
      },
    };
  });
  for (const e of edges) {
    const from = nodes.find((n) => n.id === e.fromNodeId);
    const to = nodes.find((n) => n.id === e.toNodeId);
    if (!from || !to) continue;
    const st = EDGE_STYLE[e.predicateIri] ?? { color: SLATE, width: 1.5, label: e.predicateIri.split(':')[1] ?? '' };
    const isTwinOf = e.predicateIri === 'dtwin:twinOf';
    els.push({
      data: {
        id: `e${e.id}`,
        source: from.iri,
        target: to.iri,
        label: st.label,
        edgeColor: st.color,
        edgeWidth: st.width,
      },
      classes: isTwinOf ? 'flow' : st.dash ? 'dashed' : '',
    });
  }
  return els;
}

const STYLE = [
  {
    selector: 'node',
    style: {
      width: 'data(size)',
      height: 'data(size)',
      'background-color': 'data(color)',
      'background-opacity': 0.18,
      'border-width': 1.5,
      'border-color': 'data(color)',
      label: 'data(glyph)',
      color: 'data(color)',
      'font-family': "'JetBrains Mono', monospace",
      'font-size': 10,
      'font-weight': 700,
      'text-valign': 'center',
      'text-halign': 'center',
      'overlay-padding': 4,
    },
  },
  {
    // physical KG mirror nodes — smaller, dashed outline
    selector: 'node[physical]',
    style: {
      'border-style': 'dashed',
      'background-opacity': 0.1,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'data(edgeWidth)',
      'line-color': 'data(edgeColor)',
      'target-arrow-color': 'data(edgeColor)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'curve-style': 'bezier',
      label: 'data(label)',
      color: '#64748B',
      'font-family': "'JetBrains Mono', monospace",
      'font-size': 8.5,
      'text-rotation': 'autorotate',
      'text-margin-y': -6,
      'text-background-color': '#070B14',
      'text-background-opacity': 0.85,
      'text-background-padding': 2,
    },
  },
  {
    selector: 'edge.dashed',
    style: {
      'line-style': 'dashed',
      'line-dash-pattern': [6, 4],
    },
  },
  {
    // the money edge — teal → sky gradient
    selector: 'edge.flow',
    style: {
      'line-fill': 'linear-gradient',
      'line-gradient-stop-colors': [TWIN_COLOR, SKY_COLOR],
      'line-dash-pattern': [10, 6],
      'target-arrow-color': SKY_COLOR,
      opacity: 0.95,
    },
  },
  {
    selector: '.faded',
    style: { opacity: 0.15, 'text-opacity': 0.15 },
  },
  {
    selector: '.mirrors-dim',
    style: { opacity: 0.12, 'text-opacity': 0.12 },
  },
  {
    selector: 'node.highlight',
    style: {
      'background-opacity': 0.45,
      'border-width': 2,
      'underlay-color': 'data(color)',
      'underlay-opacity': 0.18,
      'underlay-padding': 8,
    },
  },
  {
    selector: 'edge.highlight',
    style: { opacity: 1, 'underlay-color': 'data(edgeColor)', 'underlay-opacity': 0.2, 'underlay-padding': 3 },
  },
] as unknown as StylesheetCSS[];

/**
 * TwinTopologyCanvas — twin-aware graph canvas (same engine/visual language
 * as the shared GraphCanvas): teal twin nodes, sky dashed physical mirrors,
 * the five-predicate edge vocabulary, flowing twinOf edges, legend, layout
 * toggle and a physical-mirror dimmer. Rendering pauses offscreen.
 */
export function TwinTopologyCanvas({
  nodes,
  edges,
  centerIri,
  onNodeClick,
  className,
}: TwinTopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const clickRef = useRef(onNodeClick);
  clickRef.current = onNodeClick;
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [showMirrors, setShowMirrors] = useState(true);
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;

  const runLayout = (cy: Core, mode: LayoutMode) => {
    const root = cy.getElementById(centerIri);
    const opts =
      mode === 'force'
        ? ({ name: 'fcose', animate: false, randomize: true, nodeRepulsion: 6500, idealEdgeLength: 90, gravity: 0.35, padding: 40 } as unknown as LayoutOptions)
        : ({
            name: 'breadthfirst',
            animate: false,
            directed: true,
            ...(root.nonempty() ? { roots: root } : {}),
            spacingFactor: 1.25,
            padding: 40,
          } as unknown as LayoutOptions);
    cy.layout(opts).run();
  };
  const runLayoutRef = useRef(runLayout);
  runLayoutRef.current = runLayout;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const cy = cytoscape({
      container: el,
      elements: toElements(nodes, edges),
      style: STYLE,
      wheelSensitivity: 0.2,
      minZoom: 0.25,
      maxZoom: 3,
    });
    cyRef.current = cy;

    const clearHighlight = () => cy.elements().removeClass('faded highlight');
    cy.on('mouseover', 'node', (evt) => {
      const node: NodeSingular = evt.target;
      const neighborhood = node.closedNeighborhood();
      cy.elements().not(neighborhood).addClass('faded');
      neighborhood.addClass('highlight');
    });
    cy.on('mouseout', 'node', clearHighlight);
    cy.on('tap', 'node', (evt) => {
      const node: NodeSingular = evt.target;
      if (clickRef.current) clickRef.current(node.id(), String(node.data('moduleKey')));
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) clearHighlight();
    });

    runLayoutRef.current(cy, layoutModeRef.current);

    // bloom-in: nodes stagger from the center node
    const center = cy.getElementById(centerIri);
    const ordered = cy.nodes().sort((a, b) => {
      const d = (n: NodeSingular) => (center.nonempty() ? n.neighborhood().intersection(center).length : 0);
      return d(b) - d(a);
    });
    const bloomTimers: number[] = [];
    ordered.forEach((n, i) => {
      n.style('opacity', 0);
      bloomTimers.push(
        window.setTimeout(() => {
          n.animate({ style: { opacity: 1 } }, { duration: 350 });
        }, Math.min(i, 14) * 60),
      );
    });

    // flowing dashes on twinOf edges (~12fps, paused offscreen)
    let offset = 0;
    let visible = true;
    const flow = window.setInterval(() => {
      if (!visible || document.hidden) return;
      offset = (offset + 1.6) % 16;
      cy.style().selector('edge.flow').style('line-dash-offset', -offset).update();
    }, 84);

    const pausable = cy as unknown as { start(): void; stop(): void };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) pausable.start();
        else pausable.stop();
      },
      { threshold: 0.05 },
    );
    io.observe(el);

    return () => {
      window.clearInterval(flow);
      bloomTimers.forEach((t) => window.clearTimeout(t));
      io.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // Rebuild only when the graph data identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(nodes), JSON.stringify(edges), centerIri]);

  // layout mode switching without a rebuild
  useEffect(() => {
    const cy = cyRef.current;
    if (cy) runLayout(cy, layoutMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode]);

  // physical-mirror dimmer
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('mirrors-dim');
    if (!showMirrors) {
      cy.nodes('[physical]').addClass('mirrors-dim');
      cy.edges('edge.flow').addClass('mirrors-dim');
    }
  }, [showMirrors, nodes, edges]);

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border-hairline bg-bg-void', className)}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* legend — edge vocabulary */}
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-border-hairline bg-bg-panel/90 px-2.5 py-2 backdrop-blur">
        {LEGEND.map((l) => (
          <span key={l.key} className="flex items-center gap-2" title={l.note}>
            <svg width="22" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="22"
                y2="3"
                stroke={l.key === 'twinOf' ? TWIN_COLOR : l.color}
                strokeWidth={l.key === 'twinOf' ? 2.5 : 1.5}
                strokeDasharray={l.dash ? '5 3' : undefined}
              />
            </svg>
            <span className="font-mono text-[9.5px] text-text-secondary">{l.key}</span>
          </span>
        ))}
        <span className="mt-0.5 flex items-center gap-2 border-t border-border-hairline pt-1">
          <span className="inline-block size-2.5 rounded-full border border-dashed" style={{ borderColor: SKY_COLOR }} aria-hidden />
          <span className="font-mono text-[9.5px] text-text-muted">physical mirror (sky)</span>
        </span>
      </div>

      {/* layout + mirrors toggles */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-xl border border-border-hairline bg-bg-panel/90 px-2 py-1.5 backdrop-blur">
        {(['force', 'hierarchy'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setLayoutMode(m)}
            className={cn(
              'rounded-md px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors',
              layoutMode === m ? 'bg-module-twin/15 text-module-twin' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {m}
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-border-hairline" aria-hidden />
        <button
          type="button"
          onClick={() => setShowMirrors((s) => !s)}
          title="show physical mirrors"
          className={cn(
            'flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors',
            showMirrors ? 'bg-info/15 text-info' : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {showMirrors ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          mirrors
        </button>
      </div>

      {/* zoom controls */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col overflow-hidden rounded-lg border border-border-hairline bg-bg-panel/90 backdrop-blur">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)} className="p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary">
          <Plus className="size-3.5" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)} className="border-t border-border-hairline p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary">
          <Minus className="size-3.5" />
        </button>
        <button type="button" aria-label="Fit graph" onClick={() => cyRef.current?.fit(undefined, 40)} className="border-t border-border-hairline p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary">
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export default TwinTopologyCanvas;
