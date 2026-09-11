import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, NodeSingular, StylesheetCSS } from 'cytoscape';
import cytoscapeFcose from 'cytoscape-fcose';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getModule, type ModuleKey } from '@/lib/modules';

cytoscape.use(cytoscapeFcose);

export interface EvidenceNode {
  id: string;
  label: string;
  module?: ModuleKey;
  glyph?: string;
  size?: number;
  /** Ghost node — expected by an axiom but absent from the graph */
  ghost?: boolean;
}

export interface EvidenceEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  /** Missing edge — dashed risk-red, drawn where an edge should exist */
  missing?: boolean;
}

export interface EvidenceCanvasProps {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  onNodeClick?: (nodeId: string, node: EvidenceNode) => void;
  className?: string;
  controls?: boolean;
  /** Node ids to emphasize (e.g. a computed path) */
  highlightIds?: string[];
}

function toElements(nodes: EvidenceNode[], edges: EvidenceEdge[]): ElementDefinition[] {
  const els: ElementDefinition[] = nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.label,
      glyph: (n.glyph ?? n.label.slice(0, 2)).toUpperCase(),
      color: n.ghost ? '#64748B' : getModule(n.module ?? 'custom').color,
      size: n.size ?? 32,
    },
    classes: n.ghost ? 'ghost' : '',
  }));
  for (const e of edges) {
    els.push({
      data: {
        id: e.id ?? `${e.source}->${e.target}${e.label ? `:${e.label}` : ''}`,
        source: e.source,
        target: e.target,
        label: e.label ?? '',
      },
      classes: e.missing ? 'missing' : '',
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
  {
    // Ghost node: expected but absent — dashed slate outline, no fill
    selector: 'node.ghost',
    style: {
      'background-opacity': 0.04,
      'border-style': 'dashed',
      'border-width': 1.5,
      'border-color': '#F87171',
      color: '#F87171',
      'border-opacity': 0.75,
    },
  },
  {
    // Missing edge: dashed risk-red — "expected by axiom, absent in graph"
    selector: 'edge.missing',
    style: {
      'line-color': '#F87171',
      'target-arrow-color': '#F87171',
      'line-style': 'dashed',
      'line-dash-pattern': [6, 4],
      width: 1.5,
      opacity: 0.85,
      color: '#F87171',
    },
  },
  {
    selector: '.faded',
    style: { opacity: 0.15, 'text-opacity': 0.15 },
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
    style: {
      'line-color': '#818CF8',
      'target-arrow-color': '#818CF8',
      width: 2,
      opacity: 1,
    },
  },
  {
    // Path emphasis (analytics "Paths" tab)
    selector: 'node.path',
    style: {
      'background-opacity': 0.5,
      'border-width': 2.5,
      'underlay-color': '#818CF8',
      'underlay-opacity': 0.25,
      'underlay-padding': 6,
    },
  },
  {
    selector: 'edge.path',
    style: {
      'line-color': '#818CF8',
      'target-arrow-color': '#818CF8',
      width: 2.5,
      opacity: 1,
    },
  },
] as unknown as StylesheetCSS[];

/**
 * EvidenceCanvas — Cytoscape canvas in the GraphCanvas visual language,
 * extended for insight traces: ghost nodes (expected but absent) and
 * dashed risk-red "missing" edges. Used by the Insights trace drawer and
 * the analytics path view.
 */
export function EvidenceCanvas({
  nodes,
  edges,
  onNodeClick,
  className,
  controls = true,
  highlightIds,
}: EvidenceCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const clickRef = useRef(onNodeClick);
  useEffect(() => {
    clickRef.current = onNodeClick;
  });
  const highlightKey = (highlightIds ?? []).join(',');

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
      const id: string = node.id();
      const data = nodes.find((n) => n.id === id);
      if (data && clickRef.current) clickRef.current(id, data);
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) clearHighlight();
    });

    if (highlightIds && highlightIds.length) {
      const set = new Set(highlightIds);
      cy.nodes().forEach((n) => {
        if (set.has(n.id())) n.addClass('path');
      });
      cy.edges().forEach((e) => {
        if (set.has(e.source().id()) && set.has(e.target().id())) e.addClass('path');
      });
    }

    cy.layout({
      name: 'fcose',
      animate: false,
      randomize: true,
      nodeRepulsion: 6500,
      idealEdgeLength: 90,
      gravity: 0.35,
      padding: 40,
    } as unknown as LayoutOptions).run();

    const pausable = cy as unknown as { start(): void; stop(): void };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) pausable.start();
        else pausable.stop();
      },
      { threshold: 0.05 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
    // Rebuild only when the graph data identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(nodes), JSON.stringify(edges), highlightKey]);

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border-hairline bg-bg-void', className)}>
      <div ref={containerRef} className="absolute inset-0" />
      {controls && (
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
      )}
    </div>
  );
}

export default EvidenceCanvas;
