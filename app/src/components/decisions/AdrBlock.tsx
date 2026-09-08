import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from './StatusChip';
import type { Adr } from './adr-data';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

/**
 * One long-form ADR entry: context, decision callout, alternatives table,
 * consequences (gains/costs), trade-off footer. Superseded ADRs render
 * collapsed by default with a struck-through title.
 */
export function AdrBlock({ adr }: { adr: Adr }) {
  const superseded = adr.status === 'superseded';
  const [expanded, setExpanded] = useState(!superseded);

  return (
    <motion.section
      id={adr.id.toLowerCase()}
      layout="position"
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-20% 0px' }}
      transition={{ duration: 0.5, ease: EASE }}
      className="scroll-mt-24 rounded-2xl border border-border-hairline bg-bg-panel p-6 lg:p-8"
    >
      <header className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[12px] font-medium text-iris-bright">{adr.id}</span>
        <h2
          className={cn(
            'font-display text-[24px] font-semibold leading-[1.3] tracking-[-0.015em] text-text-primary',
            superseded && 'text-text-secondary line-through decoration-text-muted/60 decoration-1',
          )}
        >
          {adr.title}
        </h2>
        <StatusChip status={adr.status} />
        <span className="ml-auto font-mono text-[11.5px] text-text-muted">{adr.date}</span>
      </header>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-text-muted">Deciders</span>
        <span className="flex -space-x-1.5">
          {adr.deciders.map((d) => (
            <span
              key={d}
              title={d}
              className="flex size-6 items-center justify-center rounded-full border border-bg-panel bg-gradient-to-br from-iris-deep to-iris font-display text-[8.5px] font-semibold text-white"
            >
              {initials(d)}
            </span>
          ))}
        </span>
        {superseded && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border-hairline px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
            aria-expanded={expanded}
          >
            {expanded ? 'Collapse' : 'Expand record'}
            <ChevronDown className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-6 space-y-6">
              {/* Context */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">Context</h3>
                {adr.context.map((p, i) => (
                  <p key={i} className="text-[15px] leading-[1.6] text-text-secondary">
                    {p}
                  </p>
                ))}
              </div>

              {/* Decision callout */}
              <div className="relative overflow-hidden rounded-lg bg-bg-panel-raised">
                <motion.span
                  initial={{ scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true, margin: '-10% 0px' }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="absolute inset-y-0 left-0 w-[3px] origin-top bg-iris"
                  aria-hidden
                />
                <div className="p-4 pl-5">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-iris-bright">Decision</h3>
                  <p className="mt-2 text-[15px] leading-[1.65] text-text-primary">{adr.decision}</p>
                </div>
              </div>

              {/* Optional callout (demo disclosure / superseded note) */}
              {adr.callout && (
                <div
                  className={cn(
                    'flex gap-3 rounded-lg border p-4',
                    adr.callout.kind === 'info' ? 'border-info/30 bg-info/10' : 'border-warn/30 bg-warn/10',
                  )}
                >
                  {adr.callout.kind === 'info' ? (
                    <Info className="mt-0.5 size-4 shrink-0 text-info" />
                  ) : (
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                  )}
                  <div>
                    <p className={cn('text-[12px] font-semibold', adr.callout.kind === 'info' ? 'text-info' : 'text-warn')}>
                      {adr.callout.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{adr.callout.text}</p>
                  </div>
                </div>
              )}

              {/* Alternatives */}
              <div>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
                  Alternatives considered
                </h3>
                <div className="mt-3 overflow-x-auto rounded-lg border border-border-hairline">
                  <table className="w-full min-w-[560px] text-left">
                    <thead>
                      <tr className="border-b border-border-hairline bg-bg-inset">
                        {['Option', 'Strengths', 'Weaknesses', 'Verdict'].map((h) => (
                          <th
                            key={h}
                            className="px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {adr.alternatives.map((alt, i) => (
                        <motion.tr
                          key={alt.option}
                          initial={{ opacity: 0 }}
                          whileInView={{ opacity: 1 }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.25, delay: i * 0.04 }}
                          className="border-b border-border-hairline/60 transition-colors last:border-0 hover:bg-bg-panel-raised/60"
                        >
                          <td className="px-3.5 py-2.5 align-top text-[13px] font-medium text-text-primary">{alt.option}</td>
                          <td className="px-3.5 py-2.5 align-top text-[12.5px] leading-5 text-text-secondary">{alt.strengths}</td>
                          <td className="px-3.5 py-2.5 align-top text-[12.5px] leading-5 text-text-secondary">{alt.weaknesses}</td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 align-top font-mono text-[11px] text-text-accent">
                            {alt.verdict}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Consequences */}
              <div>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">Consequences</h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <ul className="space-y-2 rounded-lg border border-ok/20 bg-ok/5 p-4">
                    {adr.gains.map((g) => (
                      <li key={g} className="flex items-start gap-2 text-[13px] leading-5 text-text-secondary">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
                        {g}
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-2 rounded-lg border border-warn/20 bg-warn/5 p-4">
                    {adr.costs.map((c) => (
                      <li key={c} className="flex items-start gap-2 text-[13px] leading-5 text-text-secondary">
                        <X className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Trade-off footer */}
              <p className="border-t border-border-hairline pt-4 font-mono text-[12px] italic leading-6 text-text-muted">
                {adr.tradeoff}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
