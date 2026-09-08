import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ChevronDown, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { MODULES } from '@/lib/modules';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ModuleCard, ModuleCardSkeleton, type DrawerTab } from '@/components/library/ModuleCard';
import { ModuleDrawer } from '@/components/library/ModuleDrawer';
import { AxiomMap } from '@/components/library/AxiomMap';
import { ImportModal } from '@/components/library/ImportModal';
import { ClassChip } from '@/components/library/chips';
import { ToastHost } from '@/components/library/Toasts';
import { useToasts } from '@/components/library/useToasts';
import { toDate, type LibraryModule } from '@/components/library/lib';

type Filter = 'all' | 'active' | 'available' | 'custom';
type Sort = 'module' | 'recent';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'available', label: 'Available' },
  { id: 'custom', label: 'Custom' },
];

const CUSTOM_COLOR = '#94A3B8';

export default function Library() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('module');
  const [drawer, setDrawer] = useState<{ key: string; tab: DrawerTab } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const { toasts, push } = useToasts();

  const modulesQ = trpc.ontology.listModules.useQuery();
  const mods = useMemo(() => (modulesQ.data ?? []) as LibraryModule[], [modulesQ.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = mods;
    if (filter === 'active') out = out.filter((m) => m.status === 'active');
    if (filter === 'available') out = out.filter((m) => m.status !== 'active');
    if (filter === 'custom') out = [];
    if (q) {
      out = out.filter((m) =>
        [m.name, m.key, m.prefix, m.description ?? ''].join(' ').toLowerCase().includes(q),
      );
    }
    const order = new Map<string, number>(MODULES.map((m, i) => [m.key, i]));
    if (sort === 'module') {
      out = [...out].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
    } else {
      out = [...out].sort(
        (a, b) => (toDate(b.updatedAt)?.getTime() ?? 0) - (toDate(a.updatedAt)?.getTime() ?? 0),
      );
    }
    return out;
  }, [mods, search, filter, sort]);

  const showCustomCard = filter === 'all' || filter === 'custom';
  const openDrawer = (key: string, tab: DrawerTab = 'overview') => setDrawer({ key, tab });

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8 lg:px-8">
      {/* Section 1 — header + toolbar */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
          Module Library
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          Versioned OWL/RDFS modules — the semantic layer of the enterprise. Extend visually in the Studio; never edit
          raw files.
        </p>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 flex flex-wrap items-center gap-2.5"
      >
        {/* search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter classes, properties…"
            className="w-64 rounded-lg border border-border-hairline bg-bg-inset py-2 pl-9 pr-3 font-mono text-[12px] text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-iris"
          />
        </div>

        {/* filter pills */}
        <div className="flex items-center gap-1 rounded-lg border border-border-hairline bg-bg-inset p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
                filter === f.id
                  ? 'bg-bg-panel-raised text-text-accent shadow-sm'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* sort */}
        <div className="relative">
          <select
            aria-label="Sort modules"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="appearance-none rounded-lg border border-border-hairline bg-bg-inset py-2 pl-3 pr-8 text-[12px] text-text-secondary outline-none transition-colors hover:border-border-glow focus:border-iris"
          >
            <option value="module">By module</option>
            <option value="recent">Recently published</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3.5 py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <Upload className="size-3.5" />
            Import ontology
          </button>
          <Link
            to="/app/studio"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3.5 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" />
            New custom module
          </Link>
        </div>
      </motion.div>

      {/* Section 2 — module cards */}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {modulesQ.isLoading ? (
          <>
            <ModuleCardSkeleton />
            <ModuleCardSkeleton />
            <ModuleCardSkeleton />
            <ModuleCardSkeleton />
          </>
        ) : modulesQ.error ? (
          <div className="xl:col-span-2">
            <Empty className="border border-dashed border-border-hairline bg-bg-panel">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RefreshCw className="text-text-muted" />
                </EmptyMedia>
                <EmptyTitle className="text-text-primary">Failed to load modules</EmptyTitle>
                <EmptyDescription className="font-mono text-[12px] text-text-muted">
                  {modulesQ.error.message}
                </EmptyDescription>
              </EmptyHeader>
              <button
                type="button"
                onClick={() => modulesQ.refetch()}
                className="rounded-lg border border-iris/40 bg-iris/15 px-4 py-2 text-[12.5px] font-medium text-text-accent transition-colors hover:bg-iris/25"
              >
                Retry
              </button>
            </Empty>
          </div>
        ) : visible.length === 0 && filter !== 'custom' ? (
          <div className="xl:col-span-2">
            <Empty className="border border-dashed border-border-hairline bg-bg-panel">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search className="text-text-muted" />
                </EmptyMedia>
                <EmptyTitle className="text-text-primary">No modules match</EmptyTitle>
                <EmptyDescription className="text-text-secondary">
                  Try clearing the search or switching the filter.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          visible.map((m, i) => (
            <ModuleCard key={m.key} mod={m} index={i} onOpen={openDrawer} onToast={push} />
          ))
        )}

        {/* 6th custom card — dashed hairline, slate */}
        {showCustomCard && !modulesQ.isLoading && !modulesQ.error && (
          <motion.div
            role="button"
            tabIndex={0}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            whileHover={{ y: -4 }}
            onClick={() =>
              push('Custom extensions are authored visually in Ontology Studio', 'info')
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') push('Custom extensions are authored visually in Ontology Studio', 'info');
            }}
            className="relative cursor-pointer overflow-hidden rounded-2xl border border-dashed border-border-glow bg-bg-panel/50 p-6 text-left transition-colors hover:border-text-muted"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: CUSTOM_COLOR }} />
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-glow bg-bg-inset">
                <img src="/empty-graph.svg" alt="" className="size-7 opacity-70" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">
                    Acme Extensions
                  </h2>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
                    style={{
                      color: CUSTOM_COLOR,
                      backgroundColor: 'rgba(148,163,184,0.15)',
                      border: '1px solid rgba(148,163,184,0.3)',
                    }}
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: CUSTOM_COLOR }} />
                    custom
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-muted">
                  User-defined · extends HR, Logistics
                </p>
              </div>
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed text-text-secondary">
              Workspace-local classes that extend the shipped modules without forking them.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <ClassChip iri="custom:Contractor" color={CUSTOM_COLOR} definition="Extends hr:Person for agency staff." />
              <ClassChip iri="custom:RegionalHub" color={CUSTOM_COLOR} definition="Extends log:Warehouse for regional distribution hubs." />
            </div>
            <div className="mt-5 border-t border-dashed border-border-hairline pt-4">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-text-muted">
                <Plus className="size-3.5" /> click to extend in Studio
              </span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Section 4 — cross-module axiom map */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mt-8"
      >
        <AxiomMap />
      </motion.div>

      {/* Section 3 — detail drawer */}
      <ModuleDrawer
        moduleKey={drawer?.key ?? null}
        initialTab={drawer?.tab ?? 'overview'}
        onClose={() => setDrawer(null)}
        onToast={push}
      />

      {/* Section 5 — import modal */}
      <ImportModal open={importOpen} modules={mods} onClose={() => setImportOpen(false)} onToast={push} />

      <ToastHost toasts={toasts} />
    </div>
  );
}
