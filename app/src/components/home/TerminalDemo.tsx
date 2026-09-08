import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, useInView } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { moduleForPrefix } from '@/lib/modules';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Canned {
  question: string;
  sparql: string;
  columns: string[];
  rows: string[][];
  footer: string;
}

const SESSION: Canned[] = [
  {
    question: 'Which employees signed contracts governed by policies with open audit findings?',
    sparql: `PREFIX hr:  <https://ontos.acme.corp/ontology/hr/>
PREFIX legal: <https://ontos.acme.corp/ontology/legal/>
PREFIX cmp:  <https://ontos.acme.corp/ontology/cmp/>

SELECT ?person ?contract ?policy ?finding
WHERE {
  ?person   a hr:Person ;
            hr:signs ?contract .
  ?contract legal:governedBy ?policy .
  ?finding  a cmp:AuditFinding ;
            cmp:targets ?policy ;
            cmp:status "open" .
} LIMIT 4`,
    columns: ['employee', 'contract', 'policy', 'finding'],
    rows: [
      ['A. Osei (E-1042)', 'C-2291 · VendorCo MSA', 'POL-SEC-07', 'AF-118 · access review'],
      ['L. Marsh (E-1043)', 'C-2292 · DataDyne DPA', 'POL-PRV-02', 'AF-121 · retention'],
      ['R. Ito (E-1017)', 'C-2304 · Northwind SOW', 'POL-SEC-07', 'AF-118 · access review'],
    ],
    footer: '4 results · 38 ms · traced to 11 source records',
  },
  {
    question: 'Show vendors with payments in the last quarter but no active contract.',
    sparql: `PREFIX fin:   <https://ontos.acme.corp/ontology/fin/>
PREFIX legal: <https://ontos.acme.corp/ontology/legal/>

SELECT ?vendor (SUM(?amount) AS ?paid)
WHERE {
  ?tx a fin:Transaction ;
      fin:counterparty ?vendor ;
      fin:amount ?amount ;
      fin:postedAt ?date .
  FILTER(?date >= "2025-07-01"^^xsd:date)
  FILTER NOT EXISTS {
    ?contract a legal:Contract ;
              legal:party ?vendor ;
              legal:status "active" .
  }
} GROUP BY ?vendor`,
    columns: ['vendor', 'paid (Q3)', 'payments'],
    rows: [
      ['VendorCo Ltd.', '$84,200', '6'],
      ['BrightHaul GmbH', '$31,750', '3'],
      ['Kestrel Analytics', '$12,400', '2'],
    ],
    footer: '3 results · 41 ms · traced to 11 source records',
  },
  {
    question: 'Which controls have had no evidence attached in the last 90 days?',
    sparql: `PREFIX cmp: <https://ontos.acme.corp/ontology/cmp/>

SELECT ?control ?owner (MAX(?ts) AS ?lastEvidence)
WHERE {
  ?control a cmp:Control ;
           cmp:ownedBy ?owner .
  OPTIONAL {
    ?evidence a cmp:Evidence ;
              cmp:supports ?control ;
              cmp:capturedAt ?ts .
  }
} GROUP BY ?control ?owner
HAVING(?lastEvidence < "2025-08-15"^^xsd:date || !BOUND(?lastEvidence))`,
    columns: ['control', 'owner', 'last evidence'],
    rows: [
      ['SOX-IT-04 · access review', 'M. Chen (E-1001)', '— never'],
      ['GDPR-A30 · records of processing', 'S. Adeyemi (E-1055)', '2025-06-02'],
      ['ISO-A.12.4 · log protection', 'M. Chen (E-1001)', '2025-05-21'],
    ],
    footer: '3 results · 35 ms · traced to 8 source records',
  },
];

/** Tiny SPARQL highlighter: keywords iris, prefixes module-colored, strings emerald, comments muted. */
function highlightSparql(code: string): React.ReactNode[] {
  const re = /("(?:[^"\\]|\\.)*")|(#.*$)|\b(PREFIX|SELECT|WHERE|FILTER|NOT|EXISTS|GROUP|BY|HAVING|ORDER|LIMIT|OPTIONAL|SUM|MAX|AS|a)\b|\b([a-z]{2,5}:)([A-Za-z_]\w*)?|\b(\?\w+)/gm;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(<span key={k++}>{code.slice(last, m.index)}</span>);
    const [full, str, comment, keyword, prefix, local, variable] = m;
    if (str) out.push(<span key={k++} className="text-ok">{full}</span>);
    else if (comment) out.push(<span key={k++} className="text-text-muted">{full}</span>);
    else if (keyword) out.push(<span key={k++} className="text-iris-bright">{full}</span>);
    else if (prefix) {
      const color = moduleForPrefix(prefix.replace(':', '')).color;
      out.push(
        <span key={k++}>
          <span style={{ color }}>{prefix}</span>
          {local && <span className="text-text-primary">{local}</span>}
        </span>,
      );
    } else if (variable) out.push(<span key={k++} className="text-info">{full}</span>);
    last = m.index + full.length;
  }
  if (last < code.length) out.push(<span key={k++}>{code.slice(last)}</span>);
  return out;
}

type Phase = 'idle' | 'question' | 'translate' | 'sparql' | 'results';

