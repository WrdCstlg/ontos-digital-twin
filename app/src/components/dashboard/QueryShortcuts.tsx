import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Saved/recent natural-language queries — navigation shortcuts into Explorer. */
const QUERIES = [
  'employees signing contracts with open findings',
  'spend without cost center',
  'shipments delayed vs delivery window',
  'controls expiring this quarter',
];

/**
 * Dashboard §4 — Jump back in. Horizontally scrollable query chips that
 * pre-fill the Explorer NL query box.
 */
export function QueryShortcuts() {
  const navigate = useNavigate();
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.34, ease: EASE }}
      className="rounded-xl"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">Jump back in</p>
      <div className="mt-3 flex gap-2.5 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {QUERIES.map((q, i) => (
          <motion.button
            key={q}
            type="button"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.36 + i * 0.04, ease: EASE }}
            onClick={() => navigate(`/app/explorer?q=${encodeURIComponent(q)}`)}
            className="shrink-0 whitespace-nowrap rounded-lg border border-border-hairline bg-bg-panel px-3.5 py-2 font-mono text-[12px] text-text-secondary transition-colors duration-150 hover:border-border-glow hover:text-text-accent"
          >
            {q}
          </motion.button>
        ))}
        <motion.button
          type="button"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.36 + QUERIES.length * 0.04, ease: EASE }}
          onClick={() => navigate('/app/explorer')}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-iris/50 px-3.5 py-2 font-mono text-[12px] text-text-accent transition-colors duration-150 hover:border-iris-bright hover:bg-iris/10"
        >
          <Plus className="size-3.5" />
          New query →
        </motion.button>
      </div>
    </motion.section>
  );
}
