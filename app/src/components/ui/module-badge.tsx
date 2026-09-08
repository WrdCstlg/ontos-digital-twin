import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { getModule, moduleAlpha, type ModuleKey } from '@/lib/modules';

export interface ModuleBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  module: ModuleKey;
  /** Longer label (module name) instead of the short mono tag */
  long?: boolean;
}

/**
 * ModuleBadge — pill with 8px colored dot + mono label, 15% alpha tinted
 * background, 30% alpha border. The module color system's atomic unit.
 */
export function ModuleBadge({ module, long = false, className, ...props }: ModuleBadgeProps) {
  const m = getModule(module);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
        'font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]',
        className,
      )}
      style={{
        color: m.color,
        backgroundColor: moduleAlpha(m.color, 0.15),
        border: `1px solid ${moduleAlpha(m.color, 0.3)}`,
      }}
      {...props}
    >
      <span className="size-2 rounded-full" style={{ backgroundColor: m.color }} aria-hidden />
      {long ? m.name : m.label}
    </span>
  );
}
