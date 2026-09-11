import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, X } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';

const STORAGE_KEY = 'ontos:rdfstar-banner-dismissed';

/** Slim dismissible RDF-star rationale banner; dismissal remembered per session. */
export function RdfStarBanner() {
  const [open, setOpen] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return sessionStorage.getItem(STORAGE_KEY) !== '1';
      }
    } catch {
      /* storage unavailable */
    }
    return true;
  });

  const dismiss = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-info/30 bg-info/10 py-2.5 pl-4 pr-10">
            <span className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg bg-info" aria-hidden />
            <Info className="size-4 shrink-0 text-info" />
            <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-text-secondary">
              Primary model: <span className="font-semibold text-text-primary">RDF-star</span> — triple-level provenance and
              soft-delete without reification bloat; property-graph export available on demand. Rationale documented in
              Decisions → ADR-002.
            </p>
            <button
              type="button"
              onClick={() =>
                toast.info('Property-graph export', {
                  description:
                    'CSV/Cypher exports are generated from the same materialized graph — request them from the Graph Explorer in this demo build.',
                })
              }
              className="rounded-md border border-border-glow px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
            >
              Export as property graph (CSV/Cypher)
            </button>
            <Link to="/app/decisions" className="text-[12px] text-text-accent hover:underline">
              Read ADR-002 →
            </Link>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss banner"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted transition-colors hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
