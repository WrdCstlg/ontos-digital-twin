import { useState } from 'react';
import { motion } from 'framer-motion';
import { History, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HistoryEntry } from './types';

export interface QueryHistoryRailProps {
  entries: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  onToggleSave: (id: string) => void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * QueryHistoryRail — left-edge collapsible rail (48px → 280px on hover)
 * of past queries with bookmark stars; click restores the full state.
 */
export function QueryHistoryRail({ entries, onRestore, onToggleSave }: QueryHistoryRailProps) {
  const [open, setOpen] = useState(false);
  const saved = entries.filter((e) => e.saved);
  const recent = entries.filter((e) => !e.saved);

  return (
    <motion.aside
      onHoverStart={() => setOpen(true)}
      onHoverEnd={() => setOpen(false)}
      animate={{ width: open ? 280 : 48 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className="absolute inset-y-0 left-0 z-20 flex flex-col overflow-hidden border-r border-border-hairline bg-bg-panel/95 backdrop-blur"
    >
      <div className={cn('flex items-center gap-2 border-b border-border-hairline px-3.5 py-3', !open && 'justify-center px-0')}>
        <History className="size-4 shrink-0 text-text-muted" />
        {open && <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Query history</span>}
      </div>

      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries.length === 0 && (
            <p className="px-2 py-6 text-center font-mono text-[11px] text-text-muted">
              No queries yet — ask something.
            </p>
          )}
          {saved.length > 0 && (
            <div className="px-2 pb-1 pt-1 text-[9.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Saved</div>
          )}
          {[...saved, ...recent].map((e, i) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, duration: 0.2 }}
              className="group mb-1 flex items-start gap-1.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border-hairline hover:bg-bg-panel-raised"
            >
              <button type="button" onClick={() => onRestore(e)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-mono text-[11px] text-text-secondary group-hover:text-text-primary">
                  {e.question}
                </span>
                <span className="mt-0.5 block font-mono text-[9.5px] text-text-muted">
                  {fmtTime(e.ts)}
                  {e.intent ? ` · ${e.intent}` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onToggleSave(e.id)}
                aria-label={e.saved ? 'Remove bookmark' : 'Bookmark query'}
                className={cn(
                  'mt-0.5 shrink-0 rounded p-0.5 transition-colors',
                  e.saved ? 'text-warn' : 'text-text-muted opacity-0 hover:text-warn group-hover:opacity-100',
                )}
              >
                <Star className="size-3.5" fill={e.saved ? 'currentColor' : 'none'} />
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </motion.aside>
  );
}

export default QueryHistoryRail;
