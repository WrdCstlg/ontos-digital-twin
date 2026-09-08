import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULES } from '@/lib/modules';
import { alpha } from './lib';

/**
 * Cross-Module Linking Axioms — the 5 module glyphs arranged in a pentagon
 * with labeled, animated edges. Static ontology metadata (axioms are part of
 * the shipped ontology contract).
 */

interface Axiom {
  from: string; // module key
  to: string;
  label: string; // e.g. "hr:Person —signs→ legal:Contract"
  predicate: string;
  cardinality: string;
  rationale: string;
}

const AXIOMS: Axiom[] = [
  { from: 'hr', to: 'legal', predicate: 'signs', label: 'hr:Person —signs→ lgl:Contract', cardinality: '0..*', rationale: 'Every contract signature traces to an accountable person.' },
  { from: 'compliance', to: 'finance', predicate: 'monitors', label: 'cmp:Control —monitors→ fin:Transaction', cardinality: '0..*', rationale: 'SOX controls observe postings in near-real time.' },
  { from: 'compliance', to: 'legal', predicate: 'governs', label: 'cmp:Policy —governs→ lgl:Contract', cardinality: '0..*', rationale: 'Policies constrain which clauses may be executed.' },
  { from: 'finance', to: 'logistics', predicate: 'settles', label: 'fin:Invoice —settles→ log:PurchaseOrder', cardinality: '1..1', rationale: 'Three-way match: invoice ↔ PO ↔ receipt.' },
  { from: 'hr', to: 'finance', predicate: 'owns', label: 'hr:OrgUnit —owns→ fin:CostCenter', cardinality: '0..*', rationale: 'Budget accountability follows the org tree.' },
  { from: 'legal', to: 'finance', predicate: 'references', label: 'lgl:Contract —references→ fin:Vendor', cardinality: '1..*', rationale: 'Counterparties resolve to payable vendor records.' },
  { from: 'logistics', to: 'finance', predicate: 'poVendor', label: 'log:PurchaseOrder —poVendor→ fin:Vendor', cardinality: '1..1', rationale: 'A PO is always raised against a known vendor.' },
  { from: 'compliance', to: 'legal', predicate: 'audits', label: 'cmp:Control —audits→ lgl:Matter', cardinality: '0..*', rationale: 'Litigation holds are tracked as control evidence.' },
  { from: 'finance', to: 'hr', predicate: 'allocatedTo', label: 'fin:CostCenter —allocatedTo→ hr:OrgUnit', cardinality: '1..1', rationale: 'Every cost center rolls up to exactly one org unit.' },
  { from: 'logistics', to: 'legal', predicate: 'underContract', label: 'log:Shipment —underContract→ lgl:Contract', cardinality: '0..1', rationale: 'Carrier movements cite their governing agreement.' },
  { from: 'hr', to: 'finance', predicate: 'approves', label: 'hr:Person —approves→ fin:Invoice', cardinality: '0..*', rationale: 'Payment run approval is an HR identity, not a string.' },
  { from: 'compliance', to: 'logistics', predicate: 'appliesTo', label: 'cmp:Policy —appliesTo→ log:Warehouse', cardinality: '0..*', rationale: 'Storage policies bind to physical locations.' },
  { from: 'finance', to: 'logistics', predicate: 'fulfills', label: 'fin:Transaction —fulfills→ log:PurchaseOrder', cardinality: '0..*', rationale: 'Payments close out procurement commitments.' },
  { from: 'legal', to: 'compliance', predicate: 'enforcedBy', label: 'lgl:Obligation —enforcedBy→ cmp:Control', cardinality: '0..*', rationale: 'Contractual obligations map to operating controls.' },
];

const VISIBLE = 5;
const VB_W = 1000;
const VB_H = 480;

/* pentagon node positions (clockwise from top) */
const NODE_POS: Record<string, { x: number; y: number }> = {
  hr: { x: 500, y: 70 },
  legal: { x: 662, y: 188 },
  compliance: { x: 600, y: 378 },
  finance: { x: 400, y: 378 },
  logistics: { x: 338, y: 188 },
};

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  /* bow edges slightly away from pentagon center for readability */
  const cx = mx + (mx - VB_W / 2) * 0.18;
  const cy = my + (my - VB_H / 2) * 0.18;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function edgeMid(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const cx = mx + (mx - VB_W / 2) * 0.18;
  const cy = (a.y + b.y) / 2 + ((a.y + b.y) / 2 - VB_H / 2) * 0.18;
  /* quadratic bezier midpoint t=0.5 */
  return { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y };
}

function colorOf(key: string): string {
  return MODULES.find((m) => m.key === key)?.color ?? '#94A3B8';
}
function glyphOf(key: string): string {
  return MODULES.find((m) => m.key === key)?.glyph ?? '/empty-graph.svg';
}

