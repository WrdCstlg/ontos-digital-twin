import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface LiveValueProps {
  /** Caption above the value (card grid) */
  label?: string;
  value: string;
  unit?: string;
  /**
   * Incremented on every simulator tick. When it changes AND `changed` is
   * true, the number cross-fades and the wrapper gets the teal flash wash.
   */
  tickId?: number;
  /** Whether this value changed on the last tick */
  changed?: boolean;
  /** Larger hero rendering */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * LiveValue — mono value (tabular figures) + optional unit. Decreases never
 * use red; change is signalled by the teal flash wash + number cross-fade.
 */
export function LiveValue({
  label,
  value,
  unit,
  tickId = 0,
  changed = false,
  size = 'sm',
  className,
}: LiveValueProps) {
  const inner = (
    <motion.span
      className={cn('inline-flex items-baseline gap-1 rounded px-1 -mx-1', className)}
      animate={changed ? { backgroundColor: ['#2DD4BF33', '#2DD4BF00'] } : { backgroundColor: '#2DD4BF00' }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <motion.span
        key={`${tickId}-${value}`}
        initial={changed ? { opacity: 0, y: 4 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'font-mono tabular-nums text-text-primary',
          size === 'sm' ? 'text-[13px] font-medium' : 'text-[20px] font-medium leading-none',
        )}
      >
        {value}
      </motion.span>
      {unit && <span className="font-mono text-[10.5px] text-text-muted">{unit}</span>}
    </motion.span>
  );

  if (!label) return inner;
  return (
    <span className="inline-flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</span>
      {inner}
    </span>
  );
}
