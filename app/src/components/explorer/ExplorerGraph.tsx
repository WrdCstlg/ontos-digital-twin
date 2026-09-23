import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, NodeSingular, StylesheetCSS } from 'cytoscape';
import cytoscapeFcose from 'cytoscape-fcose';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getModule, type ModuleKey } from '@/lib/modules';
import type { ExplorerEdge, ExplorerNode } from './types';

cytoscape.use(cytoscapeFcose);

export type ExplorerLayout = 'force' | 'radial' | 'hierarchy' | 'timeline';

export interface ExplorerGraphProps {
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
  onNodeClick?: (iri: string) => void;
  /** Node to pulse (module-colored ring) */
  selectedIri?: string | null;
  layout: ExplorerLayout;
  /** Animate edge dash flow (provenance direction) */
  provenanceFlow: boolean;
  /** Tour target — module to fly the camera to (null = fit all) */
  focusModule: ModuleKey | null;
  /** Increment to retrigger the camera flight */
  focusSignal: number;
  className?: string;
}

const MODULE_KEYS = new Set<string>(['hr', 'legal', 'compliance', 'finance', 'logistics', 'custom']);

function toElements(nodes: ExplorerNode[], edges: ExplorerEdge[]): ElementDefinition[] {
  const iriById = new Map(nodes.map((n) => [n.id, n.iri]));
  const els: ElementDefinition[] = nodes.map((n) => {
    const key = MODULE_KEYS.has(n.moduleKey) ? (n.moduleKey as ModuleKey) : 'custom';
    return {
      data: {
        id: n.iri,
        label: n.label,
        glyph: n.label.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '··',
        color: getModule(key).color,
        module: key,
        size: 32,
      },
    };
  });
  for (const e of edges) {
    const source = iriById.get(e.fromNodeId);
    const target = iriById.get(e.toNodeId);
    if (!source || !target) continue;
    els.push({
      data: {
        id: `e${e.id}`,
        source,
        target,
        label: e.predicateIri.split(':').pop() ?? '',
      },
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
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#334155',
      'target-arrow-color': '#334155',
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
  { selector: '.faded', style: { opacity: 0.15, 'text-opacity': 0.15 } },
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
    style: { 'line-color': '#818CF8', 'target-arrow-color': '#818CF8', width: 2, opacity: 1 },
  },
  {
    selector: 'node.pulse',
    style: {
      'background-opacity': 0.5,
      'border-width': 2,
      'underlay-color': 'data(color)',
      'underlay-opacity': 0.35,
      'underlay-padding': 8,
    },
  },
  {
    selector: 'edge.flow',
    style: { 'line-dash-pattern': [8, 6], 'line-color': '#475569', 'target-arrow-color': '#475569' },
  },
] as unknown as StylesheetCSS[];

const LAYOUTS: Record<Exclude<ExplorerLayout, 'hierarchy'>, LayoutOptions> = {
  force: { name: 'fcose', animate: false, randomize: true, nodeRepulsion: 6500, idealEdgeLength: 90, gravity: 0.35, padding: 40 } as unknown as LayoutOptions,
  radial: { name: 'concentric', animate: true, animationDuration: 500, padding: 40, minNodeSpacing: 24 } as unknown as LayoutOptions,
  timeline: { name: 'grid', animate: true, animationDuration: 500, padding: 40 } as unknown as LayoutOptions,
};

/**
 * Hierarchy layout in which every node sits below everything it points to.
 * The graph's structural predicates run child → parent — memberOf, reportsTo,
 * parentUnit — so each parent lands above its children and every arrow points
 * up to its object. Cytoscape's breadthfirst can't express this: unrooted, it
 * roots each component at its busiest node, which drew Acme Corp beneath one of
 * its own departments; rooted at the sinks, depth follows the nearest root, so
 * an employee with a skill rose above their department and the arrow flipped.
 */
function hierarchyLayout(cy: Core): LayoutOptions {
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const heightOf = (node: NodeSingular): number => {
    const id = node.id();
    const known = level.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // a cycle: break it here
    visiting.add(id);
    let h = 0;
    node.outgoers('node').forEach((target) => {
      if (target.id() !== id) h = Math.max(h, heightOf(target) + 1);
    });
    visiting.delete(id);
    level.set(id, h);
    return h;
  };
  cy.nodes().forEach((n) => {
    heightOf(n);
  });

  // Levels top-down. Within a level, order nodes by the mean x of what they
  // point to above, which keeps edges from crossing needlessly. A level wider
  // than the canvas wraps onto extra lines; they all stay below the level they
  // point to, so arrows still only point up.
  const GAP_X = 70;
  const LINE_GAP = 70;
  const LEVEL_GAP = 130;
  const maxPerLine = Math.max(12, Math.ceil(Math.sqrt(cy.nodes().length) * 1.8));
  const levels: string[][] = [];
  level.forEach((h, id) => (levels[h] ??= []).push(id));
  const pos = new Map<string, { x: number; y: number }>();
  let y = 0;
  levels.forEach((row, h) => {
    if (h > 0) {
      const anchor = (id: string) => {
        const xs = cy
          .getElementById(id)
          .outgoers('node')
          .map((t) => pos.get(t.id())?.x)
          .filter((v): v is number => v !== undefined);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      };
      row.sort((a, b) => anchor(a) - anchor(b));
    }
    for (let start = 0; start < row.length; start += maxPerLine) {
      const line = row.slice(start, start + maxPerLine);
      const width = (line.length - 1) * GAP_X;
      line.forEach((id, i) => pos.set(id, { x: i * GAP_X - width / 2, y }));
      y += LINE_GAP;
    }
    y += LEVEL_GAP - LINE_GAP;
  });

  return {
    name: 'preset',
    positions: (node: NodeSingular) => pos.get(node.id()) ?? { x: 0, y: 0 },
    animate: true,
    animationDuration: 500,
    fit: true,
    padding: 40,
  } as unknown as LayoutOptions;
}

const layoutFor = (cy: Core, layout: ExplorerLayout): LayoutOptions =>
  layout === 'hierarchy' ? hierarchyLayout(cy) : LAYOUTS[layout];

/**
 * ExplorerGraph — Explorer-specific Cytoscape canvas extending the shared
 * GraphCanvas behavior with: selected-node pulse ring, provenance edge
 * dash-flow, layout switcher, cinematic camera flights (tour waypoints)
 * and a live minimap.
 */
export function ExplorerGraph({
  nodes,
  edges,
  onNodeClick,
  selectedIri,
  layout,
  provenanceFlow,
  focusModule,
  focusSignal,
  className,
}: ExplorerGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const cyRef = useRef<Core | null>(null);
  const clickRef = useRef(onNodeClick);
  useEffect(() => {
    clickRef.current = onNodeClick;
  });

  const dataKey = `${nodes.map((n) => n.iri).join('|')}::${edges.map((e) => e.id).join('|')}`;

  // Build / rebuild the canvas when data changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cy = cytoscape({
      container: el,
      elements: toElements(nodes, edges),
      style: STYLE,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
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
      if (clickRef.current) clickRef.current(node.id());
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) clearHighlight();
    });

    cy.layout(LAYOUTS.force).run();

    // Minimap
    const mm = minimapRef.current;
    const ctx = mm?.getContext('2d');
    let mmRaf = 0;
    const drawMinimap = () => {
      if (!mm || !ctx) return;
      const w = mm.width;
      const h = mm.height;
      ctx.clearRect(0, 0, w, h);
      const els = cy.nodes();
      if (els.length === 0) return;
      const bb = els.boundingBox();
      const ext = cy.extent();
      const scale = Math.min(w / Math.max(bb.w, 1), h / Math.max(bb.h, 1)) * 0.92;
      const ox = (w - bb.w * scale) / 2 - bb.x1 * scale;
      const oy = (h - bb.h * scale) / 2 - bb.y1 * scale;
      for (const n of els) {
        const p = n.position();
        ctx.fillStyle = (n.data('color') as string) + '55';
        ctx.fillRect(ox + p.x * scale - 1, oy + p.y * scale - 1, 2.5, 2.5);
      }
      ctx.strokeStyle = 'rgba(129,140,248,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + ext.x1 * scale, oy + ext.y1 * scale, ext.w * scale, ext.h * scale);
    };
    const scheduleMm = () => {
      cancelAnimationFrame(mmRaf);
      mmRaf = requestAnimationFrame(drawMinimap);
    };
    cy.on('viewport layoutstop add remove', scheduleMm);
    scheduleMm();

    // Halt in-flight animations while offscreen; Cytoscape's core has no resume
    // (start() belongs to layouts), and none is needed — animations restart with
    // the next interaction or layout run.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) cy.stop();
      },
      { threshold: 0.05 },
    );
    io.observe(el);

    return () => {
      cancelAnimationFrame(mmRaf);
      io.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // Layout switching
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout(layoutFor(cy, layout)).run();
  }, [layout, dataKey]);

  // Selected-node pulse (underlay padding oscillates 8→12→8 over 1.2s)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('pulse');
    if (!selectedIri) return;
    const node = cy.getElementById(selectedIri);
    if (node.empty()) return;
    node.addClass('pulse');
    let on = false;
    const iv = setInterval(() => {
      on = !on;
      node.style('underlay-padding', on ? 13 : 7);
    }, 600);
    return () => clearInterval(iv);
  }, [selectedIri, dataKey]);

  // Provenance edge flow (animated dash offset)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const edgesEl = cy.edges();
    if (!provenanceFlow) {
      edgesEl.removeClass('flow');
      edgesEl.style('line-dash-offset', 0);
      return;
    }
    edgesEl.addClass('flow');
    let off = 0;
    const iv = setInterval(() => {
      off = (off + 2) % 28;
      edgesEl.style('line-dash-offset', -off);
    }, 100);
    return () => {
      clearInterval(iv);
      edgesEl.removeClass('flow');
      edgesEl.style('line-dash-offset', 0);
    };
  }, [provenanceFlow, dataKey]);

  // Cinematic camera flight
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || focusSignal === 0) return;
    const target = focusModule ? cy.nodes(`[module = "${focusModule}"]`) : cy.elements();
    if (target.empty()) return;
    cy.animate(
      { fit: { eles: target, padding: focusModule ? 110 : 48 } },
      { duration: 1000, easing: 'ease-in-out-cubic' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  return (
    <div className={cn('relative overflow-hidden bg-bg-void', className)}>
      <div ref={containerRef} className="absolute inset-0" />
      {/* Zoom controls */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col overflow-hidden rounded-lg border border-border-hairline bg-bg-panel/90 backdrop-blur">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoom(1.25)}
          className="p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoom(0.8)}
          className="border-t border-border-hairline p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Fit graph"
          onClick={() => cyRef.current?.fit(undefined, 40)}
          className="border-t border-border-hairline p-2 text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>
      {/* Minimap */}
      <canvas
        ref={minimapRef}
        width={120}
        height={80}
        className="absolute bottom-3 right-3 z-10 rounded-lg border border-border-hairline bg-bg-panel/60 opacity-70 backdrop-blur"
        aria-hidden
      />
    </div>
  );
}

export default ExplorerGraph;
