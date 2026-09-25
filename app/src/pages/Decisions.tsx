import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, FileDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ADRS, ARCH_SECTIONS, type AdrStatus } from '@/components/decisions/adr-data';
import { StatusChip } from '@/components/decisions/StatusChip';
import { TocRail } from '@/components/decisions/TocRail';
import { AdrIndex } from '@/components/decisions/AdrIndex';
import { AdrBlock } from '@/components/decisions/AdrBlock';
import { C4ContextDiagram } from '@/components/decisions/C4ContextDiagram';
import { C4ContainerDiagram } from '@/components/decisions/C4ContainerDiagram';
import { DataFlowPipeline } from '@/components/decisions/DataFlowPipeline';
import { ScaleOps } from '@/components/decisions/ScaleOps';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type StatusFilter = 'all' | AdrStatus;
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'proposed', label: 'Proposed' },
  { key: 'superseded', label: 'Superseded' },
];

/** Scroll-spy over all section ids (ADR blocks + arch sections). */
function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

/** Generates a minimal, truthful OpenAPI-flavored spec of the tRPC surface. */
function downloadSpec() {
  const spec = [
    '# Ontos API surface (evaluation build)',
    '# Transport: tRPC v11 over HTTP batch at /api/trpc (superjson).',
    '# This file enumerates the typed procedures; see api/router.ts for source of truth.',
    'openapi: 3.0.3',
    'info: { title: Ontos tRPC surface, version: "0.1.0-demo" }',
    'paths:',
    ...[
      'auth.me', 'auth.logout',
      'ontology.listModules', 'ontology.getModule', 'ontology.listClasses', 'ontology.listProperties',
      'ontology.listVersions', 'ontology.createClass', 'ontology.deprecateClass', 'ontology.diffVersions',
      'ontology.exportModule', 'ontology.runReasoner',
      'graph.stats', 'graph.searchNodes', 'graph.getSubgraph', 'graph.getNode',
      'mapping.listConnectors', 'mapping.listMappings', 'mapping.runSync', 'mapping.runAllSyncs', 'mapping.listSyncJobs',
      'operations.summary', 'operations.listJobs', 'operations.getJob', 'operations.listWorkers',
      'operations.retryJob', 'operations.cancelJob',
      'insights.list', 'insights.acknowledge', 'insights.runScan', 'insights.narrative',
      'nlq.translate', 'nlq.suggestions', 'nlq.execute',
      'admin.getWorkspace', 'admin.listMembers', 'admin.listAudit', 'admin.getProviders',
      'dashboard.overview', 'dashboard.moduleHealth', 'dashboard.recentActivity', 'dashboard.insightPreview',
    ].map((p) => `  /api/trpc/${p}: { post: { summary: "tRPC procedure ${p}" } }`),
  ].join('\n');
  const blob = new Blob([spec], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'openapi.yaml';
  a.click();
  URL.revokeObjectURL(url);
}

const counts = {
  accepted: ADRS.filter((a) => a.status === 'accepted').length,
  proposed: ADRS.filter((a) => a.status === 'proposed').length,
  superseded: ADRS.filter((a) => a.status === 'superseded').length,
};

/**
 * Decisions & Architecture — /app/decisions (design: decisions.md).
 * Documentation page: sticky TOC rail + max-880px content column.
 */
export default function Decisions() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const visibleAdrs = useMemo(() => ADRS.filter((a) => filter === 'all' || a.status === filter), [filter]);
  const spyIds = useMemo(
    () => [...ADRS.map((a) => a.id.toLowerCase()), ...ARCH_SECTIONS.map((s) => s.id)],
    [],
  );
  const activeId = useScrollSpy(spyIds);

  return (
    <div className="mx-auto max-w-[1240px]">
      {/* §1 — header */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="max-w-[880px]"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-iris-bright">Engineering Record</p>
        <h1 className="mt-2 font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
          Decisions &amp; Architecture
        </h1>
        <p className="mt-3 max-w-[720px] text-[15px] leading-[1.6] text-text-secondary">
          Every consequential choice in Ontos, written down with its alternatives, trade-offs, and current status.
          ADRs are immutable once accepted — superseded, never edited.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <span className="font-mono text-[12px] text-text-muted">
            {ADRS.length} ADRs · {counts.accepted} accepted · {counts.superseded} superseded · {counts.proposed} proposed
            · last updated 2025-10-02
          </span>
          <span className="flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11.5px] transition-colors duration-150',
                  filter === f.key
                    ? 'bg-iris/15 text-text-accent ring-1 ring-iris/40'
                    : 'text-text-muted hover:bg-bg-panel-raised hover:text-text-secondary',
                )}
              >
                {f.label}
              </button>
            ))}
          </span>
        </div>
      </motion.header>

      <div className="mt-8 flex gap-10">
        <TocRail activeId={activeId} />

        <div className="min-w-0 max-w-[880px] flex-1 space-y-6">
          {/* §3 — index cards */}
          <AdrIndex adrs={visibleAdrs} />

          {/* §4 — ADR entries */}
          {visibleAdrs.map((a) => (
            <AdrBlock key={a.id} adr={a} />
          ))}
          {visibleAdrs.length === 0 && (
            <p className="rounded-xl border border-border-hairline bg-bg-panel p-6 text-[13px] text-text-muted">
              No ADRs with this status.
            </p>
          )}

          {/* §5 — architecture diagrams */}
          <motion.section
            id="arch-context"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="scroll-mt-24 rounded-2xl border border-border-hairline bg-bg-panel p-6 lg:p-8"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">System context</h2>
              <StatusChip status="accepted" />
            </div>
            <C4ContextDiagram />
            <p className="mt-4 font-mono text-[11px] text-text-muted">C4 Level 1 — System context</p>
            <p className="mt-3 text-[14px] leading-relaxed text-text-secondary">
              Acme users work in the Ontos web app. Ontos continuously materializes a provenance-tracked knowledge graph
              from the{' '}
              <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-module-hr">HRIS</code>, the{' '}
              <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-module-legal">Contracts DB</code>, and the{' '}
              <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-module-finance">ERP</code>; sign-in flows through the corporate{' '}
              <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-text-accent">OIDC provider</code>, and narrative features call out to{' '}
              <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[12px] text-text-accent">LLM providers</code> per tenant policy.
            </p>
          </motion.section>

          <motion.section
            id="arch-containers"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="scroll-mt-24 rounded-2xl border border-border-hairline bg-bg-panel p-6 lg:p-8"
          >
            <h2 className="mb-4 font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">Containers</h2>
            <C4ContainerDiagram />
            <p className="mt-4 font-mono text-[11px] text-text-muted">
              C4 Level 2 — Containers · reflects this build (ADR-002): tRPC/Drizzle/Hono on MySQL-TiDB, not the
              FastAPI/Neo4j reference layout.
            </p>
          </motion.section>

          <motion.section
            id="arch-dataflow"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="scroll-mt-24 rounded-2xl border border-border-hairline bg-bg-panel p-6 lg:p-8"
          >
            <h2 className="mb-2 font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">Data flow</h2>
            <p className="mb-4 text-[13px] text-text-secondary">
              Every record travels one path: source → mapping → materialized graph with provenance → validation →
              immutable snapshot → read-only consumption. Hover a stage to see the ADR that governs it.
            </p>
            <DataFlowPipeline />
          </motion.section>

          <motion.section
            id="arch-scale"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="scroll-mt-24"
          >
            <h2 className="mb-4 font-display text-[24px] font-semibold tracking-[-0.015em] text-text-primary">
              Scale &amp; ops
            </h2>
            <ScaleOps />
          </motion.section>

          {/* §6 — footer strip */}
          <footer className="border-t border-border-hairline pb-4 pt-6 text-center">
            <p className="font-mono text-[11.5px] leading-6 text-text-muted">
              These documents ship with the repo: <span className="text-text-secondary">/docs/adr</span>,{' '}
              <span className="text-text-secondary">/docs/architecture</span>,{' '}
              <span className="text-text-secondary">/openapi.yaml</span> — this page renders them live.
            </p>
            <div className="mt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={downloadSpec}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
              >
                <FileDown className="size-3.5" />
                Download OpenAPI spec
              </button>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center gap-1 text-[13px] text-text-accent transition-colors hover:text-iris-bright"
              >
                <ArrowUp className="size-3.5" />
                Back to top
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
