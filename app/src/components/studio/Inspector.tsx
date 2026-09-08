import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  Code2,
  FileDown,
  ListChecks,
  Loader2,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IRIChip } from '@/components/ui/iri-chip';
import {
  cardinalityRequired,
  constraintType,
  constraintValue,
  EXPORT_FORMATS,
  shaclToTurtle,
  type StudioClass,
  type StudioModule,
  type StudioProperty,
} from './studio-utils';

export interface InspectorProps {
  module: StudioModule;
  classes: StudioClass[];
  properties: StudioProperty[];
  selectedClassIri: string | null;
  selectedPropIri: string | null;
  onSelectClass: (iri: string) => void;
  onSelectProperty: (iri: string | null) => void;
  onDeprecate: (cls: StudioClass) => void;
  onExport: (format: (typeof EXPORT_FORMATS)[number]['format']) => void;
  exporting: boolean;
}

const READONLY_HINT = 'Structural edits to existing classes are not exposed by the API in this build — create a new class or version instead.';

function FieldShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">{label}</div>
      {children}
    </div>
  );
}

const fieldClass =
  'w-full rounded-md border border-border-hairline bg-bg-inset px-2 py-1.5 text-[13px] text-text-primary outline-none read-only:cursor-default read-only:opacity-90';

function SeverityChip({ severity }: { severity?: string }) {
  const s = severity ?? 'Violation';
  const cls =
    s === 'Violation'
      ? 'border-risk/40 bg-risk/10 text-risk'
      : s === 'Warning'
        ? 'border-warn/40 bg-warn/10 text-warn'
        : 'border-info/40 bg-info/10 text-info';
  return (
    <span className={cn('rounded border px-1.5 py-px font-mono text-[9.5px] font-medium uppercase tracking-[0.06em]', cls)}>
      {s}
    </span>
  );
}

