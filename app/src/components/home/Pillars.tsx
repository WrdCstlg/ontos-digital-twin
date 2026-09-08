import { motion } from 'framer-motion';
import { ArrowRightLeft, Network, Sparkles } from 'lucide-react';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const PILLARS = [
  {
    title: 'Model',
    icon: Network,
    bar: 'linear-gradient(90deg, #4338CA, #6366F1)',
    body: 'Versioned OWL/RDFS modules per business function, extended visually — never by editing raw files. SHACL constraints and reasoner checks built in.',
    chips: 'owl · rdfs · shacl · elk',
  },
  {
    title: 'Map',
    icon: ArrowRightLeft,
    bar: 'linear-gradient(90deg, #0369A1, #38BDF8)',
    body: 'Declarative R2RML-style mappings from CSV, REST, and SQL. Incremental sync, change-data-capture, and provenance on every edge.',
    chips: 'csv · rest · sql · cdc',
  },
  {
    title: 'Reason',
    icon: Sparkles,
    bar: 'linear-gradient(90deg, #047857, #34D399)',
    body: 'Ask in plain English. Get a validated query, an answer, and the supporting subgraph. Every insight traces to source records.',
    chips: 'sparql · cypher · llm',
  },
];

/** Section 3 — Platform pillars: three-layer card grid. */
export function Pillars() {
  return (
    <section id="platform" className="mx-auto max-w-[1200px] scroll-mt-24 px-6 py-28">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">Platform</p>
      <h2 className="mt-4 max-w-[640px] font-display text-[36px] font-bold leading-[1.1] tracking-[-0.025em] text-text-primary lg:text-[46px]">
        Three layers. One semantic backbone.
      </h2>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {PILLARS.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ y: 32, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: '-25% 0px' }}
            transition={{ duration: 0.6, delay: i * 0.12, ease: EASE }}
            whileHover={{ y: -4 }}
            className="group relative overflow-hidden rounded-xl border border-border-hairline bg-bg-panel p-6 transition-colors duration-200 hover:border-border-glow"
          >
            <span className="absolute inset-x-0 top-0 h-0.5 transition-shadow duration-200 group-hover:shadow-[0_0_16px_2px_rgba(99,102,241,0.45)]" style={{ background: p.bar }} />
            <p.icon className="size-7 text-text-secondary transition-transform duration-200 group-hover:rotate-[8deg] group-hover:text-text-primary" />
            <h3 className="mt-4 font-display text-[20px] font-semibold text-text-primary">{p.title}</h3>
            <p className="mt-2.5 text-[14px] leading-relaxed text-text-secondary">{p.body}</p>
            <div className="mt-5 inline-block rounded-md border border-border-hairline bg-bg-inset px-2 py-1 font-mono text-[11px] text-text-muted">
              {p.chips}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export default Pillars;
