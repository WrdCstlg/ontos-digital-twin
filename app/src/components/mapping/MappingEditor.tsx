import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Braces,
  Download,
  Loader2,
  Play,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getModule, moduleAlpha, moduleForPrefix } from '@/lib/modules';
import {
  applyTransform,
  defaultTransform,
  detectColumnType,
  generateR2RML,
  parseCsvHead,
  renderTemplate,
  TRANSFORMS,
  type ColumnMapShape,
  type ConnectorLike,
  type MappingLike,
} from './utils';

export interface CsvData {
  filename: string;
  text: string;
  connectorId: number;
}

interface LinkEntry {
  column: string;
  predicate: string;
  target: string;
}

interface EditorForm {
  mappingId: number | null;
  name: string;
  sourceTable: string;
  moduleKey: string;
  classIri: string;
  subject: string;
  labelColumn: string;
  fields: Record<string, string>;
  links: LinkEntry[];
  transforms: Record<string, string>;
}

interface EdgeGeom {
  key: string;
  column: string;
  predicate: string;
  isLink: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
}

export interface MappingEditorProps {
  connector: ConnectorLike | null;
  mappings: MappingLike[]; // mappings of the selected connector
  csvData: CsvData | null;
  onRequestCsvUpload: () => void;
  onPreview: (mappingId: number | null) => void;
  onRunSync: (mappingId: number) => void;
  runningMappingId: number | null;
  onError: (message: string) => void;
}

function emptyForm(connector: ConnectorLike | null): EditorForm {
  return {
    mappingId: null,
    name: connector ? `${connector.name.toLowerCase().replace(/\s+/g, '-')} → ?` : 'new mapping',
    sourceTable: connector?.type === 'csv' ? String((connector.configJson as Record<string, unknown> | null)?.filename ?? 'source.csv') : 'table',
    moduleKey: 'hr',
    classIri: '',
    subject: '',
    labelColumn: '',
    fields: {},
    links: [],
    transforms: {},
  };
}

function formFromMapping(m: MappingLike, moduleKey: string): EditorForm {
  const cm = (m.columnMapJson ?? { subject: '' }) as ColumnMapShape;
  const transforms: Record<string, string> = {};
  for (const col of Object.keys(cm.fields ?? {})) transforms[col] = defaultTransform(col);
  for (const l of cm.links ?? []) transforms[l.column] = 'identity';
  return {
    mappingId: m.id,
    name: m.name,
    sourceTable: m.sourceTable,
    moduleKey,
    classIri: m.classIri,
    subject: cm.subject ?? '',
    labelColumn: cm.label ?? '',
    fields: { ...(cm.fields ?? {}) },
    links: (cm.links ?? []).map((l) => ({ ...l })),
    transforms,
  };
}

