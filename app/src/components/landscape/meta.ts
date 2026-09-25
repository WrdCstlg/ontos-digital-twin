/**
 * Presentation for the Landscape page: styles per service kind, capability
 * status and roadmap status, and the layout of the architecture diagram. All
 * content comes from lib/landscape.ts; nothing here restates it.
 */
import {
  ArrowRight,
  Check,
  CircleCheck,
  CircleX,
  Contrast,
  GitFork,
  Milestone,
  type LucideIcon,
} from 'lucide-react';
import type {
  Capability,
  CapabilityStatus,
  Link,
  Service,
  ServiceKind,
  roadmap,
} from '@/lib/landscape';

/* ── service kinds ───────────────────────────────────────────── */

export interface KindStyle {
  label: string;
  /** Row of the diagram: 0 = users and outside systems, 1 = processes, 2 = engines and stores. */
  tier: number;
  stroke: string;
  fill: string;
  text: string;
  swatch: string;
  chip: string;
}

// Full class strings (Tailwind only emits classes it can see), all design tokens.
export const KIND_STYLE: Record<ServiceKind, KindStyle> = {
  client: {
    label: 'Client',
    tier: 0,
    stroke: 'stroke-iris-bright',
    fill: 'fill-iris-bright',
    text: 'text-iris-bright',
    swatch: 'bg-iris-bright',
    chip: 'border-iris-bright/40 bg-iris-bright/10 text-iris-bright',
  },
  external: {
    label: 'External',
    tier: 0,
    stroke: 'stroke-text-secondary',
    fill: 'fill-text-secondary',
    text: 'text-text-secondary',
    swatch: 'bg-text-secondary',
    chip: 'border-text-secondary/40 bg-text-secondary/10 text-text-secondary',
  },
  process: {
    label: 'Process',
    tier: 1,
    stroke: 'stroke-info',
    fill: 'fill-info',
    text: 'text-info',
    swatch: 'bg-info',
    chip: 'border-info/40 bg-info/10 text-info',
  },
  engine: {
    label: 'Engine',
    tier: 2,
    stroke: 'stroke-module-legal',
    fill: 'fill-module-legal',
    text: 'text-module-legal',
    swatch: 'bg-module-legal',
    chip: 'border-module-legal/40 bg-module-legal/10 text-module-legal',
  },
  store: {
    label: 'Store',
    tier: 2,
    stroke: 'stroke-ok',
    fill: 'fill-ok',
    text: 'text-ok',
    swatch: 'bg-ok',
    chip: 'border-ok/40 bg-ok/10 text-ok',
  },
};

export const KIND_ORDER: ServiceKind[] = ['client', 'external', 'process', 'engine', 'store'];

export const TIER_LABEL = ['Users & outside systems', 'Processes', 'Engines & stores'];

