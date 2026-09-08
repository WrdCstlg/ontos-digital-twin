import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const HEADLINE = 'See your business as one graph.';

/** Section 8 — Final CTA over the constellation texture. */
export function FinalCTA() {
  // character-level split, chunked
  const chunks: string[] = [];
  for (let i = 0; i < HEADLINE.length; i += 20) chunks.push(HEADLINE.slice(i, i + 20));

  return (
    <section className="relative overflow-hidden border-t border-border-hairline">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 55% 60% at 50% 45%, rgba(99,102,241,0.18), transparent), url(/hero-node-texture.svg)',
          backgroundSize: 'cover',
        }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-[720px] px-6 py-32 text-center">
        <h2 className="font-display text-[38px] font-bold leading-[1.1] tracking-[-0.025em] text-text-primary lg:text-[56px]">
          {chunks.map((chunk, i) => (
            <motion.span
              key={i}
              initial={{ y: 24, opacity: 0, filter: 'blur(8px)' }}
              whileInView={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
              viewport={{ once: true, margin: '-20% 0px' }}
              transition={{ duration: 0.7, delay: i * 0.09, ease: EASE }}
              className="inline-block whitespace-pre"
            >
              {chunk}
            </motion.span>
          ))}
        </h2>
        <p className="mx-auto mt-5 max-w-[540px] text-[15px] leading-relaxed text-text-secondary">
          The full Acme Corp demo ships seeded — 200+ people, contracts, controls, transactions, shipments, and
          deliberately planted anomalies. Works offline with a local LLM.
        </p>
        <div className="mt-9">
          <Link
            to="/app"
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-iris-deep to-iris px-7 py-3.5 text-[18px] font-medium text-white shadow-[0_0_40px_-8px_rgba(99,102,241,0.65)] transition-transform duration-150 hover:scale-[1.02]"
          >
            Launch Demo
            <ArrowRight className="size-5 transition-transform duration-150 group-hover:translate-x-1" />
          </Link>
          <p className="mt-4 font-mono text-[12px] text-text-muted">docker compose up — that's it</p>
        </div>
      </div>
    </section>
  );
}

export default FinalCTA;
