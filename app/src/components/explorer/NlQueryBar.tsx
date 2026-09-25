import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Loader2, Mic, Sparkles } from 'lucide-react';

export interface NlQueryBarProps {
  question: string;
  onQuestionChange: (q: string) => void;
  onAsk: () => void;
  asking: boolean;
  /** Rotating placeholder suggestions */
  placeholders: string[];
  /** Sample-question chips row */
  chips: string[];
}

/**
 * NlQueryBar — the prominent NL ask bar: sparkle icon, rotating
 * cross-fading placeholders, engine/language chips, iris Ask button with
 * ⌘↵, sample-question chips, gradient border sweep while asking.
 */
export function NlQueryBar({ question, onQuestionChange, onAsk, asking, placeholders, chips }: NlQueryBarProps) {
  const [phIdx, setPhIdx] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setPhIdx((i) => (i + 1) % Math.max(placeholders.length, 1)), 4000);
    return () => clearInterval(iv);
  }, [placeholders.length]);

  return (
    <div className="border-b border-border-hairline bg-bg-panel px-6 py-3">
      <div className="mx-auto max-w-[900px]">
        <motion.div
          animate={asking ? { opacity: [0.5, 1, 0.5] } : { opacity: 0.35 }}
          transition={asking ? { duration: 0.6, repeat: Infinity } : { duration: 0.3 }}
          className="rounded-xl bg-gradient-to-r from-iris-deep via-iris to-iris-bright p-px"
        >
          <div className="flex h-[60px] items-center gap-3 rounded-[11px] bg-bg-panel px-4">
            <Sparkles className="size-4.5 shrink-0 text-iris-bright" />
            <div className="relative min-w-0 flex-1">
              <input
                value={question}
                onChange={(e) => onQuestionChange(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onAsk();
                  else if (e.key === 'Enter') onAsk();
                }}
                aria-label="Ask a question in natural language"
                className="h-10 w-full bg-transparent text-[16px] text-text-primary outline-none"
              />
              {question === '' && placeholders.length > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={phIdx}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.4 }}
                      className="truncate text-[15px] text-text-muted"
                    >
                      {placeholders[phIdx]}
                    </motion.span>
                  </AnimatePresence>
                </div>
              )}
            </div>
            <button
              type="button"
              className="hidden items-center gap-1 rounded-md border border-border-hairline px-2 py-1 font-mono text-[10.5px] text-text-secondary transition-colors hover:border-border-glow md:flex"
              title="Query language"
            >
              EN <ChevronDown className="size-3" />
            </button>
            <span
              className="hidden rounded-md border border-border-hairline bg-bg-inset px-2 py-1 font-mono text-[10px] text-text-muted lg:inline"
              title="Grounded translation engine"
            >
              local · llama3.1 · grounded in 5 modules
            </span>
            <Mic className="size-4 shrink-0 text-text-muted" aria-hidden />
            <button
              type="button"
              onClick={onAsk}
              disabled={asking || question.trim() === ''}
              className="flex h-9 items-center gap-2 rounded-lg bg-gradient-to-br from-iris-deep to-iris px-4 text-[13px] font-medium text-white transition-all duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {asking ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Ask
              <kbd className="rounded border border-white/20 px-1 font-mono text-[9px] opacity-70">⌘↵</kbd>
            </button>
          </div>
        </motion.div>

        {/* Sample chips */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onQuestionChange(c);
              }}
              className="rounded-full border border-border-hairline px-2.5 py-1 font-mono text-[12px] text-text-secondary transition-colors duration-150 hover:border-border-glow hover:bg-bg-panel-raised hover:text-text-primary"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default NlQueryBar;
