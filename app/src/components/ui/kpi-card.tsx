import type { HTMLAttributes, ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getModule, moduleAlpha, type ModuleKey } from '@/lib/modules';

export interface KpiCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Caption label, rendered uppercase */
  label: string;
  /** Primary value — rendered 28px mono */
  value: string;
  /** Delta text, e.g. "+12 this week" */
  delta?: string;
  /** Delta direction; up = green, down = red */
  deltaDir?: 'up' | 'down';
  /** Optional module to tint the sparkline + label */
  module?: ModuleKey;
  /** Sparkline values (rendered as a 40px area sparkline, no axes) */
  spark?: number[];
  /** Extra content (e.g. custom footer) */
  children?: ReactNode;
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const w = 120;
  const h = 40;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(h - 3 - ((p - min) / range) * (h - 8)).toFixed(1)}`);
  const line = coords.join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const gid = `spark-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * KpiCard — panel with caption label, 28px mono value, delta chip and a
 * 40px module-colored sparkline (no axes).
 */
export function KpiCard({
  label,
  value,
  delta,
  deltaDir = 'up',
  module,
  spark,
  className,
  children,
  ...props
}: KpiCardProps) {
  const color = module ? getModule(module).color : '#818CF8';
  return (
    <div
      className={cn(
        'rounded-xl border border-border-hairline bg-bg-panel p-5',
        'transition-all duration-200 hover:border-border-glow hover:bg-bg-panel-raised/60',
        className,
      )}
      style={module ? { boxShadow: `inset 0 1px 0 0 ${moduleAlpha(color, 0.25)}` } : undefined}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</span>
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10.5px] font-medium',
              deltaDir === 'up' ? 'bg-ok/15 text-ok' : 'bg-risk/15 text-risk',
            )}
          >
            {deltaDir === 'up' ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {delta}
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-[28px] font-medium leading-none tabular-nums text-text-primary">{value}</div>
      {spark && spark.length > 1 && (
        <div className="mt-3 -mb-1">
          <Sparkline points={spark} color={color} />
        </div>
      )}
      {children}
    </div>
  );
}
