import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Boxes, ChevronDown, Download, PencilRuler } from 'lucide-react';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { MODULES } from '@/lib/modules';
import { StatusDot } from '@/components/ui/status-dot';
import { ClassChip } from './chips';
import { alpha, downloadExport, EXPORT_FORMATS, fmtDate, type LibraryModule } from './lib';

export type DrawerTab = 'overview' | 'classes' | 'properties' | 'constraints' | 'versions' | 'docs';

const CHIP_COLLAPSED = 8;

function glyphFor(key: string): string {
  return MODULES.find((m) => m.key === key)?.glyph ?? '/empty-graph.svg';
}

export function ModuleCard({
  mod,
  index,
  onOpen,
  onToast,
}: {
  mod: LibraryModule;
  index: number;
  onOpen: (moduleKey: string, tab?: DrawerTab) => void;
  onToast: (msg: string, kind?: 'ok' | 'info') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const classesQ = trpc.ontology.listClasses.useQuery({ moduleKey: mod.key });
  const versionsQ = trpc.ontology.listVersions.useQuery({ moduleKey: mod.key });
  const utils = trpc.useUtils();

  const classes = classesQ.data ?? [];
  const versions = versionsQ.data ?? [];
  const shapeCount = classes.filter((c) => c.shaclJson != null).length;
  const publishedAt = versions[0]?.publishedAt ?? mod.updatedAt;
  const shown = expanded ? classes : classes.slice(0, CHIP_COLLAPSED);
  const active = mod.status === 'active';

  const doExport = async (formatId: (typeof EXPORT_FORMATS)[number]['id']) => {
    const meta = EXPORT_FORMATS.find((f) => f.id === formatId)!;
    setExportOpen(false);
    setExporting(formatId);
    try {
      const res = await utils.ontology.exportModule.fetch({ moduleKey: mod.key, format: formatId });
      const size = downloadExport(`${mod.key}-v${res.version}.${meta.ext}`, res.content, meta.mime);
      onToast(`Exported ${mod.key}-v${res.version}.${meta.ext} (${meta.label}, ${size})`, 'ok');
    } catch (e) {
      onToast(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'info');
    } finally {
      setExporting(null);
    }
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: (index % 2) * 0.1 }}
      whileHover={{ y: -4 }}
      onClick={() => onOpen(mod.key)}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-2xl border border-border-hairline bg-bg-panel p-6',
        'transition-colors duration-200 hover:border-border-glow',
      )}
      aria-label={`${mod.name} module`}
    >
      {/* top 3px module bar */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] transition-[box-shadow] duration-300"
        style={{ backgroundColor: mod.color }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-0 blur-[6px] transition-opacity duration-300 group-hover:opacity-100"
        style={{ backgroundColor: mod.color }}
      />

      {/* Row 1: glyph + name + badges + status */}
      <div className="flex items-start gap-4">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border-hairline bg-bg-inset transition-all duration-500 group-hover:scale-105"
          style={{ boxShadow: `0 0 0 0 transparent` }}
        >
          <img
            src={glyphFor(mod.key)}
            alt=""
            className="size-9 transition-[filter,transform] duration-500 group-hover:scale-110"
            style={{ filter: `drop-shadow(0 0 0 transparent)` }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = `drop-shadow(0 0 6px ${alpha(mod.color, 0.8)})`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'none';
            }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-text-primary">{mod.name}</h2>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em]"
              style={{
                color: mod.color,
                backgroundColor: alpha(mod.color, 0.15),
                border: `1px solid ${alpha(mod.color, 0.3)}`,
              }}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: mod.color }} aria-hidden />
              {mod.key}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-text-muted">
            {mod.name} module · v{mod.version}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1',
            'font-mono text-[10px] font-medium uppercase tracking-[0.08em]',
            active ? 'border-ok/30 bg-ok/10 text-ok' : 'border-border-glow bg-bg-panel-raised text-text-muted',
          )}
        >
          {active ? <StatusDot status="ok" /> : <StatusDot status="idle" pulse={false} />}
          {active ? 'Active' : 'Available'}
        </span>
      </div>

      {/* Row 2: description + mono metadata */}
      <p className="mt-4 text-[13.5px] leading-relaxed text-text-secondary">{mod.description}</p>
      <p className="mt-2.5 font-mono text-[11.5px] text-text-muted">
        v{mod.version} · OWL 2 DL · {mod.classCount} classes · {mod.propertyCount} properties · {shapeCount} SHACL
        shapes · published {fmtDate(publishedAt)}
      </p>

      {/* Row 3: class chip cloud */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {classesQ.isLoading ? (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="h-6 w-20 animate-pulse rounded-md border border-border-hairline bg-bg-inset" />
            ))}
          </>
        ) : classes.length === 0 ? (
          <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-muted">
            <Boxes className="size-3.5" /> No classes defined
          </span>
        ) : (
          <>
            {shown.map((c) => (
              <ClassChip key={c.id} iri={c.iri} color={mod.color} definition={c.definition} deprecated={c.deprecated} />
            ))}
            {classes.length > CHIP_COLLAPSED && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((x) => !x);
                }}
                className="rounded-md border border-dashed border-border-glow px-2 py-0.5 font-mono text-[11.5px] text-text-muted transition-colors hover:border-iris hover:text-text-accent"
              >
                {expanded ? 'show less' : `+${classes.length - CHIP_COLLAPSED} more`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Row 4: footer */}
      <div
        className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-hairline pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* version selector */}
        <div className="relative">
          <select
            aria-label="Select version"
            value={mod.version}
            onChange={() => onOpen(mod.key, 'versions')}
            className="appearance-none rounded-lg border border-border-hairline bg-bg-inset py-1.5 pl-3 pr-8 font-mono text-[11.5px] text-text-secondary outline-none transition-colors hover:border-border-glow focus:border-iris"
          >
            {versions.length === 0 ? (
              <option value={mod.version}>v{mod.version}</option>
            ) : (
              versions.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version}
                </option>
              ))
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to={`/app/studio?module=${mod.key}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors"
            style={{ color: mod.color, backgroundColor: alpha(mod.color, 0.1), border: `1px solid ${alpha(mod.color, 0.25)}` }}
          >
            <PencilRuler className="size-3.5" />
            Open in Studio
          </Link>
          <button
            type="button"
            onClick={() => onOpen(mod.key, 'docs')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[12.5px] font-medium text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <BookOpen className="size-3.5" />
            Docs
          </button>
          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              onClick={() => setExportOpen((o) => !o)}
              disabled={exporting != null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[12.5px] font-medium text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
            >
              <Download className="size-3.5" />
              {exporting ? 'Exporting…' : 'Export'}
              <ChevronDown className={cn('size-3 transition-transform', exportOpen && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {exportOpen && (
                <>
                  <button
                    aria-hidden
                    tabIndex={-1}
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setExportOpen(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full right-0 z-50 mb-2 w-52 overflow-hidden rounded-xl border border-border-hairline bg-bg-panel-raised shadow-2xl"
                  >
                    {EXPORT_FORMATS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => doExport(f.id)}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-bg-panel hover:text-text-primary"
                      >
                        {f.label}
                        <span className="rounded border border-border-hairline bg-bg-inset px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
                          {f.tag}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

/** Skeleton card shown while listModules loads. */
export function ModuleCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border-hairline bg-bg-panel p-6">
      <span className="absolute inset-x-0 top-0 h-[3px] bg-border-hairline" />
      <div className="flex items-start gap-4">
        <span className="size-12 animate-pulse rounded-xl bg-bg-panel-raised" />
        <div className="flex-1 space-y-2">
          <span className="block h-5 w-44 animate-pulse rounded bg-bg-panel-raised" />
          <span className="block h-3 w-28 animate-pulse rounded bg-bg-panel-raised" />
        </div>
        <span className="h-6 w-20 animate-pulse rounded-full bg-bg-panel-raised" />
      </div>
      <span className="mt-4 block h-4 w-full animate-pulse rounded bg-bg-panel-raised" />
      <span className="mt-2 block h-3 w-2/3 animate-pulse rounded bg-bg-panel-raised" />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="h-6 w-20 animate-pulse rounded-md bg-bg-panel-raised" />
        ))}
      </div>
      <div className="mt-5 border-t border-border-hairline pt-4">
        <span className="block h-8 w-full animate-pulse rounded-lg bg-bg-panel-raised" />
      </div>
    </div>
  );
}
