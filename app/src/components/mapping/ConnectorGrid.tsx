import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  FileSpreadsheet,
  Globe,
  MoreHorizontal,
  Play,
  Plus,
  Upload,
  Waypoints,
} from 'lucide-react';
import { StatusDot } from '@/components/ui/status-dot';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getModule, moduleAlpha, type ModuleKey } from '@/lib/modules';
import { relTime, type ConnectorLike, type MappingLike, type SyncJobLike } from './utils';

const TYPE_META: Record<ConnectorLike['type'], { icon: typeof Database; tag: string }> = {
  csv: { icon: FileSpreadsheet, tag: 'CSV' },
  sql: { icon: Database, tag: 'SQL' },
  rest: { icon: Globe, tag: 'REST' },
};

function connectorColor(conn: ConnectorLike, mapping?: MappingLike | null): string {
  const key = (mapping?.module?.key ?? null) as ModuleKey | null;
  if (key && ['hr', 'legal', 'compliance', 'finance', 'logistics', 'custom'].includes(key)) {
    return getModule(key).color;
  }
  return conn.type === 'csv' ? '#FB7185' : conn.type === 'sql' ? '#A78BFA' : '#38BDF8';
}

function subtitle(conn: ConnectorLike): string {
  const cfg = (conn.configJson ?? {}) as Record<string, unknown>;
  if (conn.type === 'csv') return `CSV · ${String(cfg.filename ?? 'upload')}`;
  if (conn.type === 'sql') return `SQL · ${String(cfg.driver ?? 'sql')} · ${String(cfg.host ?? '—')}`;
  return `REST · ${String(cfg.baseUrl ?? '—')}`;
}

function statsLine(conn: ConnectorLike, jobs: SyncJobLike[]): string {
  const cfg = (conn.configJson ?? {}) as Record<string, unknown>;
  const mine = jobs.filter((j) => j.connector?.id === conn.id);
  const last = mine[0];
  const parts: string[] = [];
  if (typeof cfg.rows === 'number') {
    parts.push(`${cfg.rows} rows${last ? ` → ${last.rowsProcessed} instances` : ''}`);
  } else if (last) {
    parts.push(`${last.rowsProcessed} instances last run`);
  }
  if (typeof cfg.schedule === 'string') parts.push(`schedule: ${cfg.schedule}`);
  if (cfg.mode === 'cdc') parts.push('CDC live');
  if (conn.type === 'rest') parts.push('webhook-triggered');
  return parts.join(' · ') || 'not synced yet';
}