export function MappingEditor({
  connector,
  mappings,
  csvData,
  onRequestCsvUpload,
  onPreview,
  onRunSync,
  runningMappingId,
  onError,
}: MappingEditorProps) {
  const [form, setForm] = useState<EditorForm>(() => emptyForm(connector));
  const [showR2RML, setShowR2RML] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<{ column: string; startX: number; startY: number; x: number; y: number } | null>(null);
  const [hoverProp, setHoverProp] = useState<string | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  const colDotRefs = useRef(new Map<string, HTMLElement>());
  const propDotRefs = useRef(new Map<string, HTMLElement>());
  const [edges, setEdges] = useState<EdgeGeom[]>([]);

  const utils = trpc.useUtils();
  const modules = trpc.ontology.listModules.useQuery(undefined, { staleTime: 60_000 });
  const classes = trpc.ontology.listClasses.useQuery(
    { moduleKey: form.moduleKey },
    { enabled: !!form.moduleKey, staleTime: 60_000 },
  );
  const properties = trpc.ontology.listProperties.useQuery(
    { moduleKey: form.moduleKey },
    { enabled: !!form.moduleKey, staleTime: 60_000 },
  );

  const classProps = useMemo(
    () => (properties.data ?? []).filter((p) => p.domainIri === form.classIri),
    [properties.data, form.classIri],
  );

  const saveMutation = trpc.mapping.upsertMapping.useMutation({
    onError: (err) => {
      setSaving(false);
      onError(err.message);
    },
  });

  const [prevIdentityKey, setPrevIdentityKey] = useState<string | null>(null);
  const activeMapping = mappings.find((m) => m.id === form.mappingId) ?? mappings[0] ?? null;
  const currentIdentityKey = `${connector?.id ?? 'none'}:${activeMapping?.id ?? 'new'}`;
  if (prevIdentityKey !== currentIdentityKey) {
    setPrevIdentityKey(currentIdentityKey);
    if (activeMapping) {
      setForm(formFromMapping(activeMapping, activeMapping.module?.key ?? 'hr'));
    } else if (connector) {
      setForm(emptyForm(connector));
    }
  }

  // Sample data (uploaded CSV for this connector) for type detection + previews
  const sample = useMemo(() => {
    if (!csvData || !connector || csvData.connectorId !== connector.id) return null;
    return parseCsvHead(csvData.text, 8);
  }, [csvData, connector]);

  const columns = useMemo(() => {
    const set = new Set<string>();
    if (sample) for (const h of sample.headers) set.add(h);
    for (const c of Object.keys(form.fields)) set.add(c);
    for (const l of form.links) set.add(l.column);
    for (const v of form.subject.matchAll(/\{([^}]+)\}/g)) set.add(v[1]);
    if (form.labelColumn) set.add(form.labelColumn);
    return [...set];
  }, [sample, form.fields, form.links, form.subject, form.labelColumn]);

  const columnValues = useCallback(
    (col: string) => (sample ? sample.rows.map((r) => r[col] ?? '') : []),
    [sample],
  );

  const sampleRow = sample?.rows[0] ?? null;
  const subjectPreview = sampleRow ? renderTemplate(form.subject, sampleRow) : null;

  /* ── geometry ─────────────────────────────────────────────── */
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const b = board.getBoundingClientRect();
    const out: EdgeGeom[] = [];
    const anchor = (el: HTMLElement | undefined, side: 'right' | 'left') => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: side === 'right' ? r.right - b.left : r.left - b.left, y: r.top + r.height / 2 - b.top };
    };
    const push = (column: string, predicate: string, isLink: boolean) => {
      const a = anchor(colDotRefs.current.get(column), 'right');
      const c = anchor(propDotRefs.current.get(predicate), 'left');
      if (!a || !c) return;
      const mx = (a.x + c.x) / 2;
      const my = (a.y + c.y) / 2;
      out.push({ key: `${column}→${predicate}`, column, predicate, isLink, x1: a.x, y1: a.y, x2: c.x, y2: c.y, mx, my });
    };
    for (const [col, pred] of Object.entries(form.fields)) push(col, pred, false);
    for (const l of form.links) push(l.column, l.predicate, true);
    setEdges(out);
  }, [form.fields, form.links]);

  useLayoutEffect(() => {
    measure();
  }, [measure, columns, classProps.length]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  /* ── mapping ops ──────────────────────────────────────────── */
  const unmapColumn = (column: string) => {
    setForm((f) => {
      const fields = { ...f.fields };
      delete fields[column];
      return { ...f, fields, links: f.links.filter((l) => l.column !== column) };
    });
  };

  const mapColumn = useCallback(
    (column: string, propertyIri: string) => {
      const prop = classProps.find((p) => p.iri === propertyIri);
      if (!prop) return;
      setForm((f) => {
        const fields = { ...f.fields };
        delete fields[column];
        const links = f.links.filter((l) => l.column !== column);
        if (prop.kind === 'object') {
          const range = prop.rangeIri ?? 'hr:Thing';
          links.push({ column, predicate: propertyIri, target: `${range}/{value}` });
        } else {
          fields[column] = propertyIri;
        }
        const transforms = { ...f.transforms };
        if (!transforms[column]) transforms[column] = defaultTransform(column, columnValues(column));
        return { ...f, fields, links, transforms };
      });
    },
    [classProps, columnValues],
  );

  /* ── drag connect ─────────────────────────────────────────── */
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const b = boardRef.current?.getBoundingClientRect();
      if (!b) return;
      setDrag((d) => (d ? { ...d, x: e.clientX - b.left, y: e.clientY - b.top } : d));
      const el = document.elementFromPoint(e.clientX, e.clientY);
      setHoverProp(el?.closest<HTMLElement>('[data-prop-iri]')?.dataset.propIri ?? null);
    };
    const up = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const iri = el?.closest<HTMLElement>('[data-prop-iri]')?.dataset.propIri;
      if (iri && drag.column) mapColumn(drag.column, iri);
      setDrag(null);
      setHoverProp(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, mapColumn]);

  /* ── save / run ───────────────────────────────────────────── */
  const buildColumnMap = (): ColumnMapShape => ({
    subject: form.subject,
    label: form.labelColumn || undefined,
    fields: form.fields,
    links: form.links,
  });

  const doSave = async (): Promise<number | null> => {
    if (!connector) return null;
    setSaving(true);
    try {
      const row = await saveMutation.mutateAsync({
        id: form.mappingId ?? undefined,
        connectorId: connector.id,
        moduleKey: form.moduleKey,
        name: form.name,
        sourceTable: form.sourceTable,
        classIri: form.classIri,
        columnMap: buildColumnMap(),
        status: activeMapping?.status ?? 'draft',
      });
      await utils.mapping.listMappings.invalidate();
      setForm((f) => ({ ...f, mappingId: row.id }));
      return row.id;
    } catch {
      return null; // onError already surfaced
    } finally {
      setSaving(false);
    }
  };

  const onSaveClick = async () => {
    const id = await doSave();
    if (id) toast.success('Mapping saved', { description: form.name });
  };

  const onRunClick = async () => {
    const id = await doSave();
    if (id) onRunSync(id);
  };

  const moduleColor = getModule(
    (['hr', 'legal', 'compliance', 'finance', 'logistics', 'custom'].includes(form.moduleKey) ? form.moduleKey : 'custom') as
      | 'hr' | 'legal' | 'compliance' | 'finance' | 'logistics' | 'custom',
  ).color;

  if (!connector) {
    return (
      <section className="rounded-xl border border-border-hairline bg-bg-panel p-10 text-center">
        <p className="text-[14px] text-text-secondary">Select a connector above to open its mapping editor.</p>
        <p className="mt-1 font-mono text-[11.5px] text-text-muted">source schema → mapping links → ontology target</p>
      </section>
    );
  }

  const mappedColumns = new Set([...Object.keys(form.fields), ...form.links.map((l) => l.column)]);

  return (
    <section className="overflow-hidden rounded-xl border border-border-hairline bg-bg-panel">
      {/* ── top bar ── */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border-hairline px-4 py-3">
        {mappings.length > 1 && (
          <select
            value={form.mappingId ?? ''}
            onChange={(e) => {
              const m = mappings.find((x) => x.id === Number(e.target.value));
              if (m) setForm(formFromMapping(m, m.module?.key ?? 'hr'));
            }}
            className="h-8 rounded-md border border-border-hairline bg-bg-inset px-2 font-mono text-[11.5px] text-text-primary"
            aria-label="Select mapping"
          >
            {mappings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          aria-label="Mapping name"
          className="h-8 min-w-56 rounded-md border border-border-hairline bg-bg-inset px-2.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-iris"
        />
        <select
          value={form.moduleKey}
          onChange={(e) => {
            const moduleKey = e.target.value;
            setForm((f) => ({ ...f, moduleKey, classIri: '' }));
          }}
          aria-label="Target module"
          className="h-8 rounded-md border border-border-hairline bg-bg-inset px-2 font-mono text-[11.5px] text-text-primary"
        >
          {(modules.data ?? []).map((m) => (
            <option key={m.key} value={m.key}>
              {m.prefix} · {m.name}
            </option>
          ))}
        </select>
        <select
          value={form.classIri}
          onChange={(e) => {
            const classIri = e.target.value;
            setForm((f) => ({
              ...f,
              classIri,
              subject: f.subject || `${classIri}/{id}`,
              fields: {},
              links: [],
            }));
          }}
          aria-label="Target class"
          className="h-8 rounded-md border border-border-hairline bg-bg-inset px-2 font-mono text-[11.5px] text-text-primary"
        >
          <option value="" disabled>
            pick class…
          </option>
          {(classes.data ?? []).map((c) => (
            <option key={c.iri} value={c.iri}>
              {c.iri}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowR2RML((s) => !s)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11.5px] transition-colors',
            showR2RML ? 'border-iris/60 bg-iris/15 text-text-accent' : 'border-border-hairline text-text-muted hover:text-text-primary',
          )}
        >
          <Braces className="size-3.5" /> R2RML
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onSaveClick}
            disabled={saving || !form.classIri || !form.subject}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-glow px-3 text-[12.5px] text-text-secondary transition-colors hover:bg-bg-panel-raised disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
          </button>
          <button
            type="button"
            onClick={() => (sample ? onPreview(form.mappingId) : onRequestCsvUpload())}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-glow px-3 text-[12.5px] text-text-secondary transition-colors hover:bg-bg-panel-raised"
          >
            <Sparkles className="size-3.5" /> Preview instances
          </button>
          <button
            type="button"
            onClick={onRunClick}
            disabled={saving || runningMappingId != null || !form.classIri || !form.subject || connector.type !== 'csv'}
            title={connector.type !== 'csv' ? 'Demo sync engine materializes CSV connectors' : undefined}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-iris px-3.5 text-[12.5px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-40"
          >
            {runningMappingId != null ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run sync
          </button>
        </div>
      </div>

      {/* ── subject template row ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border-hairline bg-bg-inset/60 px-4 py-2.5">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Subject template</span>
        <input
          value={form.subject}
          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
          aria-label="Subject IRI template"
          placeholder="hr:Person/{emp_id}"
          className="h-[30px] min-w-64 rounded-md border border-border-hairline bg-bg-inset px-2.5 font-mono text-[12px] text-text-accent outline-none focus:border-iris"
        />
        {subjectPreview && (
          <span className="font-mono text-[11.5px] text-text-muted">
            preview <span className="text-ok">{subjectPreview}</span>
          </span>
        )}
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Label column</span>
        <select
          value={form.labelColumn}
          onChange={(e) => setForm((f) => ({ ...f, labelColumn: e.target.value }))}
          aria-label="Label column"
          className="h-[30px] rounded-md border border-border-hairline bg-bg-inset px-2 font-mono text-[11.5px] text-text-primary"
        >
          <option value="">—</option>
          {columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* ── R2RML generated view ── */}
      <AnimatePresence>
        {showR2RML && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-b border-border-hairline"
          >
            <div className="relative bg-bg-inset p-4">
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([generateR2RML({ name: form.name, sourceTable: form.sourceTable, classIri: form.classIri, columnMap: buildColumnMap() })], { type: 'text/turtle' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${form.sourceTable.replace(/[^a-z0-9]+/gi, '-')}.ttl`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-border-hairline bg-bg-panel px-2 py-1 font-mono text-[10.5px] text-text-secondary transition-colors hover:text-text-primary"
              >
                <Download className="size-3" /> Export .ttl
              </button>
              <pre className="max-h-64 overflow-auto font-mono text-[11.5px] leading-relaxed text-text-secondary">
                {generateR2RML({ name: form.name, sourceTable: form.sourceTable, classIri: form.classIri, columnMap: buildColumnMap() })}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── mapping board ── */}
      <div ref={boardRef} className="relative grid grid-cols-[280px_minmax(0,1fr)_300px] gap-0">
        {/* SVG edge layer */}
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {edges.map((e) => {
            const c = Math.max(40, (e.x2 - e.x1) / 2);
            const d = `M ${e.x1} ${e.y1} C ${e.x1 + c} ${e.y1}, ${e.x2 - c} ${e.y2}, ${e.x2} ${e.y2}`;
            return (
              <motion.path
                key={e.key}
                d={d}
                fill="none"
                stroke={moduleColor}
                strokeWidth={1.5}
                strokeOpacity={0.85}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
            );
          })}
          {drag && (
            <path
              d={`M ${drag.startX} ${drag.startY} C ${drag.startX + Math.max(40, (drag.x - drag.startX) / 2)} ${drag.startY}, ${drag.x - Math.max(40, (drag.x - drag.startX) / 2)} ${drag.y}, ${drag.x} ${drag.y}`}
              fill="none"
              stroke={moduleColor}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeOpacity={0.6}
            />
          )}
        </svg>

        {/* left — source schema */}
        <div className="border-r border-border-hairline">
          <div className="border-b border-border-hairline px-3.5 py-2.5">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Source schema</div>
            <div className="mt-0.5 truncate font-mono text-[11.5px] text-text-secondary">{form.sourceTable}</div>
          </div>
          <ul className="max-h-[420px] overflow-y-auto py-1.5">
            {columns.length === 0 && (
              <li className="px-3.5 py-6 text-center text-[12px] text-text-muted">
                No columns yet —{' '}
                <button type="button" onClick={onRequestCsvUpload} className="text-text-accent hover:underline">
                  upload a CSV
                </button>{' '}
                or save a mapping with a column map.
              </li>
            )}
            {columns.map((col) => {
              const vals = columnValues(col);
              const type = detectColumnType(vals);
              const nullable = vals.some((v) => v === '');
              const mapped = mappedColumns.has(col);
              return (
                <li
                  key={col}
                  className={cn(
                    'group flex items-center gap-2 px-3.5 py-1.5 transition-colors',
                    drag?.column === col ? 'bg-bg-panel-raised' : 'hover:bg-bg-panel-raised/60',
                  )}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', nullable ? 'bg-warn/70' : 'bg-border-glow')} title={nullable ? 'nullable' : 'not null'} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">{col}</span>
                  <span className="rounded border border-border-hairline bg-bg-inset px-1 py-0 font-mono text-[9.5px] text-text-muted">{type}</span>
                  {mapped ? (
                    <button
                      type="button"
                      onClick={() => unmapColumn(col)}
                      title="Remove link"
                      className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:text-risk group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : (
                    <select
                      value=""
                      onChange={(e) => e.target.value && mapColumn(col, e.target.value)}
                      aria-label={`Map ${col} to property`}
                      className="h-6 w-0 min-w-24 rounded border border-border-hairline bg-bg-inset px-1 font-mono text-[10px] text-text-muted opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    >
                      <option value="">map to…</option>
                      {classProps.map((p) => (
                        <option key={p.iri} value={p.iri}>
                          {p.iri}
                        </option>
                      ))}
                    </select>
                  )}
                  <span
                    ref={(el) => {
                      if (el) colDotRefs.current.set(col, el);
                      else colDotRefs.current.delete(col);
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      const b = boardRef.current?.getBoundingClientRect();
                      if (!b) return;
                      const el = colDotRefs.current.get(col);
                      const r = el?.getBoundingClientRect();
                      const startX = r ? r.right - b.left : e.clientX - b.left;
                      const startY = r ? r.top + r.height / 2 - b.top : e.clientY - b.top;
                      setDrag({ column: col, startX, startY, x: e.clientX - b.left, y: e.clientY - b.top });
                    }}
                    className={cn(
                      'size-2.5 shrink-0 cursor-crosshair rounded-full border-2 transition-colors',
                      mapped ? 'border-transparent' : 'border-border-glow bg-transparent hover:border-iris',
                      drag?.column === col && 'border-iris-bright',
                    )}
                    style={mapped ? { backgroundColor: moduleColor } : undefined}
                    title="Drag to a property to connect"
                  />
                </li>
              );
            })}
          </ul>
        </div>

        {/* center — link chips */}
        <div className="relative min-h-40">
          <div className="border-b border-border-hairline px-3.5 py-2.5 text-center text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
            Mapping links
          </div>
          {edges.map((e) => {
            const transform = form.transforms[e.column] ?? 'identity';
            const link = form.links.find((l) => l.column === e.column && l.predicate === e.predicate);
            return (
              <Popover key={`chip-${e.key}`}>
                <PopoverTrigger asChild>
                  <motion.button
                    type="button"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.15 }}
                    className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors hover:border-iris"
                    style={{
                      left: e.mx,
                      top: e.my,
                      borderColor: moduleAlpha(moduleColor, 0.4),
                      backgroundColor: moduleAlpha(moduleColor, 0.12),
                      color: moduleColor,
                    }}
                  >
                    {transform}
                  </motion.button>
                </PopoverTrigger>
                <PopoverContent className="w-72 border-border-hairline bg-bg-panel-raised p-3">
                  <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}>
                    <div className="mb-2 font-mono text-[11.5px] text-text-secondary">
                      <span className="text-text-primary">{e.column}</span> → <span style={{ color: moduleColor }}>{e.predicate}</span>
                    </div>
                    <label className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Transformation</label>
                    <select
                      value={transform}
                      onChange={(ev) => setForm((f) => ({ ...f, transforms: { ...f.transforms, [e.column]: ev.target.value } }))}
                      className="mb-2 h-8 w-full rounded-md border border-border-hairline bg-bg-inset px-2 font-mono text-[11.5px] text-text-primary"
                    >
                      {TRANSFORMS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {link && (
                      <>
                        <label className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Target template</label>
                        <input
                          value={link.target}
                          onChange={(ev) =>
                            setForm((f) => ({
                              ...f,
                              links: f.links.map((l) => (l.column === link.column && l.predicate === link.predicate ? { ...l, target: ev.target.value } : l)),
                            }))
                          }
                          className="mb-2 h-8 w-full rounded-md border border-border-hairline bg-bg-inset px-2 font-mono text-[11.5px] text-text-accent outline-none focus:border-iris"
                        />
                      </>
                    )}
                    <TransformTester transform={transform} sample={columnValues(e.column).find((v) => v !== '') ?? ''} />
                  </motion.div>
                </PopoverContent>
              </Popover>
            );
          })}
          {edges.length === 0 && (
            <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[12px] text-text-muted">
              Drag a column dot onto a property dot — or use the “map to…” dropdown — to create a link.
            </div>
          )}
        </div>

        {/* right — ontology target */}
        <div className="border-l border-border-hairline">
          <div className="border-b border-border-hairline px-3.5 py-2.5">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.08em]" style={{ color: moduleColor }}>
              Ontology target
            </div>
            <div className="mt-0.5 truncate font-mono text-[11.5px] text-text-secondary">
              {form.classIri ? (
                <>
                  <span style={{ color: moduleForPrefix(form.classIri.split(':')[0]).color }}>{form.classIri.split(':')[0]}:</span>
                  <span className="text-text-primary">{form.classIri.split(':')[1]}</span>
                </>
              ) : (
                'pick a class'
              )}
            </div>
          </div>
          <ul className="max-h-[420px] overflow-y-auto py-1.5">
            {form.classIri && classProps.length === 0 && !properties.isLoading && (
              <li className="px-3.5 py-6 text-center text-[12px] text-text-muted">No declared properties on this class.</li>
            )}
            {properties.isLoading && form.classIri && (
              <li className="px-3.5 py-6 text-center font-mono text-[11px] text-text-muted">loading properties…</li>
            )}
            {classProps.map((p) => {
              const used = edges.some((e) => e.predicate === p.iri);
              return (
                <li
                  key={p.iri}
                  data-prop-iri={p.iri}
                  className={cn(
                    'flex items-center gap-2 px-3.5 py-1.5 transition-colors hover:bg-bg-panel-raised/60',
                    hoverProp === p.iri && 'bg-iris/15 outline outline-1 outline-iris/50',
                  )}
                >
                  <span
                    ref={(el) => {
                      if (el) propDotRefs.current.set(p.iri, el);
                      else propDotRefs.current.delete(p.iri);
                    }}
                    className={cn(
                      'size-2.5 shrink-0 rounded-full border-2 transition-colors',
                      used ? 'border-transparent' : 'border-border-glow',
                      hoverProp === p.iri && 'scale-125 border-iris-bright',
                    )}
                    style={used ? { backgroundColor: moduleColor } : undefined}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">{p.iri.split(':')[1]}</span>
                  <span className="truncate font-mono text-[10px] text-text-muted">
                    {p.kind === 'object' ? `→ ${p.rangeIri ?? 'class'}` : (p.rangeDatatype ?? 'xsd:string')}
                  </span>
                </li>
              );
            })}
            {!form.classIri && (
              <li className="px-3.5 py-6 text-center text-[12px] text-text-muted">Select a target class to list its properties.</li>
            )}
          </ul>
        </div>
      </div>

      {form.mappingId === null && (
        <div className="border-t border-border-hairline bg-bg-inset/60 px-4 py-2 font-mono text-[10.5px] text-text-muted">
          unsaved mapping — Save to persist, then Run sync to materialize.
        </div>
      )}
    </section>
  );
}

/** Test-value input with live transformation result. */
function TransformTester({ transform, sample }: { transform: string; sample: string }) {
  const [prevSample, setPrevSample] = useState(sample);
  const [value, setValue] = useState(sample);
  if (prevSample !== sample) {
    setPrevSample(sample);
    setValue(sample);
  }
  return (
    <div>
      <label className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Test value</label>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="type a raw value…"
        className="h-8 w-full rounded-md border border-border-hairline bg-bg-inset px-2 font-mono text-[11.5px] text-text-primary outline-none focus:border-iris"
      />
      <div className="mt-1.5 font-mono text-[11px]">
        <span className="text-text-muted">result: </span>
        <span className="text-ok">{applyTransform(transform, value)}</span>
      </div>
    </div>
  );
}
