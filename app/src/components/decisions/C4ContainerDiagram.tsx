import { motion } from 'framer-motion';
import { CopyButton } from './CopyButton';

/* Layer colors: UI iris, services sky, data emerald, external slate */
const LAYERS = [
  { label: 'UI layer', color: '#818CF8' },
  { label: 'Services / API', color: '#38BDF8' },
  { label: 'Data', color: '#34D399' },
  { label: 'External', color: '#94A3B8' },
];

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string[];
  color: string;
}

const BOXES: Box[] = [
  { id: 'spa', x: 80, y: 90, w: 300, h: 110, title: 'React SPA', sub: ['react 19 · vite · tailwind', 'cytoscape canvases · framer motion'], color: '#818CF8' },
  { id: 'api', x: 560, y: 90, w: 320, h: 110, title: 'Hono + tRPC gateway', sub: ['typed routers: ontology · graph · mapping', 'insights · nlq · admin · dashboard'], color: '#38BDF8' },
  { id: 'sync', x: 80, y: 320, w: 300, h: 110, title: 'Mapping & sync engine', sub: ['r2rml-style column maps', 'materialize + provenance + snapshots'], color: '#38BDF8' },
  { id: 'reasoner', x: 480, y: 320, w: 280, h: 110, title: 'Reasoner (simulated)', sub: ['deterministic subclass closure', 'shape checks · disclosed in UI'], color: '#38BDF8' },
  { id: 'insights', x: 860, y: 320, w: 280, h: 110, title: 'Insight rules engine', sub: ['deterministic anomaly rules', 'evidence-graph packaging'], color: '#38BDF8' },
  { id: 'nlq', x: 480, y: 530, w: 280, h: 110, title: 'NL→Query simulator', sub: ['ontology-grounded · ast validation', 'read-only guard · refusals'], color: '#38BDF8' },
  { id: 'llm-adapter', x: 860, y: 530, w: 280, h: 110, title: 'LLM adapter', sub: ['per-tenant providers', 'template fallback when offline'], color: '#38BDF8' },
  { id: 'db', x: 80, y: 530, w: 300, h: 110, title: 'MySQL / TiDB', sub: ['drizzle orm · kg_nodes · kg_edges', 'snapshots · hash-chained audit log'], color: '#34D399' },
  { id: 'oidc', x: 1220, y: 90, w: 200, h: 90, title: 'OIDC SSO', sub: ['oauth2 · auto-provision'], color: '#94A3B8' },
  { id: 'llms', x: 1220, y: 530, w: 200, h: 90, title: 'LLM providers', sub: ['ollama · openai · anthropic'], color: '#94A3B8' },
  { id: 'sources', x: 1220, y: 320, w: 200, h: 90, title: 'Source systems', sub: ['hris csv · contracts sql', 'erp rest'], color: '#94A3B8' },
];

const EDGES: [string, string, string][] = [
  ['spa', 'api', 'trpc · batch http'],
  ['api', 'db', 'drizzle sql'],
  ['sync', 'db', 'upsert + snapshot'],
  ['sync', 'sources', 'pull'],
  ['reasoner', 'db', 'read axioms'],
  ['insights', 'db', 'rules over kg'],
  ['nlq', 'db', 'validated reads'],
  ['nlq', 'llm-adapter', 'narratives'],
  ['llm-adapter', 'llms', 'per-tenant'],
  ['api', 'oidc', 'session'],
];

const CENTER = new Map(BOXES.map((b) => [b.id, { x: b.x + b.w / 2, y: b.y + b.h / 2, b }]));

function edgePoints(fromId: string, toId: string): [number, number, number, number] {
  const a = CENTER.get(fromId)!;
  const c = CENTER.get(toId)!;
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const clip = (p: { x: number; y: number; b: Box }, sx: number, sy: number) => {
    const hw = p.b.w / 2;
    const hh = p.b.h / 2;
    const t = Math.min(
      sx !== 0 ? hw / Math.abs(sx) : Infinity,
      sy !== 0 ? hh / Math.abs(sy) : Infinity,
    );
    return [p.x + sx * t, p.y + sy * t] as const;
  };
  const [x1, y1] = clip(a, dx, dy);
  const [x2, y2] = clip(c, -dx, -dy);
  return [x1, y1, x2, y2];
}

