import { memo } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { IRIChip } from '@/components/ui/iri-chip';
import { StatusDot } from '@/components/ui/status-dot';
import { DisclosureChip } from './DisclosureChip';
import { LiveValue } from './LiveValue';
import { Sparkline } from './Sparkline';
import {
  classMeta,
  fmtNum,
  fmtTime,
  statusKind,
  unitFor,
  type TwinSummary,
} from './meta';

export interface TwinCardProps {
  twin: TwinSummary;
  tickId: number;
  /** telemetry keys that changed on the last tick (flash targets) */
  changedKeys: Set<string>;
  onSelect: (iri: string) => void;
}

/** Card sparkline — own history query (batched via httpBatchLink). */
function CardSparkline({ iri, primaryKey }: { iri: string; primaryKey?: string }) {
  const q = trpc.twin.getStateHistory.useQuery(
    { iri, key: primaryKey ?? 'utilization', points: 24 },
    { enabled: !!primaryKey, staleTime: Infinity, refetchOnWindowFocus: false },
  );
  const points = (q.data?.points ?? [])
    .map((p) => p.valueNum)
    .filter((v): v is number => typeof v === 'number');
  return <Sparkline points={points} height={40} className="w-24 shrink-0" />;
}

/**
 * TwinCard — registry card: status dot + label + model glyph, IRI + mirrors
 * line, 2–3 live values, footer with last-tick + sparkline.
 */
export const TwinCard = memo(function TwinCard({
  twin,
  tickId,
  changedKeys,
  onSelect,
}: TwinCardProps) {
  const meta = classMeta(twin.classIri);
  const Icon = meta.icon;
  const state = twin.state;
  const values = meta.cardKeys
    .filter((k) => typeof state[k] === 'number')
    .slice(0, 3);

  return (
    <motion.div
      role="button"
      tabIndex={0}
      layout="position"
      onClick={() => onSelect(twin.iri)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(twin.iri);
        }
      }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2.5 rounded-xl border border-border-hairline bg-bg-panel p-4 pt-3.5 text-left',
        'transition-colors duration-150 hover:border-border-glow hover:bg-bg-panel-raised/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-module-twin/40',
        'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:rounded-t-xl before:bg-module-twin/60',
        'hover:before:bg-module-twin hover:before:shadow-[0_0_8px_#2DD4BF66]',
      )}
    >
      {/* Row 1 — status + label + disclosure + glyph */}
      <span className="flex items-center gap-2">
        <StatusDot status={statusKind(state.status)} pulse={statusKind(state.status) === 'ok'} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-primary">
          {twin.label}
        </span>
        <DisclosureChip variant="simulated" iconOnly />
        <Icon className="size-4 shrink-0 text-module-twin" aria-hidden />
      </span>

      {/* Row 2 — IRI + mirrors */}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span onClick={(e) => e.stopPropagation()}>
          <IRIChip iri={twin.iri} />
        </span>
        {state.mirroredIri && (
          <span className="truncate font-mono text-[10.5px] text-text-muted">
            mirrors <span className="text-module-logistics">{state.mirroredIri.split(':')[0]}:</span>
            <span className="text-text-secondary">{state.mirroredIri.split(':').slice(1).join(':')}</span>
          </span>
        )}
      </span>

      {/* Row 3 — live state summary */}
      {values.length > 0 && (
        <span className="flex items-start gap-4">
          {values.map((k) => (
            <LiveValue
              key={k}
              label={k === 'etaMinutes' ? 'ETA' : k === 'batteryLevel' ? 'batt' : k === 'utilization' ? 'util' : k === 'temperature' ? 'temp' : k}
              value={fmtNum(k, state[k] as number)}
              unit={unitFor(k)}
              tickId={tickId}
              changed={changedKeys.has(k)}
            />
          ))}
          {twin.contains && (twin.contains.zones > 0 || twin.contains.equipment > 0) && (
            <span className="ml-auto flex flex-col gap-0.5 text-right">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">contains</span>
              <span className="font-mono text-[11.5px] tabular-nums text-text-secondary">
                {twin.contains.zones > 0 && `${twin.contains.zones} zn`}
                {twin.contains.zones > 0 && twin.contains.equipment > 0 && ' · '}
                {twin.contains.equipment > 0 && `${twin.contains.equipment} eq`}
              </span>
            </span>
          )}
        </span>
      )}

      {/* Row 4 — footer */}
      <span className="mt-auto flex items-end justify-between gap-2 border-t border-border-hairline pt-2.5">
        <span className="font-mono text-[10px] tabular-nums text-text-muted">
          {state.lastTickAt ? `last tick ${fmtTime(state.lastTickAt)}` : 'no tick yet'}
        </span>
        <span className="flex items-center gap-1">
          {meta.primaryKey && <CardSparkline iri={twin.iri} primaryKey={meta.primaryKey} />}
          <ChevronRight className="size-4 shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-module-twin" />
        </span>
      </span>
    </motion.div>
  );
});
