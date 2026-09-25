import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { Capability, Service } from '@/lib/landscape';
import { ROADMAP_STYLE, incrementOf, type RoadmapEntry } from './meta';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface RoadmapProps {
  entries: readonly RoadmapEntry[];
  services: Service[];
  capabilities: Capability[];
}

/**
 * The increments in order, as a track of steps: what each one is, where it
 * stands, which services it adds and which capability rows it is meant to close.
 */
export function Roadmap({ entries, services, capabilities }: RoadmapProps) {
  const ordered = [...entries].sort((a, b) => a.increment - b.increment);

  return (
    <ol className="grid gap-4 md:grid-cols-3" aria-label="Roadmap">
      {ordered.map((entry, i) => {
        const st = ROADMAP_STYLE[entry.status];
        const next = ordered[i + 1];
        const adds = services.filter((s) => incrementOf(s.since) === entry.increment);
        const closes = capabilities.filter((c) => c.status === 'planned' && c.increment === entry.increment);
        return (
          <motion.li
            key={entry.increment}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.08, ease: EASE }}
            className="relative flex flex-col"
          >
            {/* step + connector to the next step */}
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-[12px] font-medium',
                  st.step,
                )}
                aria-hidden
              >
                {entry.status === 'shipped' ? <st.icon className="size-4" /> : entry.increment}
              </span>
              {next ? (
                <span className={cn('hidden flex-1 border-t-[1.5px] md:block', ROADMAP_STYLE[next.status].line)} aria-hidden />
              ) : (
                <span className="hidden flex-1 md:block" aria-hidden />
              )}
            </div>

            <div
              className={cn(
                'mt-3 flex flex-1 flex-col rounded-xl border bg-bg-panel p-4',
                entry.status === 'next' ? 'border-iris/40' : 'border-border-hairline',
                entry.status === 'planned' && 'border-dashed',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-text-muted">Increment {entry.increment}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]',
                    st.chip,
                  )}
                >
                  <st.icon className="size-3" /> {st.label}
                </span>
              </div>
              <h3 className="mt-2 font-display text-[15.5px] font-semibold text-text-primary">{entry.title}</h3>
              <p className="mt-1.5 flex-1 text-[13px] leading-[1.6] text-text-secondary">{entry.summary}</p>
              {(adds.length > 0 || closes.length > 0) && (
                <dl className="mt-3 space-y-1.5 border-t border-border-hairline pt-3">
                  {adds.length > 0 && (
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Adds</dt>
                      {adds.map((s) => (
                        <dd key={s.id} className="rounded border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-text-secondary">
                          {s.name}
                        </dd>
                      ))}
                    </div>
                  )}
                  {closes.length > 0 && (
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Closes</dt>
                      {closes.map((c) => (
                        <dd key={c.area} className="rounded border border-iris/30 bg-iris/10 px-1.5 py-0.5 font-mono text-[10.5px] text-text-accent">
                          {c.area}
                        </dd>
                      ))}
                    </div>
                  )}
                </dl>
              )}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
