import { motion } from 'framer-motion';

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  color: string;
  fill: string;
}

interface Edge {
  from: [number, number];
  to: [number, number];
  label: string;
}

const BOXES: Box[] = [
  { id: 'users', x: 60, y: 300, w: 240, h: 120, title: 'Acme users', sub: 'Ontologists · Data engineers\nCompliance officers · Admins', color: '#94A3B8', fill: '#101828' },
  { id: 'ontos', x: 470, y: 270, w: 300, h: 170, title: 'Ontos platform', sub: 'Ontology management · living knowledge graph\ninsights · audit · NL query', color: '#818CF8', fill: '#141c33' },
  { id: 'hris', x: 940, y: 90, w: 220, h: 84, title: 'HRIS export', sub: 'csv · scheduled diff', color: '#94A3B8', fill: '#101828' },
  { id: 'contracts', x: 940, y: 214, w: 220, h: 84, title: 'Contracts DB', sub: 'sql · incremental', color: '#94A3B8', fill: '#101828' },
  { id: 'erp', x: 940, y: 338, w: 220, h: 84, title: 'ERP (invoices)', sub: 'rest · webhook', color: '#94A3B8', fill: '#101828' },
  { id: 'oidc', x: 940, y: 462, w: 220, h: 84, title: 'OIDC provider', sub: 'sso · auto-provisioning', color: '#94A3B8', fill: '#101828' },
  { id: 'llm', x: 940, y: 586, w: 220, h: 84, title: 'LLM providers', sub: 'ollama · openai · anthropic · openrouter', color: '#94A3B8', fill: '#101828' },
];

const EDGES: Edge[] = [
  { from: [300, 360], to: [470, 355], label: 'HTTPS · interactive use' },
  { from: [770, 310], to: [940, 132], label: 'sync · hr:Person (ADR-003)' },
  { from: [770, 330], to: [940, 256], label: 'sync · lgl:Contract' },
  { from: [770, 360], to: [940, 380], label: 'sync · fin:Transaction' },
  { from: [620, 270], to: [620, 210], label: '' },
  { from: [770, 400], to: [940, 504], label: 'auth · OAuth2/OIDC' },
  { from: [770, 415], to: [940, 628], label: 'narratives (ADR-006)' },
];

function DiagramBox({ box, index }: { box: Box; index: number }) {
  const lines = box.sub.split('\n');
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: '-30% 0px' }}
      transition={{ duration: 0.45, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: `${box.x + box.w / 2}px ${box.y + box.h / 2}px` }}
    >
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={12} fill={box.fill} stroke={box.color} strokeOpacity={0.55} strokeWidth={1.5} />
      <rect x={box.x} y={box.y} width={box.w} height={4} rx={2} fill={box.color} fillOpacity={0.8} />
      <text x={box.x + box.w / 2} y={box.y + 34} textAnchor="middle" fill="#F1F5F9" fontSize={17} fontWeight={600} fontFamily="'Space Grotesk', sans-serif">
        {box.title}
      </text>
      {lines.map((l, i) => (
        <text key={i} x={box.x + box.w / 2} y={box.y + 58 + i * 18} textAnchor="middle" fill="#64748B" fontSize={11.5} fontFamily="'JetBrains Mono', monospace">
          {l}
        </text>
      ))}
    </motion.g>
  );
}

/** C4 Level 1 — system context, inline dark SVG with animated draw-in. */
export function C4ContextDiagram() {
  return (
    <svg viewBox="0 0 1200 800" className="h-auto w-full" role="img" aria-label="C4 system context diagram">
      <defs>
        <marker id="c4c-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10" fill="none" stroke="#475569" strokeWidth="1.5" />
        </marker>
      </defs>

      {EDGES.map((e, i) => {
        const midX = (e.from[0] + e.to[0]) / 2;
        const midY = (e.from[1] + e.to[1]) / 2;
        return (
          <motion.g
            key={i}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-30% 0px' }}
            transition={{ duration: 0.5, delay: 0.5 + i * 0.08 }}
          >
            <motion.line
              x1={e.from[0]}
              y1={e.from[1]}
              x2={e.to[0]}
              y2={e.to[1]}
              stroke="#334155"
              strokeWidth={1.5}
              markerEnd="url(#c4c-arrow)"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true, margin: '-30% 0px' }}
              transition={{ duration: 0.6, delay: 0.5 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            />
            {e.label && (
              <text x={midX} y={midY - 6} textAnchor="middle" fill="#64748B" fontSize={10.5} fontFamily="'JetBrains Mono', monospace">
                {e.label}
              </text>
            )}
          </motion.g>
        );
      })}

      {BOXES.map((b, i) => (
        <DiagramBox key={b.id} box={b} index={i} />
      ))}
      {/* stub edge upward from platform: snapshots/export */}
      <motion.text
        x={620}
        y={196}
        textAnchor="middle"
        fill="#64748B"
        fontSize={10.5}
        fontFamily="'JetBrains Mono', monospace"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 1.1 }}
      >
        rdf/turtle export · snapshots
      </motion.text>
    </svg>
  );
}