/** Section 5 — live NL-query demo: self-running simulated query session. */
export function TerminalDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const inView = useInView(rootRef, { amount: 0.5 });
  const pausedRef = useRef(false);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [typedQ, setTypedQ] = useState('');
  const [typedS, setTypedS] = useState('');

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    const item = SESSION[round % SESSION.length];

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const tick = () => {
          if (cancelled) return resolve();
          if (pausedRef.current) return void setTimeout(tick, 120);
          setTimeout(() => (cancelled ? resolve() : resolve()), ms);
        };
        tick();
      });

    (async () => {
      setPhase('question');
      setTypedQ('');
      setTypedS('');
      for (let i = 1; i <= item.question.length && !cancelled; i++) {
        setTypedQ(item.question.slice(0, i));
        await wait(24);
      }
      setPhase('translate');
      await wait(900);
      if (cancelled) return;
      setPhase('sparql');
      for (let i = 1; i <= item.sparql.length && !cancelled; i++) {
        setTypedS(item.sparql.slice(0, i));
        await wait(9); // ~18ms/char at 2 chars per tick
        i++;
      }
      if (cancelled) return;
      setPhase('results');
      await wait(3400);
      if (!cancelled) setRound((r) => (r + 1) % SESSION.length);
    })();

    return () => {
      cancelled = true;
    };
  }, [inView, round]);

  const item = SESSION[round % SESSION.length];
  const showResults = phase === 'results';
  const showSparql = phase === 'sparql' || showResults;

  return (
    <section id="explorer" ref={rootRef} className="mx-auto max-w-[1200px] scroll-mt-24 px-6 py-28">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">Ask Anything</p>
      <h2 className="mt-4 max-w-[640px] font-display text-[36px] font-bold leading-[1.1] tracking-[-0.025em] text-text-primary lg:text-[46px]">
        Plain English in. Provable answers out.
      </h2>
      <p className="mt-4 max-w-[620px] text-[15px] leading-relaxed text-text-secondary">
        The translator grounds every query in your ontology, validates it before execution, and refuses unsafe or write
        operations — then shows you exactly what it ran.
      </p>

      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.7, ease: EASE }}
        onMouseEnter={() => (pausedRef.current = true)}
        onMouseLeave={() => (pausedRef.current = false)}
        className="mt-10 overflow-hidden rounded-xl border border-border-hairline bg-bg-inset shadow-2xl"
      >
        {/* window chrome */}
        <div className="flex items-center gap-1.5 border-b border-border-hairline px-4 py-3">
          <span className="size-2.5 rounded-full bg-module-hr/70" />
          <span className="size-2.5 rounded-full bg-module-finance/70" />
          <span className="size-2.5 rounded-full bg-module-compliance/70" />
          <span className="ml-3 font-mono text-[11px] text-text-muted">ontos · graph explorer — acme-prod</span>
          <span className="ml-auto font-mono text-[10px] text-text-muted">hover to pause</span>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {/* NL prompt */}
          <div className="flex items-start gap-3">
            <span className="mt-0.5 font-mono text-[13px] text-iris-bright">ask</span>
            <p className="min-h-[24px] flex-1 font-mono text-[13px] leading-6 text-text-primary">
              {typedQ}
              {phase === 'question' && <span className="ml-0.5 inline-block h-4 w-2 animate-caret-blink bg-iris-bright align-middle" />}
            </p>
          </div>

          {/* translator line */}
          {(phase === 'translate' || showSparql) && (
            <p className="font-mono text-[12px] text-text-secondary">
              <span className="text-iris-bright">→</span> translating with ontology context…{' '}
              {showSparql && (
                <span className="text-ok">
                  validated <Check className="inline size-3 -translate-y-px" />
                </span>
              )}
            </p>
          )}

          {/* generated SPARQL */}
          {showSparql && (
            <div className="rounded-lg border border-border-hairline bg-bg-void p-4">
              <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.65] text-text-secondary">
                {highlightSparql(typedS)}
                {phase === 'sparql' && <span className="ml-0.5 inline-block h-3.5 w-2 animate-caret-blink bg-iris-bright align-middle" />}
              </pre>
            </div>
          )}

          {/* results */}
          {showResults && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
              <div className="overflow-x-auto rounded-lg border border-border-hairline">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-hairline bg-bg-panel">
                      {item.columns.map((c) => (
                        <th key={c} className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.rows.map((r) => (
                      <tr key={r[0]} className="border-b border-border-hairline/60 last:border-0 hover:bg-bg-panel-raised/50">
                        {r.map((cell, ci) => (
                          <td key={ci} className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-text-secondary">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2.5 font-mono text-[11px] text-text-muted">{item.footer}</p>
            </motion.div>
          )}
        </div>
      </motion.div>

      <div className="mt-8 text-center">
        <Link
          to="/app/explorer"
          className="group inline-flex items-center gap-2 rounded-xl border border-iris/40 px-5 py-2.5 text-[14px] font-medium text-text-accent shadow-[0_0_0_0_rgba(99,102,241,0.35)] transition-all duration-150 hover:scale-[1.02] hover:bg-iris/10 [animation:pulse-ring_2s_ease-in-out_infinite]"
        >
          Try it in the demo
          <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-1" />
        </Link>
        <style>{`@keyframes pulse-ring { 0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.35) } 50% { box-shadow: 0 0 0 6px rgba(99,102,241,0) } }`}</style>
      </div>
    </section>
  );
}

export default TerminalDemo;