export function AxiomMap() {
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const shown = AXIOMS.slice(0, VISIBLE);
  const rest = AXIOMS.slice(VISIBLE);

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-border-hairline bg-bg-panel p-6"
      aria-label="Cross-module linking axioms"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[20px] font-semibold tracking-[-0.015em] text-text-primary">
          Cross-Module Linking Axioms
        </h2>
        <p className="font-mono text-[11.5px] text-text-muted">{AXIOMS.length} axioms · enforced at mapping time</p>
      </div>

      <div className="relative mt-4">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full" role="img" aria-label="Axiom pentagon map">
          <defs>
            {shown.map((ax, i) => (
              <linearGradient key={i} id={`axg-${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={colorOf(ax.from)} />
                <stop offset="100%" stopColor={colorOf(ax.to)} />
              </linearGradient>
            ))}
          </defs>

          {/* edges */}
          {shown.map((ax, i) => {
            const a = NODE_POS[ax.from];
            const b = NODE_POS[ax.to];
            const d = edgePath(a, b);
            const mid = edgeMid(a, b);
            const hot = hovered === i;
            return (
              <g key={i}>
                {/* invisible fat hit area */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={18}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  className="cursor-pointer"
                />
                {/* base edge — draw-in */}
                <motion.path
                  d={d}
                  fill="none"
                  stroke={`url(#axg-${i})`}
                  strokeWidth={hot ? 3 : 1.5}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  whileInView={{ pathLength: 1, opacity: hot ? 1 : 0.55 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.6, delay: 0.4 + i * 0.12, ease: 'easeOut' }}
                  style={{ filter: hot ? `drop-shadow(0 0 6px ${alpha(colorOf(ax.from), 0.7)})` : undefined }}
                />
                {/* flowing dash overlay */}
                <motion.path
                  d={d}
                  fill="none"
                  stroke={`url(#axg-${i})`}
                  strokeWidth={hot ? 2.4 : 1.2}
                  strokeDasharray="4 16"
                  strokeLinecap="round"
                  opacity={hot ? 0.95 : 0.5}
                  animate={{ strokeDashoffset: [0, -80] }}
                  transition={{ duration: 7.5, repeat: Infinity, ease: 'linear' }}
                  pointerEvents="none"
                />
                {/* edge label */}
                <text
                  x={mid.x}
                  y={mid.y - 8}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  fill={hot ? '#F1F5F9' : '#64748B'}
                  fontSize={12}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                >
                  {ax.predicate}
                </text>
              </g>
            );
          })}

          {/* nodes */}
          {Object.entries(NODE_POS).map(([key, pos], i) => {
            const color = colorOf(key);
            const glowing =
              hovered != null && (shown[hovered].from === key || shown[hovered].to === key);
            return (
              <motion.g
                key={key}
                initial={{ scale: 0, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22, delay: i * 0.08 }}
                style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={34}
                  fill={alpha(color, glowing ? 0.22 : 0.08)}
                  stroke={alpha(color, glowing ? 0.9 : 0.35)}
                  strokeWidth={glowing ? 2 : 1}
                  style={glowing ? { filter: `drop-shadow(0 0 10px ${alpha(color, 0.8)})` } : undefined}
                />
                <image
                  href={glyphOf(key)}
                  x={pos.x - 22}
                  y={pos.y - 22}
                  width={44}
                  height={44}
                />
                <text
                  x={pos.x}
                  y={pos.y + 52}
                  textAnchor="middle"
                  fill={color}
                  fontSize={11}
                  fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}
                >
                  {MODULES.find((m) => m.key === key)?.label}
                </text>
              </motion.g>
            );
          })}
        </svg>

        {/* tooltip */}
        {hovered != null && (
          <div
            className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 -translate-y-full rounded-xl border border-border-hairline bg-bg-panel-raised p-3 shadow-2xl"
            style={{
              left: `${(edgeMid(NODE_POS[shown[hovered].from], NODE_POS[shown[hovered].to]).x / VB_W) * 100}%`,
              top: `${(edgeMid(NODE_POS[shown[hovered].from], NODE_POS[shown[hovered].to]).y / VB_H) * 100}%`,
            }}
          >
            <p className="font-mono text-[11.5px] text-text-primary">{shown[hovered].label}</p>
            <p className="mt-1 font-mono text-[10.5px] text-text-accent">cardinality {shown[hovered].cardinality}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-text-secondary">{shown[hovered].rationale}</p>
          </div>
        )}
      </div>

      {/* visible axiom rows (legend) */}
      <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {shown.map((ax, i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className={cn(
              'rounded-lg border px-3 py-2 text-left font-mono text-[11.5px] transition-colors',
              hovered === i
                ? 'border-border-glow bg-bg-panel-raised text-text-primary'
                : 'border-border-hairline bg-bg-inset text-text-secondary',
            )}
          >
            <span style={{ color: colorOf(ax.from) }}>{ax.label.split('—')[0].trim()}</span>
            <span className="text-text-muted"> —{ax.predicate}→ </span>
            <span style={{ color: colorOf(ax.to) }}>{ax.label.split('→')[1]?.trim()}</span>
          </button>
        ))}
      </div>

      {/* +9 more expander */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-glow px-3 py-1.5 font-mono text-[11.5px] text-text-muted transition-colors hover:border-iris hover:text-text-accent"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
        {expanded ? 'show less' : `+${rest.length} more`}
      </button>
      {expanded && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 grid gap-1.5 sm:grid-cols-2"
        >
          {rest.map((ax, i) => (
            <div
              key={i}
              className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2 font-mono text-[11.5px] text-text-secondary"
              title={ax.rationale}
            >
              <span style={{ color: colorOf(ax.from) }}>{ax.label.split('—')[0].trim()}</span>
              <span className="text-text-muted"> —{ax.predicate}→ </span>
              <span style={{ color: colorOf(ax.to) }}>{ax.label.split('→')[1]?.trim()}</span>
              <span className="ml-2 text-[10px] text-text-muted">{ax.cardinality}</span>
            </div>
          ))}
        </motion.div>
      )}
    </section>
  );
}
