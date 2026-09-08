import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Cpu, Crosshair, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/status-dot';
import { IRIChip } from '@/components/ui/iri-chip';
import type { ReasonerResult } from './studio-utils';

export interface ConsoleBarProps {
  result: ReasonerResult | null;
  running: boolean;
  lastRunAt: Date | null;
  showInferred: boolean;
  onToggleInferred: (v: boolean) => void;
  onLocate: (iri: string) => void;
}

function now(): string {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * ConsoleBar — 40px bottom bar (expandable to 240px) with validation status
 * and the simulated-reasoner log. Derived from runReasoner output.
 */
export function ConsoleBar({
  result,
  running,
  lastRunAt,
  showInferred,
  onToggleInferred,
  onLocate,
}: ConsoleBarProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'validation' | 'reasoner'>('reasoner');

  const violations = result?.issues.length ?? 0;
  const warnings = result?.warnings.length ?? 0;
  const inferences = result?.inferredSubClassOf.length ?? 0;
  const ok = result ? result.consistent : true;

  // Validation rows: issues (violations) + warnings, mapped to class-ish IRIs for Locate
  const validationRows = result
    ? [
        ...result.issues.map((msg) => ({ severity: 'violation' as const, msg })),
        ...result.warnings.map((msg) => ({ severity: 'warning' as const, msg })),
      ]
    : [];

  const iriInMessage = (msg: string): string | null => {
    const m = msg.match(/[a-z]+:[A-Za-z0-9]+/);
    return m ? m[0] : null;
  };

  return (
    <div className="shrink-0 border-t border-border-hairline bg-bg-panel">
      {/* collapsed row */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-bg-panel-raised/50"
      >
        <StatusDot status={running ? 'info' : ok ? 'ok' : 'risk'} pulse={running} />
        <span className="text-[12.5px] text-text-secondary">
          {running
            ? 'Reasoner running…'
            : result
              ? ok
                ? `Validation passed · ${violations} violations · ${warnings} warnings`
                : `Inconsistent — ${violations} issue${violations === 1 ? '' : 's'} found`
              : 'Not validated yet — run the reasoner'}
        </span>
        <span className="ml-auto hidden items-center gap-2 font-mono text-[10.5px] text-text-muted sm:flex">
          <Cpu className="size-3" />
          {result ? result.reasoner.split(' ')[0] : 'ontos-sim'} reasoner
          {lastRunAt && ` · last run ${lastRunAt.toTimeString().slice(0, 5)}`}
          {result && ` · ${inferences} inferences`}
        </span>
        {open ? <ChevronDown className="size-3.5 text-text-muted" /> : <ChevronUp className="size-3.5 text-text-muted" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 240 }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex h-60 flex-col border-t border-border-hairline">
              {/* tabs */}
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-hairline px-3">
                {(
                  [
                    { key: 'validation', label: 'Validation (pySHACL)', icon: ShieldCheck },
                    { key: 'reasoner', label: 'Reasoner', icon: Cpu },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors',
                      tab === t.key ? 'bg-bg-panel-raised text-text-accent' : 'text-text-muted hover:text-text-primary',
                    )}
                  >
                    <t.icon className="size-3" /> {t.label}
                  </button>
                ))}
                {tab === 'reasoner' && result && (
                  <label className="ml-auto flex cursor-pointer items-center gap-2 font-mono text-[10.5px] text-text-secondary">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showInferred}
                      onClick={() => onToggleInferred(!showInferred)}
                      className={cn('h-3.5 w-6 rounded-full p-px transition-colors', showInferred ? 'bg-ok' : 'bg-border-hairline')}
                    >
                      <span className={cn('block size-3 rounded-full bg-text-primary transition-transform', showInferred && 'translate-x-2.5')} />
                    </button>
                    Show inferred on canvas
                  </label>
                )}
              </div>

              {/* body */}
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {!result ? (
                  <p className="px-2 py-4 text-center font-mono text-[11.5px] text-text-muted">
                    No run yet — press “Run reasoner” in the toolbar.
                  </p>
                ) : tab === 'validation' ? (
                  validationRows.length === 0 ? (
                    <p className="px-2 py-4 text-center font-mono text-[11.5px] text-ok">
                      ✓ 0 violations · 0 warnings
                    </p>
                  ) : (
                    validationRows.map((r, i) => {
                      const iri = iriInMessage(r.msg);
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25, delay: i * 0.03 }}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-panel-raised/60"
                        >
                          <StatusDot status={r.severity === 'violation' ? 'risk' : 'warn'} pulse={false} />
                          {iri && <IRIChip iri={iri} />}
                          <span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">{r.msg}</span>
                          {iri && (
                            <button
                              type="button"
                              onClick={() => onLocate(iri)}
                              className="flex shrink-0 items-center gap-1 rounded border border-border-hairline px-1.5 py-0.5 font-mono text-[10px] text-text-accent transition-colors hover:border-border-glow"
                            >
                              <Crosshair className="size-2.5" /> Locate
                            </button>
                          )}
                        </motion.div>
                      );
                    })
                  )
                ) : (
                  <div className="space-y-0.5 font-mono text-[11.5px]">
                    <AnimatePresence initial={false}>
                      {[`[${lastRunAt ? lastRunAt.toTimeString().slice(0, 8) : now()}] ${result.reasoner}`]
                        .concat(result.log)
                        .map((line, i) => (
                          <motion.div
                            key={`${i}-${line}`}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, delay: i * 0.04 }}
                            className={cn(
                              'px-2 py-0.5',
                              line.startsWith('inferred')
                                ? 'text-info'
                                : line.startsWith('consistent')
                                  ? result.consistent
                                    ? 'text-ok'
                                    : 'text-risk'
                                  : 'text-text-secondary',
                            )}
                          >
                            {i === 0 ? line : `[${lastRunAt ? lastRunAt.toTimeString().slice(0, 8) : now()}] ${line}`}
                          </motion.div>
                        ))}
                    </AnimatePresence>
                    <div className="px-2 pt-1 text-text-muted">
                      {result.classesClassified} classes classified · {result.durationMs}ms ·{' '}
                      {result.consistent ? 'consistent: true' : 'consistent: false'} ·{' '}
                      {result.inferredSubClassOf.length} inferred subclass links (log shows first 12)
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ConsoleBar;