/** 40px-tall sparkline of rows processed per sync, oldest → newest. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="h-10" aria-hidden />;
  const w = 120;
  const h = 40;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - ((v - min) / span) * (h - 8)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export interface ConnectorGridProps {
  connectors: ConnectorLike[];
  mappings: MappingLike[];
  jobs: SyncJobLike[];
  selectedId: number | null;
  onOpenMapping: (connectorId: number) => void;
  onNewConnector: () => void;
  onUploadCsv: (connectorId: number) => void;
  onRunNow: (mappingId: number) => void;
  runningMappingId: number | null;
}

export function ConnectorGrid({
  connectors,
  mappings,
  jobs,
  selectedId,
  onOpenMapping,
  onNewConnector,
  onUploadCsv,
  onRunNow,
  runningMappingId,
}: ConnectorGridProps) {
  const mappingByConnector = useMemo(() => {
    const m = new Map<number, MappingLike>();
    for (const mp of mappings) if (!m.has(mp.connectorId)) m.set(mp.connectorId, mp);
    return m;
  }, [mappings]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {connectors.map((conn, i) => {
        const mapping = mappingByConnector.get(conn.id) ?? null;
        const color = connectorColor(conn, mapping);
        const Icon = TYPE_META[conn.type].icon;
        const mine = jobs.filter((j) => j.connector?.id === conn.id);
        const lastOk = mine.find((j) => j.status === 'succeeded');
        const sparkValues = [...mine].reverse().map((j) => j.rowsProcessed);
        const dot = conn.status === 'connected' ? 'ok' : conn.status === 'error' ? 'risk' : 'warn';
        const cfg = (conn.configJson ?? {}) as Record<string, unknown>;
        const runnable = conn.type === 'csv' && cfg.hasInlineData === true && mapping != null;
        const running = runningMappingId != null && mapping?.id === runningMappingId;

        return (
          <motion.div
            key={conn.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.09, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -2 }}
            className={cn(
              'relative flex flex-col overflow-hidden rounded-xl border border-border-hairline bg-bg-panel transition-colors',
              selectedId === conn.id && 'border-border-glow',
            )}
          >
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color }} aria-hidden />
            <div className="flex items-start gap-3 px-4 pt-4">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: moduleAlpha(color, 0.15), color }}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-text-primary">{conn.name}</div>
                <div className="truncate font-mono text-[11px] text-text-muted">{subtitle(conn)}</div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${conn.name} actions`}
                    className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-border-hairline bg-bg-panel-raised">
                  <DropdownMenuItem onSelect={() => onOpenMapping(conn.id)}>
                    <Waypoints className="size-3.5" /> Open mapping
                  </DropdownMenuItem>
                  {conn.type === 'csv' && (
                    <DropdownMenuItem onSelect={() => onUploadCsv(conn.id)}>
                      <Upload className="size-3.5" /> Upload CSV &amp; preview
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem disabled={!runnable || running} onSelect={() => mapping && onRunNow(mapping.id)}>
                    <Play className="size-3.5" />
                    {runnable ? (running ? 'Running…' : 'Run now') : 'Run now (needs inline CSV data)'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-3 flex items-center gap-2 px-4">
              <StatusDot status={dot} />
              <span className="text-[12.5px] text-text-secondary">
                {conn.status === 'error'
                  ? 'Connection error'
                  : conn.status === 'draft'
                    ? 'Draft — not scheduled'
                    : lastOk
                      ? `Synced ${relTime(lastOk.finishedAt ?? lastOk.startedAt)}`
                      : 'Connected'}
              </span>
            </div>
            {cfg.mode === 'cdc' && (
              <div className="relative mx-4 mt-2 h-px overflow-hidden rounded bg-border-hairline" aria-hidden>
                <motion.span
                  className="absolute inset-y-0 w-1/3 bg-info"
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                />
              </div>
            )}

            <div className="mt-2 px-4 font-mono text-[11px] leading-relaxed text-text-muted">{statsLine(conn, mine)}</div>
            <div className="mt-1 px-4">
              <Sparkline values={sparkValues} color={color} />
            </div>

            <button
              type="button"
              onClick={() => onOpenMapping(conn.id)}
              className="mt-auto flex items-center justify-between border-t border-border-hairline px-4 py-2.5 text-[12.5px] text-text-accent transition-colors hover:bg-bg-panel-raised"
            >
              <span>{mapping ? mapping.name : 'No mapping yet'}</span>
              <span aria-hidden>→</span>
            </button>
          </motion.div>
        );
      })}

      {/* Add connector dashed card */}
      <motion.button
        type="button"
        onClick={onNewConnector}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: connectors.length * 0.09, ease: [0.16, 1, 0.3, 1] }}
        whileHover={{ y: -2 }}
        className="flex min-h-44 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border-glow/70 bg-bg-panel/40 text-text-muted transition-colors hover:border-iris/60 hover:text-text-accent"
      >
        <motion.span
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="flex size-10 items-center justify-center rounded-full border border-border-hairline bg-bg-panel-raised"
        >
          <Plus className="size-[18px]" />
        </motion.span>
        <span className="text-[13px] font-medium">Add connector</span>
        <span className="font-mono text-[10.5px]">csv · sql · rest</span>
      </motion.button>
    </div>
  );
}