/** "Increment 1" → 1. */
export function incrementOf(since: string | undefined): number | null {
  const m = since?.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Splits `code` spans out of a runtime string: odd parts were in backticks. */
export function tickParts(text: string): string[] {
  return text.split('`');
}

/* ── capability status ───────────────────────────────────────── */

export interface StatusStyle {
  icon: LucideIcon;
  chip: string;
  bar: string;
  accent: string;
  pill: string;
}

export const CAPABILITY_STATUS_ORDER: CapabilityStatus[] = ['has', 'partial', 'gap', 'planned', 'by-design'];

export const CAPABILITY_STYLE: Record<CapabilityStatus, StatusStyle> = {
  has: {
    icon: CircleCheck,
    chip: 'border-ok/35 bg-ok/10 text-ok',
    bar: 'bg-ok',
    accent: 'border-l-ok',
    pill: 'border-ok/50 bg-ok/15 text-ok',
  },
  partial: {
    icon: Contrast,
    chip: 'border-warn/35 bg-warn/10 text-warn',
    bar: 'bg-warn',
    accent: 'border-l-warn',
    pill: 'border-warn/50 bg-warn/15 text-warn',
  },
  gap: {
    icon: CircleX,
    chip: 'border-risk/35 bg-risk/10 text-risk',
    bar: 'bg-risk',
    accent: 'border-l-risk',
    pill: 'border-risk/50 bg-risk/15 text-risk',
  },
  planned: {
    icon: Milestone,
    chip: 'border-iris/45 bg-iris/15 text-text-accent',
    bar: 'bg-iris-bright',
    accent: 'border-l-iris-bright',
    pill: 'border-iris/50 bg-iris/15 text-text-accent',
  },
  'by-design': {
    icon: GitFork,
    chip: 'border-dashed border-text-secondary/50 bg-bg-inset text-text-secondary',
    bar: 'bg-text-secondary',
    accent: 'border-l-text-secondary',
    pill: 'border-text-secondary/50 bg-text-secondary/10 text-text-primary',
  },
};

/** "Planned · increment 2" for planned rows that name their increment. */
export function capabilityStatusText(c: Capability, labels: Record<CapabilityStatus, string>): string {
  return c.status === 'planned' && c.increment != null
    ? `${labels.planned} · increment ${c.increment}`
    : labels[c.status];
}

/* ── roadmap status ──────────────────────────────────────────── */

export type RoadmapEntry = (typeof roadmap)[number];
export type RoadmapStatus = RoadmapEntry['status'];

export const ROADMAP_STYLE: Record<
  RoadmapStatus,
  { label: string; icon: LucideIcon; chip: string; step: string; line: string }
> = {
  shipped: {
    label: 'Shipped',
    icon: Check,
    chip: 'border-ok/35 bg-ok/10 text-ok',
    step: 'border-ok bg-ok/15 text-ok',
    line: 'border-ok/60 border-solid',
  },
  next: {
    label: 'Next',
    icon: ArrowRight,
    chip: 'border-iris/45 bg-iris/15 text-text-accent',
    step: 'border-iris-bright bg-iris/20 text-text-accent',
    line: 'border-iris-bright/60 border-dashed',
  },
  planned: {
    label: 'Planned',
    icon: Milestone,
    chip: 'border-border-glow bg-bg-inset text-text-secondary',
    step: 'border-dashed border-border-glow bg-bg-inset text-text-muted',
    line: 'border-border-glow border-dashed',
  },
};

/* ── architecture layout ─────────────────────────────────────── */

export const NODE_W = 224;
export const NODE_H = 96;
const GAP_X = 52;
const GAP_Y = 120;
const PAD_X = 28;
const PAD_TOP = 40;
const PAD_BOTTOM = 24;
/** Characters of 10.5px mono that fit on one line of a node. */
const RUNTIME_CHARS = 30;
/**
 * The smallest scale the diagram is drawn at (10px text stays ≥ 9px). Narrower
 * than that, it scrolls sideways inside its card instead of shrinking.
 */
export const MIN_DIAGRAM_SCALE = 0.9;
/** Approximate advance of the 10px mono used for link labels, and the label pill's size. */
export const LABEL_CHAR_W = 6.1;
export const LABEL_PAD_X = 14;
export const LABEL_H = 18;
/** Where along its link a label may sit, in order of preference. */
const LABEL_POSITIONS = [0.5, 0.62, 0.38, 0.72, 0.28, 0.8, 0.2];

export function labelWidth(label: string): number {
  return label.length * LABEL_CHAR_W + LABEL_PAD_X;
}

export interface NodeBox {
  service: Service;
  tier: number;
  x: number;
  y: number;
  /** The runtime, wrapped for the node (at most two lines). */
  runtimeLines: string[];
}

export interface EdgeGeom {
  link: Link;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Label anchor. */
  lx: number;
  ly: number;
}

export interface ArchitectureLayout {
  width: number;
  height: number;
  nodes: NodeBox[];
  edges: EdgeGeom[];
  tiers: { tier: number; y: number }[];
}

/** Greedy word wrap into at most `maxLines` lines, with an ellipsis on overflow. */
export function wrapWords(text: string, maxChars: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  return kept;
}

/**
 * Lays services out in rows by kind (outside → processes → engines and stores)
 * and orders each row by the mean position of its neighbours, so links cross
 * as little as a simple heuristic allows. Rows are centred on the widest one.
 */
export function layoutArchitecture(services: Service[], links: Link[]): ArchitectureLayout {
  const byId = new Map(services.map((s) => [s.id, s]));
  const validLinks = links.filter((l) => byId.has(l.from) && byId.has(l.to));
  const neighbours = new Map<string, string[]>(services.map((s) => [s.id, []]));
  for (const l of validLinks) {
    neighbours.get(l.from)!.push(l.to);
    neighbours.get(l.to)!.push(l.from);
  }

  const tierIds = [...new Set(services.map((s) => KIND_STYLE[s.kind].tier))].sort((a, b) => a - b);
  const rows = tierIds.map((t) => services.filter((s) => KIND_STYLE[s.kind].tier === t));
  const maxRow = Math.max(1, ...rows.map((r) => r.length));
  const contentW = maxRow * NODE_W + (maxRow - 1) * GAP_X;
  const width = contentW + PAD_X * 2;

  const place = () => {
    const cx = new Map<string, number>();
    rows.forEach((row) => {
      const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
      const x0 = PAD_X + (contentW - rowW) / 2;
      row.forEach((s, i) => cx.set(s.id, x0 + i * (NODE_W + GAP_X) + NODE_W / 2));
    });
    return cx;
  };

  const dataIndex = new Map(services.map((s, i) => [s.id, i]));
  for (let sweep = 0; sweep < 3; sweep++) {
    // Middle rows first: they anchor the rows above and below.
    const order = rows.map((_, i) => i).sort((a, b) => Math.abs(a - (rows.length - 1) / 2) - Math.abs(b - (rows.length - 1) / 2));
    for (const r of order) {
      const cx = place();
      const bary = (s: Service) => {
        const ns = neighbours.get(s.id)!;
        return ns.length ? ns.reduce((sum, n) => sum + cx.get(n)!, 0) / ns.length : cx.get(s.id)!;
      };
      rows[r] = [...rows[r]].sort((a, b) => bary(a) - bary(b) || dataIndex.get(a.id)! - dataIndex.get(b.id)!);
    }
  }

  const cx = place();
  const nodes: NodeBox[] = [];
  const tiers: { tier: number; y: number }[] = [];
  rows.forEach((row, r) => {
    const y = PAD_TOP + r * (NODE_H + GAP_Y);
    tiers.push({ tier: tierIds[r], y });
    for (const s of row) {
      nodes.push({
        service: s,
        tier: tierIds[r],
        x: cx.get(s.id)! - NODE_W / 2,
        y,
        runtimeLines: wrapWords(s.runtime.replace(/`/g, ''), RUNTIME_CHARS),
      });
    }
  });
  const height = PAD_TOP + rows.length * NODE_H + (rows.length - 1) * GAP_Y + PAD_BOTTOM;

  const boxById = new Map(nodes.map((n) => [n.service.id, n]));
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const nodeRects: Rect[] = nodes.map((n) => ({ x0: n.x, y0: n.y, x1: n.x + NODE_W, y1: n.y + NODE_H }));
  const placedLabels: Rect[] = [];

  const edges: EdgeGeom[] = validLinks.map((link) => {
    const a = boxById.get(link.from)!;
    const b = boxById.get(link.to)!;
    const ax = a.x + NODE_W / 2;
    const ay = a.y + NODE_H / 2;
    const bx = b.x + NODE_W / 2;
    const by = b.y + NODE_H / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const clip = (px: number, py: number, sx: number, sy: number): [number, number] => {
      const t = Math.min(sx !== 0 ? NODE_W / 2 / Math.abs(sx) : Infinity, sy !== 0 ? NODE_H / 2 / Math.abs(sy) : Infinity);
      return [px + sx * t, py + sy * t];
    };
    const [x1, y1] = clip(ax, ay, dx, dy);
    const [x2, y2] = clip(bx, by, -dx, -dy);
    // Slide the label along its own link until it clears earlier labels and the nodes.
    const w = labelWidth(link.label);
    const at = (t: number): Rect & { lx: number; ly: number } => {
      const lx = x1 + (x2 - x1) * t;
      const ly = y1 + (y2 - y1) * t;
      return { lx, ly, x0: lx - w / 2 - 3, x1: lx + w / 2 + 3, y0: ly - LABEL_H / 2 - 2, y1: ly + LABEL_H / 2 + 2 };
    };
    const spot =
      LABEL_POSITIONS.map(at).find((r) => !placedLabels.some((p) => overlaps(p, r)) && !nodeRects.some((n) => overlaps(n, r))) ??
      at(0.5);
    placedLabels.push(spot);
    return { link, x1, y1, x2, y2, lx: spot.lx, ly: spot.ly };
  });

  return { width, height, nodes, edges, tiers };
}
