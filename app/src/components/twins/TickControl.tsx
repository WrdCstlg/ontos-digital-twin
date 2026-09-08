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
}

/**
 * TickControl — segmented simulator control: `⏵ Tick` primary-ghost button
 * (teal) + auto-tick switch (`AUTO · 2s`) + mono tick counter + mono
 * last-tick timestamp. The button fires a tick-pulse ring on each tick.
 */
export function TickControl({
  tickCount,
  lastTickAt,
  autoTick,
  onAutoTickChange,
  onTick,
  ticking,
}: TickControlProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-hairline bg-bg-panel px-3 py-1.5">
      <motion.button
        type="button"
        onClick={onTick}
        disabled={ticking}
        key={tickCount}
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

      <label className="flex cursor-pointer items-center gap-2">
        <Switch
          checked={autoTick}
          onCheckedChange={onAutoTickChange}
          aria-label="Auto-tick every 2 seconds"
          className="data-[state=checked]:bg-module-twin"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          AUTO · 2s
        </span>
      </label>

      <span className="h-4 w-px bg-border-hairline" aria-hidden />

      <motion.span
        key={tickCount}
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
