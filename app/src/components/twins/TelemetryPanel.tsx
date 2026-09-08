import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { trpc } from '@/providers/trpc';
import { Skeleton } from '@/components/ui/skeleton';
import { DisclosureChip } from './DisclosureChip';
import { LiveValue } from './LiveValue';
import { TWIN_COLOR, fmtNum, fmtTime, labelFor, thresholdFor, unitFor, type TwinStateShape } from './meta';

const SLATE = '#94A3B8';
const AMBER = '#FBBF24';

export interface TelemetryPanelProps {
  iri: string;
  classIri: string;
  state: TwinStateShape;
  /** telemetry key this panel charts */
  tkey: string;
  /** optional second series (e.g. humidity beside temperature) */
  secondaryKey?: string;
  title: string;
  tickId: number;
  changedKeys: Set<string>;
}

interface Point {
  t: string;
  v: number;
  v2?: number;
}

/**
 * TelemetryPanel — live Recharts chart fed by twin.getStateHistory with a
 * LiveValues row below. Amber dashed rule-line + warn chip on threshold
 * breach (warehouse utilization > 90%, cold-chain tempTargetMax).
 */
export function TelemetryPanel({
  iri,
  classIri,
  state,
  tkey,
  secondaryKey,
  title,
  tickId,
  changedKeys,
}: TelemetryPanelProps) {
  const q = trpc.twin.getStateHistory.useQuery(
    { iri, key: tkey, points: 60 },
    { staleTime: Infinity, refetchOnWindowFocus: false },
  );
  const q2 = trpc.twin.getStateHistory.useQuery(
    { iri, key: secondaryKey ?? '', points: 60 },
    { enabled: !!secondaryKey, staleTime: Infinity, refetchOnWindowFocus: false },
  );

  const data = useMemo<Point[]>(() => {
    const main = (q.data?.points ?? [])
      .filter((p) => typeof p.valueNum === 'number')
      .map((p) => ({ t: fmtTime(p.recordedAt), v: p.valueNum as number }));
    if (!secondaryKey || !q2.data) return main;
    const second = (q2.data.points ?? []).filter((p) => typeof p.valueNum === 'number');
    return main.map((p, i) => ({ ...p, v2: second[i]?.valueNum ?? undefined }));
  }, [q.data, secondaryKey, q2.data]);

  const threshold = thresholdFor(classIri, tkey, state);
  const current = typeof state[tkey] === 'number' ? (state[tkey] as number) : null;
  const breach = threshold != null && current != null && current > threshold;
  const secondary = secondaryKey && typeof state[secondaryKey] === 'number' ? (state[secondaryKey] as number) : null;

  // delta since previous tick for the primary key
  const delta = useMemo(() => {
    if (data.length < 2) return null;
    const d = data[data.length - 1]!.v - data[data.length - 2]!.v;
    return Math.round(d * 10) / 10;
  }, [data]);

  const loading = q.isLoading || (secondaryKey ? q2.isLoading : false);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-border-hairline bg-bg-panel"
    >
      <header className="flex items-center gap-2 border-b border-border-hairline px-3.5 py-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-text-muted">{title}</span>
        <AnimatePresence>
          {breach && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="rounded-full border border-warn/40 bg-warn/15 px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-warn"
            >
              above threshold
            </motion.span>
          )}
        </AnimatePresence>
        <span className="ml-auto font-mono text-[9.5px] tabular-nums text-text-muted">
          tick #{tickId.toLocaleString('en-US')}
        </span>
        <DisclosureChip variant="simulated" iconOnly />
      </header>

      <div className="h-28 px-2 pt-2">
        {loading ? (
          <Skeleton className="h-full w-full bg-bg-inset" />
        ) : data.length < 2 ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-text-muted">
            no recorded history for {tkey} yet — press Tick
          </div>
        ) : secondaryKey ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#1E293B" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fill: '#64748B', fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={44} />
              <RTooltip
                contentStyle={{ background: '#16202F', border: '1px solid #1E293B', borderRadius: 8, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
                labelStyle={{ color: '#64748B' }}
              />
              {threshold != null && (
                <ReferenceLine y={threshold} stroke={AMBER} strokeDasharray="4 4" strokeOpacity={0.8} />
              )}
              <Line type="monotone" dataKey="v" name={labelFor(tkey)} stroke={TWIN_COLOR} strokeWidth={1.5} dot={false} isAnimationActive animationDuration={300} />
              <Line type="monotone" dataKey="v2" name={labelFor(secondaryKey)} stroke={SLATE} strokeWidth={1.5} dot={false} isAnimationActive animationDuration={300} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id={`tg-${tkey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={breach ? AMBER : TWIN_COLOR} stopOpacity={0.18} />
                  <stop offset="1" stopColor={breach ? AMBER : TWIN_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1E293B" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fill: '#64748B', fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
              <RTooltip
                contentStyle={{ background: '#16202F', border: '1px solid #1E293B', borderRadius: 8, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
                labelStyle={{ color: '#64748B' }}
              />
              {threshold != null && (
                <ReferenceLine y={threshold} stroke={AMBER} strokeDasharray="4 4" strokeOpacity={0.8} />
              )}
              <Area
                type="monotone"
                dataKey="v"
                name={labelFor(tkey)}
                stroke={TWIN_COLOR}
                strokeWidth={1.5}
                fill={`url(#tg-${tkey})`}
                isAnimationActive
                animationDuration={300}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* LiveValues row */}
      <div className="flex items-center gap-5 px-3.5 pb-3 pt-1.5">
        {current != null && (
          <LiveValue
            label={labelFor(tkey)}
            value={fmtNum(tkey, current)}
            unit={unitFor(tkey)}
            tickId={tickId}
            changed={changedKeys.has(tkey)}
            size="md"
          />
        )}
        {secondary != null && secondaryKey && (
          <LiveValue
            label={labelFor(secondaryKey)}
            value={fmtNum(secondaryKey, secondary)}
            unit={unitFor(secondaryKey)}
            tickId={tickId}
            changed={changedKeys.has(secondaryKey)}
            size="md"
          />
        )}
        {delta != null && (
          <span className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">Δ / tick</span>
            <span className="font-mono text-[13px] tabular-nums text-text-secondary">
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
          </span>
        )}
        {threshold != null && (
          <span className="ml-auto flex flex-col gap-0.5 text-right">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">threshold</span>
            <span className="font-mono text-[11.5px] tabular-nums text-warn">
              {threshold}
              {unitFor(tkey)}
            </span>
          </span>
        )}
      </div>
    </motion.section>
  );
}
