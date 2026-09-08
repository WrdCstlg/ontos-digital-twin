import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, RefreshCw, Sparkles, Waypoints } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { IRIChip } from '@/components/ui/iri-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTime } from './ruleMeta';

const IRI_TOKEN = /^([“"']?)((?:hr|lgl|legal|cmp|fin|log|ext):[A-Za-z][\w./-]*)([)”"'.;,!?]*)$/;

/**
 * Render narrative body with inline IRIChips for any compact IRIs the
 * grounded template mentions (prefix in module color, per design). Words
 * reveal progressively (30ms/word) with a soft iris caret at the front.
 */
function BodyWithIris({ text, visibleWords, done }: { text: string; visibleWords: number; done: boolean }) {
  const tokens = text.split(/(\s+)/);
  let wordIdx = 0;
  return (
    <>
      {tokens.map((tok, i) => {
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        const idx = wordIdx++;
        const visible = idx < visibleWords;
        const iriMatch = tok.match(IRI_TOKEN);
        return (
          <motion.span
            key={i}
            initial={false}
            animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block"
          >
            {iriMatch ? (
              <>
                {iriMatch[1]}
                <IRIChip iri={iriMatch[2]} className="mx-0.5 align-baseline" />
                {iriMatch[3]}
              </>
            ) : (
              tok
            )}
          </motion.span>
        );
      })}
      {!done && (
        <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-caret-blink bg-iris-bright" aria-hidden />
      )}
    </>
  );
}

/**
 * NarrativeCard — the weekly LLM narrative, grounded in the live graph
 * snapshot (insights.narrative). Word-by-word type-in animation with an
 * iris caret; regenerate re-runs it.
 */
export function NarrativeCard({ onViewGrounding }: { onViewGrounding: () => void }) {
  const { data, isLoading, isError, refetch, isFetching } = trpc.insights.narrative.useQuery(
    { period: 'week' },
    { staleTime: 60_000, retry: 1 },
  );
  const [copied, setCopied] = useState(false);
  const [visibleWords, setVisibleWords] = useState(0);

  const body = data?.body ?? '';
  const wordCount = useMemo(() => body.split(/\s+/).filter(Boolean).length, [body]);
  const generatedAt = data?.generatedAt ? String(data.generatedAt) : '';

  // Reset the reveal when a fresh narrative is generated (adjust-during-render pattern).
  const [lastRun, setLastRun] = useState(generatedAt);
  if (lastRun !== generatedAt) {
    setLastRun(generatedAt);
    setVisibleWords(0);
  }

  // Word-by-word reveal (~30ms/word); setState only happens inside the timer callback.
  useEffect(() => {
    if (wordCount === 0) return;
    let n = 0;
    const iv = setInterval(() => {
      n += 1;
      setVisibleWords(n);
      if (n >= wordCount) clearInterval(iv);
    }, 30);
    return () => clearInterval(iv);
  }, [wordCount, generatedAt]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(`${data.title}\n\n${data.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  const regenerate = async () => {
    const res = await refetch();
    if (res.data) toast.success('Narrative regenerated from the live snapshot');
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl border border-border-hairline bg-bg-panel-raised p-6"
      aria-label="Weekly narrative"
    >
      <span className="absolute inset-y-0 left-0 w-[3px] bg-iris" aria-hidden />
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-iris-bright" />
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
          LLM narrative · grounded in graph snapshot {data?.grounding.snapshot ?? '…'} · local llama3.1
        </span>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-4 w-full max-w-[900px]" />
          <Skeleton className="h-4 w-full max-w-[760px]" />
          <Skeleton className="h-4 w-full max-w-[820px]" />
        </div>
      ) : isError || !data ? (
        <div className="mt-4 rounded-lg border border-border-hairline bg-bg-inset p-4">
          <p className="text-[14px] text-text-secondary">The narrative could not be generated right now.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <RefreshCw className="size-3.5" /> Retry
          </button>
        </div>
      ) : (
        <>
          <h3 className="mt-3 font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">
            {data.title}
          </h3>
          <p className="mt-3 max-w-[900px] text-[15px] leading-[1.6] text-text-secondary">
            <BodyWithIris key={generatedAt} text={data.body} visibleWords={visibleWords} done={visibleWords >= wordCount} />
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="font-mono text-[11.5px] text-text-muted">
              grounded in {data.grounding.edges.toLocaleString()} edges · {data.grounding.nodes.toLocaleString()} nodes
              · {data.grounding.openInsights} open findings · generated {formatTime(data.generatedAt)}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
            >
              <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} /> Regenerate
            </button>
            <button
              type="button"
              onClick={onViewGrounding}
              className="inline-flex items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/10 px-3 py-1.5 text-[13px] text-text-accent transition-colors hover:border-iris-bright hover:bg-iris/20"
            >
              <Waypoints className="size-3.5" /> View grounding subgraph
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy narrative"
              className="rounded-lg border border-border-hairline p-1.5 text-text-muted transition-colors hover:border-border-glow hover:text-text-primary"
            >
              {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </>
      )}
    </motion.section>
  );
}

export default NarrativeCard;