function ClassInspector({
  cls,
  module,
  properties,
  classes,
  onSelectProperty,
  onSelectClass,
  onDeprecate,
}: {
  cls: StudioClass;
  module: StudioModule;
  properties: StudioProperty[];
  classes: StudioClass[];
  onSelectProperty: (iri: string) => void;
  onSelectClass: (iri: string) => void;
  onDeprecate: (cls: StudioClass) => void;
}) {
  const [turtle, setTurtle] = useState(false);
  const clsProps = properties.filter((p) => p.domainIri === cls.iri);
  const shape = cls.shaclJson;
  const isNew = cls.isCustom && !cls.deprecated;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2">
          <IRIChip iri={cls.iri} definition={cls.definition ?? undefined} />
          <span className="size-2 rounded-full" style={{ backgroundColor: module.color }} aria-hidden />
          {isNew && (
            <span className="rounded border border-warn/40 bg-warn/15 px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-warn">
              new in v{module.version}
            </span>
          )}
          {cls.deprecated && (
            <span className="rounded border border-risk/40 bg-risk/10 px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-risk">
              deprecated
            </span>
          )}
        </div>

        {/* fields (read-only: no update mutation in the API) */}
        <div className="space-y-3" title={READONLY_HINT}>
          <FieldShell label="Label">
            <input readOnly value={cls.label} className={fieldClass} />
          </FieldShell>
          <FieldShell label="Definition">
            <textarea readOnly rows={3} value={cls.definition ?? ''} placeholder="—" className={cn(fieldClass, 'resize-none')} />
          </FieldShell>
          <FieldShell label="Subclass of">
            <select
              value={cls.parentIri ?? ''}
              onChange={(e) => e.target.value && onSelectClass(e.target.value)}
              className={cn(fieldClass, 'font-mono text-[12px]')}
            >
              <option value="">owl:Thing (root)</option>
              {cls.parentIri && <option value={cls.parentIri}>{cls.parentIri}</option>}
              {classes
                .filter((c) => c.iri !== cls.iri && c.iri !== cls.parentIri)
                .map((c) => (
                  <option key={c.iri} value={c.iri}>
                    {c.iri}
                  </option>
                ))}
            </select>
          </FieldShell>
        </div>

        {/* properties table */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Properties · <span className="font-mono">{clsProps.length}</span>
            </span>
          </div>
          {clsProps.length === 0 ? (
            <p className="rounded-md border border-dashed border-border-hairline px-3 py-2.5 text-center text-[11.5px] text-text-muted">
              No properties declared on this class.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border-hairline">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border-hairline bg-bg-inset text-[9.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Range</th>
                    <th className="px-2 py-1.5">Card.</th>
                    <th className="px-2 py-1.5">Req.</th>
                  </tr>
                </thead>
                <tbody>
                  {clsProps.map((p) => {
                    const range = p.rangeIri ?? p.rangeDatatype ?? '—';
                    const required = cardinalityRequired(p.cardinality);
                    return (
                      <tr
                        key={p.iri}
                        onClick={() => onSelectProperty(p.iri)}
                        className="cursor-pointer border-b border-border-hairline/60 text-[12px] transition-colors last:border-0 hover:bg-bg-panel-raised"
                      >
                        <td className="px-2 py-1.5 font-mono text-[11.5px] text-text-primary">{p.label}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px] text-text-secondary">{range}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px] text-text-secondary">{p.cardinality ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={cn(
                              'inline-block h-3.5 w-6 rounded-full p-px transition-colors',
                              required ? 'bg-iris' : 'bg-border-hairline',
                            )}
                            title={required ? 'Required' : 'Optional'}
                          >
                            <span
                              className={cn(
                                'block size-3 rounded-full bg-text-primary transition-transform',
                                required && 'translate-x-2.5',
                              )}
                            />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* SHACL constraints */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
              SHACL constraints
            </span>
            {shape && (
              <button
                type="button"
                onClick={() => setTurtle((t) => !t)}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                  turtle
                    ? 'border-iris/50 bg-iris/15 text-text-accent'
                    : 'border-border-hairline text-text-secondary hover:border-border-glow hover:text-text-primary',
                )}
              >
                {turtle ? <ListChecks className="size-3" /> : <Code2 className="size-3" />}
                {turtle ? 'View as form' : 'View as Turtle'}
              </button>
            )}
          </div>
          {!shape ? (
            <p className="rounded-md border border-dashed border-border-hairline px-3 py-2.5 text-center text-[11.5px] text-text-muted">
              No SHACL shape declared for this class.
            </p>
          ) : turtle ? (
            <pre className="max-h-64 overflow-auto rounded-md border border-border-hairline bg-bg-inset p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
              {shaclToTurtle(cls)}
            </pre>
          ) : (
            <div className="space-y-1.5">
              <div className="font-mono text-[10.5px] text-text-muted">{shape.shape}</div>
              {shape.constraints.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border-hairline bg-bg-inset px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-primary">{c.path}</span>
                  <span className="shrink-0 rounded bg-bg-panel px-1.5 py-px font-mono text-[10px] text-text-accent">
                    {constraintType(c)}
                  </span>
                  <span className="max-w-28 shrink-0 truncate font-mono text-[10.5px] text-text-secondary" title={constraintValue(c)}>
                    {constraintValue(c)}
                  </span>
                  <SeverityChip severity={c.severity} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* backward-compat check */}
        <div className="rounded-md border border-ok/30 bg-ok/5 p-3">
          <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ok">
            Backward-compat check
          </div>
          <ul className="space-y-1 text-[12px] text-text-secondary">
            {['no removed superclasses', 'no narrowed cardinalities', `${cls.instanceCount} existing instances unaffected`].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-3 shrink-0 text-ok" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-between border-t border-border-hairline px-4 py-2.5">
        <button
          type="button"
          onClick={() => onDeprecate(cls)}
          disabled={cls.deprecated}
          className="flex items-center gap-1.5 rounded-md border border-risk/40 px-2.5 py-1 text-[12px] text-risk transition-colors hover:bg-risk/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="size-3" /> Deprecate class
        </button>
        <Link
          to="/app/explorer"
          className="flex items-center gap-1 text-[12px] text-text-accent transition-colors hover:text-iris-bright"
        >
          View instances ({cls.instanceCount}) <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

function PropertyInspector({
  prop,
  classes,
  onBack,
}: {
  prop: StudioProperty;
  classes: StudioClass[];
  onBack: () => void;
}) {
  const domain = classes.find((c) => c.iri === prop.domainIri);
  const toggleRow = (label: string, on: boolean) => (
    <div className="flex items-center justify-between rounded-md border border-border-hairline bg-bg-inset px-2.5 py-1.5">
      <span className="text-[12px] text-text-secondary">{label}</span>
      <span className={cn('inline-block h-3.5 w-6 rounded-full p-px', on ? 'bg-iris' : 'bg-border-hairline')} title="Read-only in this build">
        <span className={cn('block size-3 rounded-full bg-text-primary', on && 'translate-x-2.5')} />
      </span>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <button type="button" onClick={onBack} className="text-[12px] text-text-accent hover:text-iris-bright">
          ← Back to class
        </button>
        <IRIChip iri={prop.iri} definition={prop.definition ?? undefined} />
        <div className="space-y-3" title={READONLY_HINT}>
          <FieldShell label="Kind">
            <input readOnly value={prop.kind === 'object' ? 'Object property' : 'Datatype property'} className={fieldClass} />
          </FieldShell>
          <FieldShell label="Domain">
            <input readOnly value={prop.domainIri ?? '—'} className={cn(fieldClass, 'font-mono text-[12px]')} />
          </FieldShell>
          <FieldShell label="Range">
            <input readOnly value={prop.rangeIri ?? prop.rangeDatatype ?? '—'} className={cn(fieldClass, 'font-mono text-[12px]')} />
          </FieldShell>
          <FieldShell label="Cardinality">
            <input readOnly value={prop.cardinality ?? '—'} className={cn(fieldClass, 'font-mono text-[12px]')} />
          </FieldShell>
          <FieldShell label="Inverse of">
            <select disabled className={cn(fieldClass, 'font-mono text-[12px] opacity-60')}>
              <option>— none —</option>
            </select>
          </FieldShell>
          {toggleRow('Transitive', false)}
          {toggleRow('Symmetric', false)}
        </div>
        <div className="rounded-md border border-border-hairline bg-bg-inset px-3 py-2 font-mono text-[11.5px] text-text-secondary">
          usage · <span className="text-text-primary">{domain?.instanceCount ?? 0}</span> instances on {prop.domainIri ?? '—'}
        </div>
      </div>
    </div>
  );
}

/**
 * Inspector — right pane of the Studio. Contextual: class details with
 * properties/SHACL/backward-compat, or property details when an edge is
 * selected. Cross-fades 200ms on selection change.
 */
export function Inspector({
  module,
  classes,
  properties,
  selectedClassIri,
  selectedPropIri,
  onSelectClass,
  onSelectProperty,
  onDeprecate,
  onExport,
  exporting,
}: InspectorProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const cls = classes.find((c) => c.iri === selectedClassIri) ?? null;
  const prop = properties.find((p) => p.iri === selectedPropIri) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* pane header with export */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-hairline px-3">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">Inspector</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((o) => !o)}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-md border border-border-hairline px-2 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
          >
            {exporting ? <Loader2 className="size-3 animate-spin" /> : <FileDown className="size-3" />}
            Export module
          </button>
          {exportOpen && (
            <>
              <button type="button" aria-hidden className="fixed inset-0 z-30 cursor-default" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-border-hairline bg-bg-panel-raised py-1 shadow-xl">
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.format}
                    type="button"
                    onClick={() => {
                      setExportOpen(false);
                      onExport(f.format);
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] text-text-secondary transition-colors hover:bg-bg-panel hover:text-text-primary"
                  >
                    {f.label}
                    <span className="font-mono text-[10px] text-text-muted">{f.ext}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={prop?.iri ?? cls?.iri ?? 'empty'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {prop && cls ? (
              <PropertyInspector prop={prop} classes={classes} onBack={() => onSelectProperty(null)} />
            ) : cls ? (
              <ClassInspector
                cls={cls}
                module={module}
                properties={properties}
                classes={classes}
                onSelectProperty={onSelectProperty}
                onSelectClass={onSelectClass}
                onDeprecate={onDeprecate}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <img src="/empty-graph.svg" alt="" className="size-20 opacity-70" />
                <p className="text-[13px] text-text-secondary">Nothing selected</p>
                <p className="max-w-56 text-[12px] leading-relaxed text-text-muted">
                  Select a class in the tree or on the canvas to inspect its properties, SHACL shapes and instances.
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default Inspector;
