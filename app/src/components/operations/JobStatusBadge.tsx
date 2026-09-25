import { Loader2 } from 'lucide-react';
import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';
import type { JobStatus } from './utils';

const DEFAULT_LABEL: Record<JobStatus, string> = {
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
};

export interface JobStatusBadgeProps {
  status: JobStatus;
  /** Override the visible label (e.g. "ok" in the compact sync-runs table). */
  label?: string;
  className?: string;
}

/**
 * Status of a background job. Queued is deliberately calm — a hollow ring and
 * muted text, since waiting for a worker is normal — while running spins in
 * info blue and the terminal states use the ok / risk status dots.
 */
export function JobStatusBadge({ status, label, className }: JobStatusBadgeProps) {
  const text = label ?? DEFAULT_LABEL[status];
  if (status === 'queued') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[12px] text-text-secondary', className)}>
        <span aria-hidden className="inline-flex size-2 shrink-0 rounded-full border-[1.5px] border-text-muted" />
        {text}
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[12px] text-info', className)}>
        <Loader2 className="size-3 animate-spin" /> {text}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] text-text-secondary', className)}>
      <StatusDot status={status === 'succeeded' ? 'ok' : 'risk'} pulse={false} /> {text}
    </span>
  );
}
