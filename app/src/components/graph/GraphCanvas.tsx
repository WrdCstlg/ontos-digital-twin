import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, LayoutOptions, NodeSingular, StylesheetCSS } from 'cytoscape';
import cytoscapeFcose from 'cytoscape-fcose';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getModule, type ModuleKey } from '@/lib/modules';

cytoscape.use(cytoscapeFcose);

export interface GraphNode {
  id: string;
  /** Human label rendered under the node */
  label: string;
  /** Module that owns this node — drives node color */
  module?: ModuleKey;
  /** 2-letter glyph rendered inside the circle (defaults to first 2 letters) */
  glyph?: string;
  /** Circle diameter px (28–40 per design) */
  size?: number;
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
}

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Called with the clicked node's id */
  onNodeClick?: (nodeId: string, node: GraphNode) => void;
  className?: string;
  /** Show zoom controls bottom-left (default true) */
  controls?: boolean;
  /** Run fcose layout on mount (default true). Set false if nodes carry positions. */
  layout?: boolean;
}

function toElements(nodes: GraphNode[], edges: GraphEdge[]): ElementDefinition[] {
  const els: ElementDefinition[] = nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.label,
      glyph: (n.glyph ?? n.label.slice(0, 2)).toUpperCase(),
      color: getModule(n.module ?? 'custom').color,
      size: n.size ?? 32,
    },
  }));
  for (const e of edges) {
    els.push({
      data: {
        id: e.id ?? `${e.source}->${e.target}${e.label ? `:${e.label}` : ''}`,
        source: e.source,
        target: e.target,
        label: e.label ?? '',
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
] as unknown as StylesheetCSS[];

/**
 * GraphCanvas — shared Cytoscape.js wrapper: dark canvas, module-colored
 * nodes with 2-letter glyphs, 1.5px slate edges with arrowheads, hover
 * neighborhood highlight, click callback, zoom controls, fcose layout.
 * Rendering pauses while the canvas is offscreen.
 */
export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  className,
  controls = true,
  layout = true,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const clickRef = useRef(onNodeClick);
  useEffect(() => {
    clickRef.current = onNodeClick;
  });

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

    const clearHighlight = () => {
      cy.elements().removeClass('faded highlight');
    };
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

    if (layout) {
      cy.layout({
        name: 'fcose',
        animate: false,
        randomize: true,
        nodeRepulsion: 6500,
        idealEdgeLength: 90,
        gravity: 0.35,
        padding: 40,
      } as unknown as LayoutOptions).run();
    }

    // Pause rendering offscreen / tab hidden
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
  }, [JSON.stringify(nodes), JSON.stringify(edges), layout]);

  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const w = cy.width();
    const h = cy.height();
    cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: w / 2, y: h / 2 } });
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

export default GraphCanvas;