const RESPONSIBILITIES: [string, string, string, string][] = [
  ['React SPA', 'All UI surfaces; graph canvases; tRPC client', 'React 19 · Vite · Tailwind · Cytoscape', 'static CDN replicas'],
  ['Hono + tRPC gateway', 'Typed API boundary; auth/session; audit writes', 'Hono · tRPC v11 · superjson', 'stateless — horizontal replicas'],
  ['Mapping & sync engine', 'R2RML-style maps → materialized KG + snapshots', 'Drizzle transactions · chunked inserts', 'partition by source connector'],
  ['Reasoner (simulated)', 'Subclass closure + shape checks on publish/sync', 'deterministic TS module', 'pure functions — scale with API'],
  ['Insight rules engine', 'Anomaly rules over the KG; evidence packaging', 'in-memory rule pass over kg tables', 'rule-partitioned workers'],
  ['NL→Query simulator', 'Ontology-grounded translation + read-only guard', 'deterministic grammar + AST validation', 'stateless'],
  ['MySQL / TiDB', 'System of record: nodes, edges, snapshots, audit', 'MySQL-compatible TiDB via Drizzle', 'read replicas · TiKV scale-out'],
];

/** C4 Level 2 — containers (truthful to the actual build) + legend + table. */
export function C4ContainerDiagram() {
  return (
    <div>
      <div className="flex flex-wrap gap-4 px-1 pb-3">
        {LAYERS.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-text-muted">
            <span className="size-2 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
            {l.label}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 1460 700" className="h-auto w-full" role="img" aria-label="C4 container diagram">
        <defs>
          <marker id="c4k-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10" fill="none" stroke="#475569" strokeWidth="1.5" />
          </marker>
        </defs>

        {EDGES.map(([f, t, label], i) => {
          const [x1, y1, x2, y2] = edgePoints(f, t);
          return (
            <motion.g
              key={`${f}-${t}`}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: '-30% 0px' }}
              transition={{ duration: 0.4, delay: 0.55 + i * 0.06 }}
            >
              <motion.line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#334155"
                strokeWidth={1.5}
                markerEnd="url(#c4k-arrow)"
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true, margin: '-30% 0px' }}
                transition={{ duration: 0.55, delay: 0.55 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              />
              {label && (
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle" fill="#64748B" fontSize={9.5} fontFamily="'JetBrains Mono', monospace">
                  {label}
                </text>
              )}
            </motion.g>
          );
        })}

        {BOXES.map((b, i) => (
          <motion.g
            key={b.id}
            initial={{ opacity: 0, scale: 0.92 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-30% 0px' }}
            transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: `${b.x + b.w / 2}px ${b.y + b.h / 2}px` }}
          >
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} fill="#101828" stroke={b.color} strokeOpacity={0.5} strokeWidth={1.5} />
            <rect x={b.x} y={b.y} width={b.w} height={4} rx={2} fill={b.color} fillOpacity={0.75} />
            <text x={b.x + b.w / 2} y={b.y + 32} textAnchor="middle" fill="#F1F5F9" fontSize={15} fontWeight={600} fontFamily="'Space Grotesk', sans-serif">
              {b.title}
            </text>
            {b.sub.map((l, j) => (
              <text key={j} x={b.x + b.w / 2} y={b.y + 56 + j * 17} textAnchor="middle" fill="#64748B" fontSize={10.5} fontFamily="'JetBrains Mono', monospace">
                {l}
              </text>
            ))}
          </motion.g>
        ))}
      </svg>

      {/* Responsibility table */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-border-hairline">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-border-hairline bg-bg-inset">
              {['Container', 'Responsibility', 'Tech', 'Scales how'].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESPONSIBILITIES.map((r) => (
              <tr key={r[0]} className="border-b border-border-hairline/60 last:border-0 hover:bg-bg-panel-raised/60">
                <td className="whitespace-nowrap px-3.5 py-2.5 text-[13px] font-medium text-text-primary">{r[0]}</td>
                <td className="px-3.5 py-2.5 text-[12.5px] leading-5 text-text-secondary">{r[1]}</td>
                <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-text-secondary">{r[2]}</td>
                <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-text-accent">{r[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-[10.5px] text-text-muted">
        deploy: <code className="text-text-secondary">docker compose up</code> (eval) · <code className="text-text-secondary">helm install ontos ./chart</code> (k8s)
        <CopyButton text="docker compose up" className="ml-2 align-middle" />
      </p>
    </div>
  );
}
