import { motion } from 'framer-motion';
import { StatusChip } from './StatusChip';
import type { Adr } from './adr-data';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** §3 — horizontal scroll row of compact ADR cards; click smooth-scrolls. */
export function AdrIndex({ adrs }: { adrs: Adr[] }) {
  const scrollTo = (id: string) =>
    document.getElementById(id.toLowerCase())?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
      {adrs.map((a, i) => (
        <motion.button
          key={a.id}
          type="button"
          layout="position"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.07, ease: EASE }}
          whileHover={{ y: -2 }}
          onClick={() => scrollTo(a.id)}
          className="group w-[240px] shrink-0 rounded-xl border border-border-hairline bg-bg-panel p-4 text-left transition-colors duration-150 hover:border-border-glow"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-medium text-iris-bright">{a.id}</span>
            <StatusChip status={a.status} className="transition-shadow group-hover:shadow-[0_0_12px_-2px_currentColor]" />
          </div>
          <p className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-5 text-text-primary">{a.shortTitle}</p>
          <p className="mt-1 font-mono text-[10.5px] text-text-muted">{a.date}</p>
        </motion.button>
      ))}
    </div>
  );
}
