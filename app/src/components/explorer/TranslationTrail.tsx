import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import { IRIChip } from '@/components/ui/iri-chip';

export interface TranslationTrailProps {
  /** How many stages have been revealed (0–4) */
  stage: number;
  grounding?: { classes: string[]; predicates: string[] };
  /** Final validated line suffix, e.g. estimated row count once executed */
  validatedExtra?: string;
}

function StageLine({ children, done }: { children: React.ReactNode; done: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-text-secondary"
    >
      <span className="flex-1 min-w-0">{children}</span>
      {done ? (
        <motion.span
          initial={{ scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="text-ok"
        >
          <Check className="size-3.5" />
        </motion.span>
      ) : (
        <Loader2 className="size-3.5 animate-spin text-iris-bright" />
      )}
    </motion.div>
  );
}

/**
 * TranslationTrail — staged translation status lines: parsing → grounding
 * (inline IRIChips) → generating → validating, each with a check-flip,
 * then a final emerald "validated · read-only" line.
 */
export function TranslationTrail({ stage, grounding, validatedExtra }: TranslationTrailProps) {
  const g = grounding ?? { classes: [], predicates: [] };
  return (
    <div className="space-y-1.5 rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
      {stage >= 0 && (
        <StageLine done={stage > 0}>
          <span className="text-text-muted">→</span> parsing intent … entity linking against ontology classes
        </StageLine>
      )}
      {stage >= 1 && (
        <StageLine done={stage > 1}>
          <span className="text-text-muted">→</span> grounding:
          {g.classes.map((c) => (
            <IRIChip key={c} iri={c} />
          ))}
          {g.predicates.length > 0 && <span className="text-text-muted">via</span>}
          {g.predicates.map((p) => (
            <IRIChip key={p} iri={p} />
          ))}
          {g.classes.length === 0 && g.predicates.length === 0 && (
            <span className="text-text-muted">workspace-wide projection (no class grounding)</span>
          )}
        </StageLine>
      )}
      {stage >= 2 && (
        <StageLine done={stage > 2}>
          <span className="text-text-muted">→</span> generating <span className="text-iris-bright">SPARQL</span>
          <span className="text-text-muted">+ equivalent</span> <span className="text-iris-bright">Cypher</span>
        </StageLine>
      )}
      {stage >= 3 && (
        <StageLine done={stage > 3}>
          <span className="text-text-muted">→</span> validating
          <span className="text-text-muted">(syntax + ontology conformance + read-only guard)</span>
        </StageLine>
      )}
      {stage >= 4 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-1.5 pt-0.5 font-mono text-[12px] text-ok"
        >
          <Check className="size-3.5" />
          validated · read-only{validatedExtra ? ` · ${validatedExtra}` : ''}
        </motion.div>
      )}
    </div>
  );
}

export default TranslationTrail;
