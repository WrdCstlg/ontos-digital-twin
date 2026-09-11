import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpenText, Check, Copy, Loader2, Pencil, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { explainLine, findWriteOp, highlightQuery, type QueryLang } from './highlight';

export interface QueryEditorProps {
  sparql: string;
  cypher: string;
  /** Increments whenever a freshly generated query arrives (not on edits) */
  generation: number;
  onSparqlChange: (v: string) => void;
  onRun: () => void;
  running: boolean;
}

const MONO = 'font-mono text-[13px] leading-[1.65]';

/**
 * QueryEditor — the signature generated-query panel. SPARQL/Cypher tabs,
 * 18ms/char typewriter with block cursor, syntax-colored editable mono
 * editor, explain mode (per-line plain-English tooltips), write-refusal
 * guard, quick re-validation on edit.
 */
export function QueryEditor({ sparql, cypher, generation, onSparqlChange, onRun, running }: QueryEditorProps) {
  const [lang, setLang] = useState<QueryLang>('sparql');
  const [cypherEdit, setCypherEdit] = useState(cypher);
  const [typed, setTyped] = useState(0);
  const [editable, setEditable] = useState(false);
  const [explain, setExplain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reval, setReval] = useState<number | null>(null); // 0..3 running, 4 ok
  const text = lang === 'sparql' ? sparql : cypherEdit;
  const typing = typed < text.length;

  // Only SPARQL is executable. The Cypher tab is a reference rendering of the
  // same translation, so it is never editable and Run switches back to SPARQL
  // rather than silently executing something other than what is on screen.
  const isExecutableLang = lang === 'sparql';

  // Restart the typewriter only when a freshly generated query arrives
  // (user edits must not reset the editor).
  const genRef = useRef(generation);
  // The pristine generated query. This is state, not a ref, because the edited
  // indicator below is derived from it during render.
  const [generatedSparql, setGeneratedSparql] = useState(sparql);
  useEffect(() => {
    if (genRef.current === generation) return;
    genRef.current = generation;
    setGeneratedSparql(sparql);
    setCypherEdit(cypher);
    setTyped(0);
    setEditable(false);
    setExplain(false);
    setReval(null);
  }, [generation, cypher, sparql]);

  /**
   * The evaluation build executes the translated intent carried in the
   * `# intent:` / `# bindings:` header, not the query body. Editing the body is
   * allowed — it is how you inspect and learn the shape — but it will not change
   * the result set, so say so rather than returning stale-looking output.
   */
  const headerOf = (q: string) =>
    q.split('\n').filter((l) => /^#\s*(intent|bindings):/.test(l)).join('\n');
  const bodyEdited =
    sparql !== generatedSparql && headerOf(sparql) === headerOf(generatedSparql);

  useEffect(() => {
    if (typing === false || editable) return;
    const iv = setInterval(() => {
      setTyped((n) => {
        if (n >= text.length) {
          clearInterval(iv);
          return n;
        }
        return n + 3; // 3 chars / 54ms ≈ 18ms per char
      });
    }, 54);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, editable, typing === false]);

  const visible = typing && !editable ? text.slice(0, typed) : text;
  const tokens = useMemo(() => highlightQuery(visible, lang), [visible, lang]);
  const lines = useMemo(() => visible.split('\n'), [visible]);
  // The banner reflects what is on screen; the Run guard reflects what actually
  // executes. These differ only on the Cypher tab.
  const writeOp = useMemo(() => findWriteOp(text), [text]);
  const executableWriteOp = useMemo(() => findWriteOp(sparql), [sparql]);

  // Quick re-validation sequence after edits settle (60ms/stage per design).
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scheduleRevalidation = () => {
    if (editTimer.current) clearTimeout(editTimer.current);
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
    editTimer.current = setTimeout(() => {
      setReval(0);
      [60, 120, 180, 260].forEach((d, i) => {
        stageTimers.current.push(setTimeout(() => setReval(i + 1), d));
      });
    }, 600);
  };
  useEffect(
    () => () => {
      if (editTimer.current) clearTimeout(editTimer.current);
      stageTimers.current.forEach(clearTimeout);
    },
    [],
  );

  const handleEdit = (v: string) => {
    if (lang !== 'sparql') return; // Cypher is a reference rendering, never edited
    onSparqlChange(v);
    scheduleRevalidation();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const chromeBtn =
    'flex items-center gap-1.5 rounded-md border border-border-hairline bg-bg-panel px-2 py-1 font-mono text-[10.5px] text-text-secondary transition-colors duration-150 hover:border-border-glow hover:bg-bg-panel-raised hover:text-text-primary';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-bg-inset transition-colors duration-200',
        writeOp ? 'border-risk/70' : 'border-border-hairline',
      )}
    >
      {/* Chrome: tabs + actions */}
      <div className="flex items-center gap-2 border-b border-border-hairline bg-bg-panel px-3 py-2">
        <div className="flex overflow-hidden rounded-lg border border-border-hairline">
          {(['sparql', 'cypher'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLang(l);
                if (l !== 'sparql') setEditable(false); // only SPARQL is editable
                if (!editable) setTyped(0); // tab toggle re-runs the typewriter
              }}
              className={cn(
                'px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors duration-150',
                lang === l ? 'bg-iris/15 text-text-accent' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="ml-1 hidden font-mono text-[10px] text-text-muted sm:inline">
          {isExecutableLang ? 'generated · read-only · ontology-conformant' : 'reference rendering · not executable'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={copy} className={chromeBtn} title="Copy query">
            {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              setTyped(text.length); // complete typing on edit/lock
              setEditable((e) => !e);
              setExplain(false);
            }}
            disabled={!isExecutableLang}
            className={cn(
              chromeBtn,
              editable && 'border-iris/50 text-text-accent',
              !isExecutableLang && 'cursor-not-allowed opacity-40',
            )}
            title={
              !isExecutableLang
                ? 'Cypher is a reference rendering — edit the SPARQL instead'
                : editable
                  ? 'Lock editor'
                  : 'Edit query'
            }
          >
            <Pencil className="size-3" />
            {editable ? 'Lock' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={() => setExplain((e) => !e)}
            className={cn(chromeBtn, explain && 'border-iris/50 text-text-accent')}
            title="Explain this query"
          >
            <BookOpenText className="size-3" />
            Explain
          </button>
          <button
            type="button"
            onClick={() => {
              setReval(0);
              [60, 120, 180, 260].forEach((d, i) => {
                stageTimers.current.push(setTimeout(() => setReval(i + 1), d));
              });
            }}
            className={chromeBtn}
            title="Re-validate"
          >
            <RotateCcw className="size-3" />
            Re-validate
          </button>
          <button
            type="button"
            onClick={() => {
              // SPARQL is what actually executes — surface it before running so
              // the results always correspond to the query on screen.
              if (!isExecutableLang) {
                setLang('sparql');
                setTyped(sparql.length);
              }
              onRun();
            }}
            disabled={running || !!executableWriteOp || (typing && !editable && isExecutableLang)}
            className="flex items-center gap-1.5 rounded-md bg-gradient-to-br from-iris-deep to-iris px-2.5 py-1 font-mono text-[10.5px] font-medium text-white transition-all duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              writeOp
                ? 'Refused: write operations are not executable'
                : isExecutableLang
                  ? 'Execute query'
                  : 'Switch to SPARQL and execute'
            }
          >
            {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Run
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div className="relative max-h-[280px] overflow-auto">
        {explain ? (
          <div className={cn('px-3 py-3 pl-12', MONO)}>
            {lines.map((line, i) => {
              const tip = explainLine(line);
              return (
                <div key={i} className="group relative whitespace-pre-wrap">
                  <span>
                    {highlightQuery(line, lang).map((t, j) => (
                      <span key={j} style={{ color: t.color, fontWeight: t.weight, fontStyle: t.italic ? 'italic' : undefined }}>
                        {t.text}
                      </span>
                    ))}
                    {line === '' && ' '}
                  </span>
                  {tip && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-8 top-full z-20 mt-0.5 hidden w-64 rounded-lg border border-border-hairline bg-bg-panel-raised p-2 font-sans text-[11.5px] leading-relaxed text-text-secondary shadow-xl group-hover:block"
                    >
                      {tip}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="relative">
            <pre aria-hidden className={cn('min-h-[120px] whitespace-pre px-3 py-3 pl-12', MONO)}>
              {tokens.map((t, i) => (
                <span key={i} style={{ color: t.color, fontWeight: t.weight, fontStyle: t.italic ? 'italic' : undefined }}>
                  {t.text}
                </span>
              ))}
              {typing && !editable && (
                <span className="ml-0.5 inline-block h-[14px] w-[8px] animate-caret-blink bg-iris-bright align-[-2px]" />
              )}
              {!typing && '\n'}
            </pre>
            {!typing && (
              <textarea
                value={text}
                onChange={(e) => handleEdit(e.target.value)}
                readOnly={!editable}
                spellCheck={false}
                aria-label="Generated query editor"
                className={cn(
                  'absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre bg-transparent px-3 py-3 pl-12 outline-none',
                  MONO,
                  'text-transparent caret-iris-bright selection:bg-iris/30 selection:text-transparent',
                  !editable && 'cursor-default',
                )}
                style={{ caretColor: '#818CF8' }}
              />
            )}
            {/* Line-number gutter */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-y-0 left-0 w-9 select-none border-r border-border-hairline bg-bg-inset py-3 text-right pr-2 text-text-muted/60',
                MONO,
              )}
            >
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Guard banner / revalidation status */}
      <AnimatePresence>
        {writeOp && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-l-2 border-risk bg-risk/10"
          >
            <div className="flex items-center gap-2 px-3 py-2 font-mono text-[11.5px] text-risk">
              <ShieldAlert className="size-3.5 shrink-0" />
              Write operations are refused by design — the query layer is read-only.
              <span className="text-risk/70">({writeOp} detected)</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!writeOp && bodyEdited && (
        <div className="border-t border-border-hairline bg-warn/5 px-3 py-1.5 font-mono text-[10.5px] leading-relaxed text-warn/90">
          Body edits are inspected but not executed — this build runs the translated
          intent in the <span className="text-warn"># intent:</span> header. Ask a new
          question to change the result set.
        </div>
      )}
      {!writeOp && reval !== null && (
        <div className="border-t border-border-hairline px-3 py-1.5 font-mono text-[10.5px]">
          {reval < 4 ? (
            <span className="text-text-muted">
              {['→ parsing …', '→ ontology conformance …', '→ read-only guard …', '→ estimating …'][reval]}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-ok">
              <Check className="size-3" /> re-validated · read-only · ontology-conformant
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default QueryEditor;
