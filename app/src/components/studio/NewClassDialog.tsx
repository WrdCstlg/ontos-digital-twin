import { useState } from 'react';
import { Link } from 'react-router';
import { CirclePlus, Loader2, LogIn, TriangleAlert, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { LOGIN_PATH } from '@/const';
import { trpc } from '@/providers/trpc';
import { CARDINALITIES, localName, type StudioClass } from './studio-utils';

interface PropRow {
  name: string;
  kind: 'object' | 'datatype';
  rangeDatatype: string;
  rangeClassIri: string;
  cardinality: string;
}

const EMPTY_PROP: PropRow = {
  name: '',
  kind: 'datatype',
  rangeDatatype: 'xsd:string',
  rangeClassIri: '',
  cardinality: '0..1',
};

export interface NewClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleKey: string;
  modulePrefix: string;
  moduleColor: string;
  classes: StudioClass[];
  prefillParentIri?: string | null;
  onCreated: (iri: string, newVersion: string) => void;
}

/**
 * NewClassDialog — the "extend HR with hr:Contractor" flow. Label with a
 * locked namespace prefix, parent picker, definition and inline property
 * rows; surfaces CONFLICT / deprecated-parent refusals from createClass.
 */
export function NewClassDialog(props: NewClassDialogProps) {
  const { open, onOpenChange, modulePrefix, moduleColor } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border-hairline bg-bg-panel p-0 text-text-primary">
        <DialogHeader className="border-b border-border-hairline px-5 py-4">
          <DialogTitle className="font-display text-[17px] font-semibold tracking-tight">
            New class in <span className="font-mono text-[15px]" style={{ color: moduleColor }}>{modulePrefix}:</span>
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-text-muted">
            Creates the class and publishes a new minor version of the module.
          </DialogDescription>
        </DialogHeader>
        {/* Form state lives here so every dialog opening starts fresh. */}
        <NewClassForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function NewClassForm({
  onOpenChange,
  moduleKey,
  modulePrefix,
  moduleColor,
  classes,
  prefillParentIri,
  onCreated,
}: NewClassDialogProps) {
  const [label, setLabel] = useState('');
  const [parentIri, setParentIri] = useState<string>(prefillParentIri ?? '');
  const [definition, setDefinition] = useState('');
  const [props_, setProps] = useState<PropRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const createClass = trpc.ontology.createClass.useMutation({
    onSuccess: (data) => {
      onCreated(data.class.iri, data.newVersion);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err.data?.code === 'UNAUTHORIZED' || err.data?.code === 'FORBIDDEN') {
        setUnauthorized(true);
        setFormError(null);
      } else {
        setUnauthorized(false);
        setFormError(err.message);
      }
    },
  });

  const parents = classes.filter((c) => !c.deprecated);
  const labelOk = /^[A-Z][A-Za-z0-9]*$/.test(label);
  const isConflict = formError?.includes('already exists') ?? false;
  const isParentError = (formError?.includes('Parent class') ?? false) || (formError?.includes('deprecated') ?? false);

  const updateProp = (i: number, patch: Partial<PropRow>) =>
    setProps((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = () => {
    setFormError(null);
    if (!labelOk) {
      setFormError('Label must be PascalCase (e.g. Contractor).');
      return;
    }
    const properties = props_
      .filter((p) => p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        kind: p.kind,
        rangeClassIri: p.kind === 'object' ? p.rangeClassIri || undefined : undefined,
        rangeDatatype: p.kind === 'datatype' ? p.rangeDatatype || 'xsd:string' : undefined,
        cardinality: p.cardinality,
      }));
    for (const p of properties) {
      if (p.kind === 'object' && !p.rangeClassIri) {
        setFormError(`Object property '${p.name}' needs a range class.`);
        return;
      }
    }
    createClass.mutate({
      moduleKey,
      label,
      parentIri: parentIri || undefined,
      definition: definition.trim() || undefined,
      properties,
    });
  };

  return (
    <>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* label */}
          <div>
            <label className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Label
            </label>
            <div
              className={cn(
                'flex items-center overflow-hidden rounded-md border bg-bg-inset focus-within:border-border-glow',
                isConflict ? 'border-risk' : 'border-border-hairline',
              )}
            >
              <span
                className="border-r border-border-hairline bg-bg-panel px-2 py-1.5 font-mono text-[12.5px]"
                style={{ color: moduleColor }}
              >
                {modulePrefix}:
              </span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Contractor"
                autoFocus
                className="w-full bg-transparent px-2 py-1.5 font-mono text-[12.5px] text-text-primary outline-none placeholder:text-text-muted/60"
              />
            </div>
            {isConflict && (
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-risk">
                <TriangleAlert className="size-3" /> {formError}
              </p>
            )}
          </div>

          {/* parent */}
          <div>
            <label className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Subclass of
            </label>
            <select
              value={parentIri}
              onChange={(e) => setParentIri(e.target.value)}
              className={cn(
                'w-full rounded-md border bg-bg-inset px-2 py-1.5 font-mono text-[12.5px] text-text-primary outline-none focus:border-border-glow',
                isParentError ? 'border-risk' : 'border-border-hairline',
              )}
            >
              <option value="">owl:Thing (root)</option>
              {parents.map((c) => (
                <option key={c.iri} value={c.iri}>
                  {c.iri}
                </option>
              ))}
            </select>
            {isParentError && (
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-risk">
                <TriangleAlert className="size-3" /> {formError}
              </p>
            )}
          </div>

          {/* definition */}
          <div>
            <label className="mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
              Definition
            </label>
            <textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={2}
              placeholder="External worker engaged via an agency; extends Person."
              className="w-full resize-none rounded-md border border-border-hairline bg-bg-inset px-2 py-1.5 text-[13px] text-text-primary outline-none placeholder:text-text-muted/60 focus:border-border-glow"
            />
          </div>

          {/* properties */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
                Properties
              </label>
              <button
                type="button"
                onClick={() => setProps((r) => [...r, { ...EMPTY_PROP }])}
                className="flex items-center gap-1 rounded-md border border-border-hairline px-2 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
              >
                <CirclePlus className="size-3" /> Add property
              </button>
            </div>
            {props_.length === 0 ? (
              <p className="rounded-md border border-dashed border-border-hairline px-3 py-2.5 text-center text-[11.5px] text-text-muted">
                No properties — the class inherits from its parent.
              </p>
            ) : (
              <div className="space-y-2">
                {props_.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_86px_1fr_72px_24px] items-center gap-1.5 rounded-md border border-border-hairline bg-bg-inset p-1.5"
                  >
                    <input
                      value={p.name}
                      onChange={(e) => updateProp(i, { name: e.target.value })}
                      placeholder="contractRate"
                      className="w-full rounded border border-border-hairline bg-bg-panel px-1.5 py-1 font-mono text-[11.5px] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-border-glow"
                    />
                    <select
                      value={p.kind}
                      onChange={(e) => updateProp(i, { kind: e.target.value as 'object' | 'datatype' })}
                      className="rounded border border-border-hairline bg-bg-panel px-1 py-1 font-mono text-[10.5px] text-text-secondary outline-none"
                    >
                      <option value="datatype">data</option>
                      <option value="object">object</option>
                    </select>
                    {p.kind === 'datatype' ? (
                      <input
                        value={p.rangeDatatype}
                        onChange={(e) => updateProp(i, { rangeDatatype: e.target.value })}
                        placeholder="xsd:decimal"
                        className="w-full rounded border border-border-hairline bg-bg-panel px-1.5 py-1 font-mono text-[11.5px] text-text-secondary outline-none placeholder:text-text-muted/50 focus:border-border-glow"
                      />
                    ) : (
                      <select
                        value={p.rangeClassIri}
                        onChange={(e) => updateProp(i, { rangeClassIri: e.target.value })}
                        className="w-full rounded border border-border-hairline bg-bg-panel px-1 py-1 font-mono text-[11px] text-text-secondary outline-none"
                      >
                        <option value="">range…</option>
                        {parents.map((c) => (
                          <option key={c.iri} value={c.iri}>
                            {localName(c.iri)}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      value={p.cardinality}
                      onChange={(e) => updateProp(i, { cardinality: e.target.value })}
                      className="rounded border border-border-hairline bg-bg-panel px-1 py-1 font-mono text-[10.5px] text-text-secondary outline-none"
                    >
                      {CARDINALITIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Remove property"
                      onClick={() => setProps((rows) => rows.filter((_, j) => j !== i))}
                      className="rounded p-0.5 text-text-muted transition-colors hover:text-risk"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* generic error / auth gate */}
          {formError && !isConflict && !isParentError && (
            <p className="flex items-start gap-1.5 rounded-md border border-risk/40 bg-risk/10 px-3 py-2 text-[12px] text-risk">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {formError}
            </p>
          )}
          {unauthorized && (
            <div className="rounded-md border border-iris/40 bg-iris/10 px-3 py-2.5 text-[12.5px] text-text-secondary">
              <p className="mb-1.5">Editing the ontology requires an Ontologist session.</p>
              <Link
                to={LOGIN_PATH}
                className="inline-flex items-center gap-1.5 rounded-md bg-iris px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-iris-bright"
              >
                <LogIn className="size-3.5" /> Sign in to continue
              </Link>
            </div>
          )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border-hairline px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={createClass.isPending || !label.trim()}
            className="flex items-center gap-1.5 rounded-md bg-iris px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-50"
          >
            {createClass.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Create class
          </button>
      </div>
    </>
  );
}

export default NewClassDialog;
