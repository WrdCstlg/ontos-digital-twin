import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Database, FileJson2, Lightbulb, ScanSearch, Server } from 'lucide-react';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STAGES = [
  { label: 'Sources', sub: 'csv · rest · sql', icon: FileJson2 },
  { label: 'Mapping', sub: 'r2rml-style', icon: ScanSearch },
  { label: 'Graph Store', sub: 'rdf-star', icon: Database },
  { label: 'Reasoner', sub: 'owl · shacl', icon: Server },
  { label: 'Insights', sub: 'rules · llm', icon: Lightbulb },
];

/** Section 7 — Architecture teaser: flowing pipeline diagram. */
export function ArchTeaser() {
  return (
    <section id="architecture" className="mx-auto max-w-[1200px] scroll-mt-24 px-6 py-28 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">Under the Hood</p>
      <h2 className="mx-auto mt-4 max-w-[720px] font-display text-[36px] font-bold leading-[1.1] tracking-[-0.025em] text-text-primary lg:text-[46px]">
        Built like infrastructure, documented like a decision log.
      </h2>
      <p className="mx-auto mt-4 max-w-[640px] text-[15px] leading-relaxed text-text-secondary">
        RDF-star with property-graph export. A swappable graph store behind a repository abstraction. Every significant
        choice — sync strategy, reasoner, RDF vs property graph — written down with its trade-offs.
      </p>

      {/* Pipeline */}
      <div className="mt-14 flex flex-col items-stretch justify-center gap-3 md:flex-row md:items-center">
        {STAGES.map((s, i) => (
          <div key={s.label} className="flex items-center gap-3 md:flex-col lg:flex-row">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 16 }}
              whileInView={{ opacity: 1, scale: 1, y: 0 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: EASE }}
              className="flex flex-1 items-center gap-3 rounded-xl border border-border-hairline bg-bg-panel px-5 py-4 text-left md:min-w-[168px]"
            >
              <s.icon className="size-5 shrink-0 text-iris-bright" />
              <div>
                <div className="text-[14px] font-medium text-text-primary">{s.label}</div>
                <div className="font-mono text-[10.5px] text-text-muted">{s.sub}</div>
              </div>
            </motion.div>
            {i < STAGES.length - 1 && (
              <svg width="46" height="10" viewBox="0 0 46 10" className="hidden shrink-0 md:block" aria-hidden>
                <line x1="0" y1="5" x2="40" y2="5" stroke="#818CF8" strokeWidth="1.5" strokeDasharray="6 5" className="pipe-flow" />
                <path d="M38 1.5 L44 5 L38 8.5" fill="none" stroke="#818CF8" strokeWidth="1.5" />
              </svg>
            )}
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/app/decisions"
          className="rounded-xl border border-border-hairline bg-bg-panel/40 px-5 py-2.5 text-[14px] text-text-secondary backdrop-blur transition-colors hover:border-border-glow hover:text-text-primary"
        >
          Read the Decisions page
        </Link>
        <Link
          to="/app/decisions"
          className="rounded-xl border border-border-hairline bg-bg-panel/40 px-5 py-2.5 font-mono text-[13px] text-text-secondary backdrop-blur transition-colors hover:border-border-glow hover:text-text-primary"
        >
          OpenAPI spec
        </Link>
      </div>
      <style>{`.pipe-flow { animation: pipedash 1.5s linear infinite; } @keyframes pipedash { to { stroke-dashoffset: -22; } }`}</style>
    </section>
  );
}

export default ArchTeaser;
