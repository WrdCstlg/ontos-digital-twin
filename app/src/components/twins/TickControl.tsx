import { motion } from 'framer-motion';
import { Loader2, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { fmtTimeMs } from './meta';

export interface TickControlProps {
  tickCount: number;
  lastTickAt: string | null;
  autoTick: boolean;
  onAutoTickChange: (on: boolean) => void;
  onTick: () => void;
  ticking: boolean;
  /** False for a viewer: a tick writes twin state, which is an editor's to do. */
  canSimulate: boolean;
}

const VIEW_ONLY_REASON = 'Running the simulation changes twin state, so it takes the editor role or above.';

/**
 * TickControl — segmented simulator control: `⏵ Tick` primary-ghost button
 * (teal) + auto-tick switch (`AUTO · 2s`) + mono tick counter + mono
 * last-tick timestamp. The button fires a tick-pulse ring on each tick.
 * For someone who may not run the simulation both controls are disabled and
 * say why, rather than failing on each tick.
 */
export function TickControl({
  tickCount,
  lastTickAt,
  autoTick,
  onAutoTickChange,
  onTick,
  ticking,
  canSimulate,
}: TickControlProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-border-hairline bg-bg-panel px-3 py-1.5"
      title={canSimulate ? undefined : VIEW_ONLY_REASON}
    >
      {!canSimulate && (
        <span id="tick-view-only" className="sr-only">
          {VIEW_ONLY_REASON}
        </span>
      )}
      <motion.button
        type="button"
        onClick={onTick}
        disabled={ticking || !canSimulate}
        aria-describedby={canSimulate ? undefined : 'tick-view-only'}
        // Keyed by tick so the pulse replays on every tick. The key must be
        // namespaced: this and the counter below are siblings, and a bare
        // tickCount made both of them key `0` on first render.
        key={`tick-button-${tickCount}`}
        initial={{ boxShadow: '0 0 0 0 #2DD4BF55' }}
        animate={{ boxShadow: '0 0 0 8px #2DD4BF00' }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border border-module-twin/40 bg-module-twin/15 px-3 py-1.5',
          'font-mono text-[11.5px] font-medium text-module-twin transition-colors duration-150',
          'hover:bg-module-twin/25 disabled:opacity-60',
        )}
      >
        {ticking ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        Tick
      </motion.button>

      <label className={cn('flex items-center gap-2', canSimulate ? 'cursor-pointer' : 'cursor-not-allowed')}>
        <Switch
          checked={autoTick && canSimulate}
          onCheckedChange={onAutoTickChange}
          disabled={!canSimulate}
          aria-label="Auto-tick every 2 seconds"
          aria-describedby={canSimulate ? undefined : 'tick-view-only'}
          className="data-[state=checked]:bg-module-twin"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {canSimulate ? 'AUTO · 2s' : 'VIEW ONLY'}
        </span>
      </label>

      <span className="h-4 w-px bg-border-hairline" aria-hidden />

      <motion.span
        key={`tick-count-${tickCount}`}
        initial={{ opacity: 0.3, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="font-mono text-[11.5px] tabular-nums text-text-secondary"
      >
        #{tickCount.toLocaleString('en-US')}
      </motion.span>
      <motion.span
        key={`t-${lastTickAt ?? 'none'}`}
        initial={{ color: '#2DD4BF' }}
        animate={{ color: '#64748B' }}
        transition={{ duration: 0.9 }}
        className="hidden font-mono text-[10.5px] tabular-nums sm:inline"
      >
        {lastTickAt ? fmtTimeMs(lastTickAt) : '—'}
      </motion.span>
    </div>
  );
}
