import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Hourglass, Loader2, Server } from 'lucide-react';
import { StatusDot } from '@/components/ui/status-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatSeconds, type JobStatus, type OpsSummary } from './utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STATUS_TILE: Record<JobStatus, { label: string; color: string; foot: string }> = {
  queued: { label: 'Queued', color: '#64748B', foot: 'incl. retries in backoff' },
  running: { label: 'Running', color: '#38BDF8', foot: 'under a worker lease' },
  succeeded: { label: 'Succeeded', color: '#34D399', foot: 'completed' },
  failed: { label: 'Failed', color: '#F87171', foot: 'attempts spent, or cancelled' },
};

function StatusMark({ status, count }: { status: JobStatus; count: number }) {
  if (status === 'queued') {
    return <span aria-hidden className="size-2 rounded-full border-[1.5px] border-text-muted" />;
  }
  if (status === 'running') {
    return count > 0 ? <Loader2 className="size-3.5 animate-spin text-info" /> : <StatusDot status="idle" pulse={false} />;
  }
  return <StatusDot status={status === 'succeeded' ? 'ok' : 'risk'} pulse={false} />;
}

interface TileProps {
  label: string;
  value: string;
  foot: ReactNode;
  mark?: ReactNode;
  color?: string;
  tone?: 'warn';
  active?: boolean;
  onClick?: () => void;
  index: number;
}

/** Mirrors KpiCard: caption label, 28px mono value, mono footer; status-tinted top hairline. */
function Tile({ label, value, foot, mark, color, tone, active, onClick, index }: TileProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</span>
        {mark}
      </div>
      <div
        className={cn(
          'mt-2 font-mono text-[28px] font-medium leading-none tabular-nums',
          tone === 'warn' ? 'text-warn' : 'text-text-primary',
        )}
      >
        {value}
      </div>
      <div className={cn('mt-2.5 truncate font-mono text-[10.5px]', tone === 'warn' ? 'text-warn/90' : 'text-text-muted')}>
        {foot}
      </div>
    </>
  );
  const cls = cn(
    'h-full w-full rounded-xl border bg-bg-panel p-4 text-left transition-all duration-200',
    active ? 'border-iris/50 bg-bg-panel-raised/60' : 'border-border-hairline',
    tone === 'warn' && !active && 'border-warn/30',
    onClick && 'cursor-pointer hover:border-border-glow hover:bg-bg-panel-raised/60',
  );
  const style = color ? { boxShadow: `inset 0 1px 0 0 ${color}59` } : undefined;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: EASE }}
    >
      {onClick ? (
        <button type="button" onClick={onClick} aria-pressed={active} className={cls} style={style}>
          {body}
        </button>
      ) : (
        <div className={cls} style={style}>
          {body}
        </div>
      )}
    </motion.div>
  );
}

export interface SummaryTilesProps {
  summary: OpsSummary | undefined;
  isLoading: boolean;
  filter: JobStatus | 'all';
  onFilter: (status: JobStatus | 'all') => void;
}

/**
 * Operations §1 — queue depth per status (click to filter the jobs table),
 * the oldest queued job's wait, and how many workers have a fresh heartbeat.
 */
export function SummaryTiles({ summary, isLoading, filter, onFilter }: SummaryTilesProps) {
  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[112px] rounded-xl border border-border-hairline bg-bg-panel" />
        ))}
      </div>
    );
  }

  const { byStatus, oldestQueuedSeconds, workersAlive } = summary;
  const stalled = workersAlive === 0 && byStatus.queued > 0;
  const statuses: JobStatus[] = ['queued', 'running', 'succeeded', 'failed'];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {statuses.map((s, i) => (
        <Tile
          key={s}
          index={i}
          label={STATUS_TILE[s].label}
          value={byStatus[s].toLocaleString('en-US')}
          foot={STATUS_TILE[s].foot}
          mark={<StatusMark status={s} count={byStatus[s]} />}
          color={STATUS_TILE[s].color}
          active={filter === s}
          onClick={() => onFilter(filter === s ? 'all' : s)}
        />
      ))}
      <Tile
        index={4}
        label="Oldest wait"
        value={oldestQueuedSeconds == null ? '—' : formatSeconds(oldestQueuedSeconds)}
        foot={oldestQueuedSeconds == null ? 'nothing waiting' : 'longest-queued job'}
        mark={<Hourglass className="size-3.5 text-text-muted" />}
        tone={stalled ? 'warn' : undefined}
      />
      <Tile
        index={5}
        label="Workers alive"
        value={String(workersAlive)}
        foot={workersAlive === 0 ? 'no fresh heartbeat' : 'heartbeat within 15s'}
        mark={workersAlive > 0 ? <StatusDot status="ok" /> : <Server className="size-3.5 text-text-muted" />}
        tone={workersAlive === 0 ? 'warn' : undefined}
      />
    </div>
  );
}
