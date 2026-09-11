import { motion } from 'framer-motion';
import { StatusDot, type StatusKind } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const BULLETS: Array<{ status: StatusKind; title: string; body: string }> = [
  { status: 'risk', title: 'Anomaly detection', body: '“Which vendors have payments but no active contract?”' },
  { status: 'info', title: 'Graph analytics', body: 'centrality, community detection, orphan islands.' },
  { status: 'warn', title: 'Rule alerts', body: '“Control without evidence in 90 days” → risk flag.' },
  { status: 'ok', title: 'Narrative summaries', body: '“What changed in Logistics this week?”' },
];

const SEVERITY: Record<StatusKind, string> = { risk: '#F87171', warn: '#FBBF24', info: '#38BDF8', ok: '#34D399', idle: '#64748B' };

const CARDS: Array<{ severity: StatusKind; label: string; title: string; evidence: string; nodes: [string, string, string] }> = [
  {
    severity: 'risk',
    label: 'Anomaly · Finance × Legal',
    title: 'VendorCo received $84,200 in payments with no active contract on file.',
    evidence: 'evidence: 7 edges · 3 source records',
    nodes: ['fin:Vendor', 'fin:Transaction', 'legal:Contract'],
  },
  {
    severity: 'warn',
    label: 'Rule alert · Compliance',
    title: 'SOX-IT-04 has no evidence attached in 90+ days; audit window closes in 12 days.',
    evidence: 'evidence: 4 edges · 2 source records',
    nodes: ['cmp:Control', 'cmp:Evidence', 'cmp:Regulation'],
  },
  {
    severity: 'info',
    label: 'Analytics · HR',
    title: 'E-0173 is an orphan island: no manager, no reporting line.',
    evidence: 'evidence: 3 edges · 1 source record',
    nodes: ['hr:Person', 'hr:reportsTo', 'hr:OrgUnit'],
  },
];

/** Tiny evidence subgraph that draws itself on hover */
function EvidenceGraph({ nodes, color }: { nodes: [string, string, string]; color: string }) {
  const pts = [
    { x: 20, y: 30 },
    { x: 90, y: 10 },
    { x: 90, y: 52 },
  ];
  return (
    <svg viewBox="0 0 120 64" className="mt-3 h-16 w-full" aria-hidden>
      <style>{`.evidence-edge { transition: stroke-dashoffset 400ms cubic-bezier(0.16,1,0.3,1); } .group\\/card:hover .evidence-edge { stroke-dashoffset: 0; }`}</style>
      {[1, 2].map((i) => (
        <line
          key={i}
          x1={pts[0].x}
          y1={pts[0].y}
          x2={pts[i].x}
          y2={pts[i].y}
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray="80"
          strokeDashoffset="80"
          className="evidence-edge"
        />
      ))}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="5" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5" />
          <text x={p.x + (i === 0 ? -4 : 9)} y={p.y + (i === 0 ? 16 : i === 1 ? -8 : 16)} className="fill-text-muted font-mono" fontSize="6.5" textAnchor={i === 0 ? 'start' : 'start'}>
            {nodes[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Section 6 — Insight engine teaser. */
export function InsightsTeaser() {
  return (
    <section id="insights" className="mx-auto max-w-[1200px] scroll-mt-24 px-6 py-28">
      <div className="grid gap-14 lg:grid-cols-[40%_1fr]">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">Insight Engine</p>
          <h2 className="mt-4 font-display text-[36px] font-bold leading-[1.1] tracking-[-0.025em] text-text-primary lg:text-[46px]">
            The graph finds what you didn't ask for.
          </h2>
          <ul className="mt-8 space-y-5">
            {BULLETS.map((b) => (
              <li key={b.title} className="flex items-start gap-3">
                <StatusDot status={b.status} className="mt-1.5" />
                <div>
                  <div className="text-[14px] font-medium text-text-primary">{b.title}</div>
                  <div className="mt-0.5 font-mono text-[12px] text-text-secondary">{b.body}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          {CARDS.map((c, i) => (
            <motion.div
              key={c.title}
              initial={{ x: 48, opacity: 0 }}
              whileInView={{ x: 0, opacity: 1 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.6, delay: i * 0.15, ease: EASE }}
              className="group/card relative overflow-hidden rounded-xl border border-border-hairline bg-bg-panel p-5 pl-6 transition-colors duration-200 hover:border-border-glow"
            >
              <motion.span
                initial={{ scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 + 0.2, ease: EASE }}
                className="absolute left-0 top-0 h-full w-[3px] origin-top"
                style={{ backgroundColor: SEVERITY[c.severity] }}
              />
              <div className="flex items-center justify-between gap-4">
                <span className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: SEVERITY[c.severity] }}>
                  {c.label}
                </span>
                <span className={cn('font-mono text-[10.5px] text-text-muted')}>{c.evidence}</span>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-text-primary">{c.title}</p>
              <span className="mt-2 inline-block text-[12px] font-medium text-text-accent">Trace →</span>
              <EvidenceGraph nodes={c.nodes} color={SEVERITY[c.severity]} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default InsightsTeaser;
