import { useState } from 'react';
import { motion } from 'framer-motion';

interface Stage {
  id: string;
  label: string;
  sub: string;
  adr: string;
  adrLabel: string;
}

const STAGES: Stage[] = [
  { id: 'sources', label: 'Sources', sub: 'csv · sql · rest', adr: 'adr-003', adrLabel: 'ADR-003 sync strategy' },
  { id: 'mapping', label: 'Mapping', sub: 'r2rml-style', adr: 'adr-003', adrLabel: 'ADR-003 sync strategy' },
  { id: 'materialize', label: 'Materialize', sub: 'edge table + provenance', adr: 'adr-001', adrLabel: 'ADR-001 graph model' },
  { id: 'validate', label: 'Validate', sub: 'shape checks', adr: 'adr-004', adrLabel: 'ADR-004 reasoner' },
  { id: 'snapshot', label: 'Snapshot v(n)', sub: 'immutable · tombstoned', adr: 'adr-003', adrLabel: 'ADR-003 sync strategy' },
  { id: 'consume', label: 'Query · Insights · Reasoner', sub: 'read-only guard', adr: 'adr-005', adrLabel: 'ADR-005 nl→query safety' },
];

const W = 1160;
const H = 170;
const Y = 78;
const BW = 158;
const BH = 64;
const GAP = (W - 40 - STAGES.length * BW) / (STAGES.length - 1);
const X = (i: number) => 20 + i * (BW + GAP);

/**
 * ARCH · Data flow — horizontal pipeline with continuously traveling packet
 * dots (3 dots, offset phases, 2.4s loop). Stages deep-link to governing ADRs.
 */
export function DataFlowPipeline() {
  const [hovered, setHovered] = useState<string | null>(null);
  const jump = (adr: string) => document.getElementById(adr)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const pathStart = X(0) + BW;
  const pathEnd = X(STAGES.length - 1);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Data flow pipeline">
        <defs>
          <marker id="df-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10" fill="none" stroke="#818CF8" strokeWidth="1.5" />
          </marker>
          <style>{`.df-dash { animation: dfmove 1.5s linear infinite; } @keyframes dfmove { to { stroke-dashoffset: -22; } }`}</style>
        </defs>

        {/* connector segments with flow dashes */}
        {STAGES.slice(0, -1).map((s, i) => (
          <line
            key={s.id}
            x1={X(i) + BW}
            y1={Y + BH / 2}
            x2={X(i + 1)}
            y2={Y + BH / 2}
            stroke="#818CF8"
            strokeOpacity={0.5}
            strokeWidth={1.5}
            strokeDasharray="6 5"
            className="df-dash"
          />
        ))}

        {/* traveling packet dots — 3, offset phases, 2.4s loop */}
        {[0, 0.8, 1.6].map((begin, i) => (
          <circle key={i} r={3.5} fill="#818CF8" opacity={0.9}>
            <animateMotion
              dur="2.4s"
              begin={`${begin}s`}
              repeatCount="indefinite"
              path={`M ${pathStart + 6} ${Y + BH / 2} L ${pathEnd - 6} ${Y + BH / 2}`}
            />
          </circle>
        ))}

        {STAGES.map((s, i) => {
          const active = hovered === s.id;
          return (
            <motion.g
              key={s.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-20% 0px' }}
              transition={{ duration: 0.4, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              onMouseEnter={() => setHovered(s.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => jump(s.adr)}
              style={{ cursor: 'pointer' }}
              role="link"
              aria-label={`${s.label} — governed by ${s.adrLabel}`}
            >
              <rect
                x={X(i)}
                y={Y}
                width={BW}
                height={BH}
                rx={10}
                fill={active ? '#16202F' : '#101828'}
                stroke={active ? '#818CF8' : '#1E293B'}
                strokeWidth={1.5}
              />
              <rect x={X(i)} y={Y} width={BW} height={3} rx={1.5} fill="#818CF8" fillOpacity={active ? 0.9 : 0.5} />
              <text x={X(i) + BW / 2} y={Y + 28} textAnchor="middle" fill="#F1F5F9" fontSize={13.5} fontWeight={600} fontFamily="'Space Grotesk', sans-serif">
                {s.label}
              </text>
              <text x={X(i) + BW / 2} y={Y + 47} textAnchor="middle" fill="#64748B" fontSize={9.5} fontFamily="'JetBrains Mono', monospace">
                {s.sub}
              </text>
              {i < STAGES.length - 1 && (
                <line
                  x1={X(i) + BW}
                  y1={Y + BH / 2}
                  x2={X(i + 1)}
                  y2={Y + BH / 2}
                  stroke="#818CF8"
                  strokeWidth={1.5}
                  markerEnd="url(#df-arrow)"
                  opacity={0.001}
                />
              )}
            </motion.g>
          );
        })}
      </svg>

      {/* hover tooltip */}
      <div className="pointer-events-none flex h-6 items-center justify-center">
        {hovered && (
          <motion.span
            key={hovered}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="font-mono text-[11px] text-text-accent"
          >
            governed by {STAGES.find((s) => s.id === hovered)?.adrLabel} — click to jump
          </motion.span>
        )}
      </div>
    </div>
  );
}
