import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ADRS, ARCH_SECTIONS } from './adr-data';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface TocRailProps {
  activeId: string | null;
}

/** §2 — sticky in-page TOC rail with scroll-spy indicator (layoutId slide). */
export function TocRail({ activeId }: TocRailProps) {
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const item = (id: string, label: string, prefix?: string) => {
    const active = activeId === id;
    return (
      <li key={id} className="relative">
        {active && (
          <motion.span
            layoutId="toc-indicator"
            transition={{ duration: 0.2, ease: EASE }}
            className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-iris"
            aria-hidden
          />
        )}
        <a
          href={`#${id}`}
          onClick={jump(id)}
          className={cn(
            'block truncate py-1 pl-3 font-mono text-[11.5px] transition-colors duration-150',
            active ? 'text-text-accent' : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {prefix && <span className="text-text-muted">{prefix} </span>}
          {label}
        </a>
      </li>
    );
  };

  return (
    <motion.nav
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.35, ease: EASE }}
      aria-label="On this page"
      className="sticky top-20 hidden w-[220px] shrink-0 self-start lg:block"
    >
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">On this page</p>
      <ul className="space-y-0.5 border-l border-border-hairline -ml-px pl-0">
        {ADRS.map((a) => item(a.id.toLowerCase(), a.shortTitle, a.id))}
      </ul>
      <div className="my-3 border-t border-border-hairline" />
      <ul className="space-y-0.5 border-l border-border-hairline -ml-px pl-0">
        {ARCH_SECTIONS.map((s) => item(s.id, s.label))}
      </ul>
    </motion.nav>
  );
}
