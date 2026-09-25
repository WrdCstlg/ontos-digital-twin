import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';

/**
 * An action type's status. Active reads as ready (ok dot); draft is a calm
 * hollow ring, like a queued job; disabled is switched off (muted, struck).
 */
export function ActionStatusBadge({ status, className }: { status: string; className?: string }) {
  if (status === 'active') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11px] text-ok', className)}>
        <StatusDot status="ok" pulse={false} /> active
      </span>
    );
  }
  if (status === 'draft') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11px] text-text-secondary', className)}>
        <span aria-hidden className="inline-flex size-2 shrink-0 rounded-full border-[1.5px] border-text-muted" /> draft
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11px] text-text-muted', className)}>
      <StatusDot status="idle" pulse={false} /> <span className="line-through decoration-text-muted/60">disabled</span>
    </span>
  );
}

/** Whether a submission was applied or rejected. */
export function SubmissionStatusBadge({ status, className }: { status: string; className?: string }) {
  const applied = status === 'applied';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px]',
        applied ? 'text-text-secondary' : 'text-risk',
        className,
      )}
    >
      <StatusDot status={applied ? 'ok' : 'risk'} pulse={false} /> {applied ? 'applied' : 'rejected'}
    </span>
  );
}

/** A small mono chip, e.g. a minimum role or a version. */
export function MetaChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
