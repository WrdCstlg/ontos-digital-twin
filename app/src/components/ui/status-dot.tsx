import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type StatusKind = 'ok' | 'warn' | 'risk' | 'info' | 'idle';

const STATUS_COLORS: Record<StatusKind, string> = {
  ok: '#34D399',
  warn: '#FBBF24',
  risk: '#F87171',
  info: '#38BDF8',
  idle: '#64748B',
};

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  status: StatusKind;
  /** Disable the 1.6s pulse ring (e.g. for static lists) */
  pulse?: boolean;
}

/**
 * StatusDot — 8px dot with a 1.6s pulse ring, colored by status token.
 */
export function StatusDot({ status, pulse = true, className, ...props }: StatusDotProps) {
  const color = STATUS_COLORS[status];
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} {...props}>
      {pulse && (
        <span
          className="absolute inline-flex size-full animate-ping rounded-full opacity-60 [animation-duration:1.6s]"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      <span className="relative inline-flex size-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}
