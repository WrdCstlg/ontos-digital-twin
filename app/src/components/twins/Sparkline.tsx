import { memo } from 'react';
import { cn } from '@/lib/utils';
import { TWIN_COLOR } from './meta';

export interface SparklineProps {
  points: number[];
  color?: string;
  className?: string;
  /** viewBox height (px); width is always 120 units */
  height?: number;
}

/**
 * Sparkline — lightweight SVG area/line sparkline, module-colored (teal for
 * twins), no axes, gradient fill at 12% alpha, 600ms stroke draw-in on mount.
 * Raw SVG (not Recharts) so 100+ registry cards stay cheap.
 */
export const Sparkline = memo(function Sparkline({
  points,
  color = TWIN_COLOR,
  className,
  height = 48,
}: SparklineProps) {
  if (points.length < 2) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ height }}>
        <span className="font-mono text-[9px] text-text-muted">no history</span>
      </div>
    );
  }
  const w = 120;
  const h = 48;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map(
    (p, i) => `${(i * step).toFixed(1)},${(h - 4 - ((p - min) / range) * (h - 10)).toFixed(1)}`,
  );
  const line = coords.join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const gid = `twinspark-${color.replace('#', '')}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      style={{ height, width: '100%' }}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.12" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: 'twin-spark-draw 0.6s ease-out forwards' }}
      />
      {/* live right-edge point */}
      <circle
        cx={coords[coords.length - 1]!.split(',')[0]}
        cy={coords[coords.length - 1]!.split(',')[1]}
        r="2"
        fill={color}
      />
      <style>{`@keyframes twin-spark-draw { to { stroke-dashoffset: 0; } }`}</style>
    </svg>
  );
});
