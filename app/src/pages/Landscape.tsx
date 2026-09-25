import { motion } from 'framer-motion';
import { Info, MapIcon } from 'lucide-react';
import {
  LANDSCAPE_AS_OF,
  STATUS_LABEL,
  capabilities,
  links,
  roadmap,
  services,
} from '@/lib/landscape';
import { ArchitectureDiagram } from '@/components/landscape/ArchitectureDiagram';
import { Roadmap } from '@/components/landscape/Roadmap';
import { CapabilityTable } from '@/components/landscape/CapabilityTable';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function SectionHead({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div className="mb-5">
      <h2 id={id} className="scroll-mt-20 font-display text-[22px] font-semibold text-text-primary">
        {title}
      </h2>
      <p className="mt-1 max-w-[680px] text-[13.5px] text-text-muted">{sub}</p>
    </div>
  );
}

/**
 * Landscape — /app/landscape. Where Ontos stands next to Palantir Foundry's
 * Ontology and where its architecture is going. Every row, service and step is
 * read from lib/landscape.ts, the same source as the README summary.
 */
export default function Landscape() {
  const shipped = roadmap.filter((r) => r.status === 'shipped');
  const latestShipped = shipped.length ? Math.max(...shipped.map((r) => r.increment)) : null;

  return (
    <div className="mx-auto w-full max-w-[1240px] space-y-12">
      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="max-w-[880px]"
      >
        <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">
          <MapIcon className="size-3.5" />
          Positioning
        </p>
        <h1 className="mt-2 font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
          Landscape
        </h1>
        <p className="mt-3 max-w-[720px] text-[15px] leading-[1.6] text-text-secondary">
          Where Ontos stands against Palantir Foundry’s Ontology, capability by capability, and how its own
          architecture is changing one increment at a time.
        </p>
        <p className="mt-3 font-mono text-[12px] text-text-muted">
          as of <span className="text-text-secondary">{LANDSCAPE_AS_OF}</span> · {services.length} services ·{' '}
          {capabilities.length} capability areas
          {latestShipped != null && <> · increment {latestShipped} shipped</>}
        </p>
        <div className="mt-4 flex max-w-[720px] items-start gap-2.5 rounded-lg border border-border-hairline bg-bg-inset px-3.5 py-2.5">
          <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
          <p className="text-[12.5px] leading-[1.55] text-text-secondary">
            The Palantir Foundry column summarises Foundry’s public documentation. It is a reading of that
            documentation, not a benchmark.
          </p>
        </div>
      </motion.header>

      {/* ── Architecture ── */}
      <section aria-labelledby="architecture">
        <SectionHead
          id="architecture"
          title="Architecture"
          sub="The processes, engines and stores Ontos runs as today, and what talks to what. Hover or select a service for what it runs as and what it is responsible for."
        />
        <div className="rounded-xl border border-border-hairline bg-bg-panel p-4 sm:p-5">
          <ArchitectureDiagram services={services} links={links} />
        </div>
      </section>

      {/* ── Roadmap ── */}
      <section aria-labelledby="roadmap">
        <SectionHead
          id="roadmap"
          title="Roadmap"
          sub="Where the architecture goes next, one increment at a time, with the services each adds and the gaps it is meant to close."
        />
        <Roadmap entries={roadmap} services={services} capabilities={capabilities} />
      </section>

      {/* ── Capabilities ── */}
      <section aria-labelledby="capabilities">
        <SectionHead
          id="capabilities"
          title="Capabilities"
          sub="Area by area: what Foundry’s Ontology offers, what Ontos does today, and how the two compare."
        />
        <CapabilityTable capabilities={capabilities} labels={STATUS_LABEL} />
      </section>
    </div>
  );
}
