import { useState, type HTMLAttributes } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ClassChip — like the shared IRIChip, but the prefix color is supplied
 * explicitly (DB prefixes such as `lgl` differ from the static prefix map,
 * so the module row's own color is the source of truth here).
 */
export interface ClassChipProps extends HTMLAttributes<HTMLSpanElement> {
  iri: string;
  color: string;
  definition?: string | null;
  deprecated?: boolean;
}

export function ClassChip({ iri, color, definition, deprecated, className, ...props }: ClassChipProps) {
  const [copied, setCopied] = useState(false);
  const [prefix, local] = iri.split(':');
  const fullIri = `https://ontos.acme.corp/ontology/${prefix}/${local}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullIri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span className={cn('group/iri relative inline-flex', className)}>
      <button
        type="button"
        onClick={copy}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border-hairline bg-bg-inset px-2 py-0.5',
          'font-mono text-[12px] leading-5 transition-colors duration-150',
          'hover:border-border-glow hover:bg-bg-panel-raised',
        )}
        {...props}
      >
        <span style={{ color }}>{prefix}:</span>
        <span className={cn('text-text-primary', deprecated && 'line-through opacity-60')}>{local}</span>
        {copied ? (
          <Check className="size-3 text-ok" aria-hidden />
        ) : (
          <Copy className="size-3 text-text-muted opacity-0 transition-opacity group-hover/iri:opacity-100" aria-hidden />
        )}
      </button>
      {(definition || deprecated) && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg',
            'border border-border-hairline bg-bg-panel-raised p-2.5 text-left font-sans text-[12px] leading-relaxed',
            'text-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover/iri:opacity-100',
          )}
        >
          {deprecated && <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-warn">deprecated</span>}
          {definition ?? 'No definition provided.'}
          <span className="mt-1 block truncate font-mono text-[10.5px] text-text-muted">{fullIri}</span>
        </span>
      )}
    </span>
  );
}
