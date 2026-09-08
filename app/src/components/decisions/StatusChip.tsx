import { cn } from '@/lib/utils';
import { STATUS_META, type AdrStatus } from './adr-data';

export function StatusChip({ status, className }: { status: AdrStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.1em]',
        status === 'superseded' && 'line-through decoration-1',
        className,
      )}
      style={{
        color: meta.color,
        backgroundColor: `${meta.color}1f`,
        border: `1px solid ${meta.color}40`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
      {meta.label}
    </span>
  );
}
