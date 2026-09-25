import { useEffect, useId, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { getModule } from '@/lib/modules';
import { badgeModule } from './links';

const IRI_TEXT = /^[A-Za-z][\w.+-]*:\S+$/;

export interface ObjectPickerProps {
  /** The class the object must be (or be a subclass of). */
  classIri: string;
  /** The chosen object's IRI, or "" for none. */
  value: string;
  onChange: (iri: string) => void;
  /** id of the visible label, for the search box's accessible name. */
  labelledBy?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * Searchable object picker for an action's object parameter: searches the
 * graph for objects of the parameter's class and its subclasses. An IRI can
 * also be pasted and taken as is; the API checks it when previewing.
 */
export function ObjectPicker({ classIri, value, onChange, labelledBy, invalid, disabled }: ObjectPickerProps) {
  const listId = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  // The label of the object last picked from the list, so a pick needs no second lookup.
  const [picked, setPicked] = useState<{ iri: string; label: string; moduleKey: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);

  const searchQ = trpc.graph.searchNodes.useQuery(
    { q: debounced, classIri, limit: 12 },
    { enabled: open && debounced.length > 0, staleTime: 30_000, placeholderData: (prev) => prev },
  );

  // A value that arrived without a pick (a deep link, or a pasted IRI): look it up for its label.
  const known = picked && picked.iri === value ? picked : null;
  const resolveQ = trpc.graph.searchNodes.useQuery(
    { q: value, classIri, limit: 5 },
    { enabled: !!value && !known && value.length <= 255, staleTime: 60_000, retry: false },
  );
  const found = resolveQ.data?.find((n) => n.iri === value);
  const selected = known ?? (found ? { iri: found.iri, label: found.label, moduleKey: found.moduleKey } : null);

  const choose = (n: { iri: string; label: string; moduleKey: string }) => {
    setPicked(n);
    onChange(n.iri);
    setText('');
    setDebounced('');
    setOpen(false);
  };

  if (value) {
    const color = getModule(badgeModule(selected?.moduleKey)).color;
    return (
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-md border bg-bg-inset px-2.5 py-1.5',
          invalid ? 'border-risk/60' : 'border-border-hairline',
        )}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-text-primary">
            {selected?.label ?? (resolveQ.isLoading ? 'looking it up…' : value)}
          </span>
          <span className="block truncate font-mono text-[10.5px] text-text-muted" title={value}>
            {value}
            {!selected && !resolveQ.isLoading && ` · not found as ${classIri}; the preview checks it`}
          </span>
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              onChange('');
            }}
            aria-label="Clear the chosen object"
            className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  const results = searchQ.data ?? [];
  const showList = open && debounced.length > 0;
  const takeTyped = () => {
    const t = text.trim();
    if (IRI_TEXT.test(t) && t.includes('/')) {
      onChange(t);
      setText('');
      setOpen(false);
    } else if (results.length === 1) {
      choose(results[0]);
    }
  };

  return (
    <div
      className="relative"
      // Close when focus leaves the picker, not when it moves from the box to a result.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border bg-bg-inset px-2.5 focus-within:border-border-glow',
          invalid ? 'border-risk/60' : 'border-border-hairline',
        )}
      >
        <Search className="size-3.5 shrink-0 text-text-muted" aria-hidden />
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-labelledby={labelledBy}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              takeTyped();
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={`Search ${classIri} by name or IRI…`}
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted disabled:opacity-50"
        />
        {searchQ.isFetching && <Loader2 className="size-3.5 shrink-0 animate-spin text-iris-bright" aria-hidden />}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border-hairline bg-bg-panel-raised py-1 shadow-xl"
        >
          {results.length === 0 && !searchQ.isFetching && (
            <li className="px-3 py-2.5 font-mono text-[11px] text-text-muted">
              no {classIri} matches “{debounced}”
              {IRI_TEXT.test(debounced) && debounced.includes('/') && ' · press Enter to use this IRI'}
            </li>
          )}
          {results.map((n) => (
            <li key={n.id} role="option" aria-selected={false}>
              <button
                type="button"
                // Keep focus in the box on a mouse press; the click then chooses.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(n)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-panel"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: getModule(badgeModule(n.moduleKey)).color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-text-primary">{n.label}</span>
                  <span className="block truncate font-mono text-[10px] text-text-muted">{n.iri}</span>
                </span>
                <span className="hidden shrink-0 font-mono text-[9.5px] text-text-muted sm:inline">{n.classIri}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
