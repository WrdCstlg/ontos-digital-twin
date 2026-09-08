import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { fmtTimeMs, fmtValue, type LogEntry } from './meta';

export interface EventLogProps {
  entries: LogEntry[];
  autoTick: boolean;
  tickCount: number;
  onSelect: (iri: string) => void;
}

/**
 * EventLog — live pulse strip: newest simulator changes on top, mono lines,
 * changed fields in teal, status transitions in amber/risk. Honest: when
 * auto-tick is off the LIVE pill becomes PAUSED and nothing moves.
 */
export function EventLog({ entries, autoTick, tickCount, onSelect }: EventLogProps) {
  return (
    <div className="flex h-24 shrink-0 flex-col rounded-xl border border-border-hairline bg-bg-inset">
      <div className="flex items-center gap-2.5 border-b border-border-hairline px-3.5 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          Simulator event log
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0 font-mono text-[9px] font-medium uppercase tracking-[0.08em]',
            autoTick ? 'border-module-twin/40 bg-module-twin/15 text-module-twin' : 'border-border-hairline text-text-muted',
          )}
        >
          <span className="relative inline-flex size-1.5">
            {autoTick && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-module-twin opacity-60 [animation-duration:1.6s]" aria-hidden />
            )}
            <span className={cn('relative inline-flex size-1.5 rounded-full', autoTick ? 'bg-module-twin' : 'bg-text-muted')} />
          </span>
          {autoTick ? 'LIVE' : 'PAUSED'}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-text-muted">
          auto-tick 2s · tick #{tickCount.toLocaleString('en-US')}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-3.5 py-1 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
        {entries.length === 0 && (
          <div className="py-1 font-mono text-[10.5px] text-text-muted">
            no simulator events yet — press Tick or enable AUTO.
          </div>
        )}
        <AnimatePresence initial={false}>
          {entries.map((e) => {
            const isStatus = e.kind === 'status';
            return (
              <motion.button
                key={e.id}
                type="button"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => onSelect(e.iri)}
                className="block w-full truncate py-0.5 text-left font-mono text-[10.5px] leading-4 transition-colors hover:bg-bg-panel-raised/60"
              >
                <span className="text-text-muted">{fmtTimeMs(e.at)}</span>{' '}
                <span className="text-text-muted">tick #{e.tickNo.toLocaleString('en-US')}</span>
                {' — '}
                {e.key ? (
                  <>
                    <span className="text-text-secondary">
                      {e.label}.{e.key}
                    </span>{' '}
                    <span className={isStatus ? 'text-warn' : 'text-module-twin'}>
                      {fmtValue(e.key, e.oldV)} → {fmtValue(e.key, e.newV)}
                    </span>
                    {isStatus && <span className="text-warn"> △ status</span>}
                  </>
                ) : (
                  <span className="text-text-muted">{e.label}</span>
                )}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
