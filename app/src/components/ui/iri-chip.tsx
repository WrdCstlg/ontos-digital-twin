import { useState, type HTMLAttributes } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { moduleForPrefix } from '@/lib/modules';

export interface IRIChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Compact IRI, e.g. "hr:Person" */
  iri: string;
  /** Optional definition shown in the hover tooltip */
  definition?: string;
  /** Base IRI used when copying the full IRI */
  baseIri?: string;
}

/**
 * IRIChip — mono `prefix:LocalName` with the prefix rendered in the owning
 * module's color. Click/hover copies the full IRI; tooltip shows definition.
 */
export function IRIChip({
  iri,
  definition,
  baseIri = 'https://ontos.acme.corp/ontology/',
  className,
  ...props
}: IRIChipProps) {
  const [copied, setCopied] = useState(false);
  const [prefix, local] = iri.split(':');
  const mod = moduleForPrefix(prefix ?? '');
  const fullIri = `${baseIri}${prefix}/${local}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullIri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <span className={cn('group/iri relative inline-flex', className)}>
      <button
        type="button"
        onClick={copy}
        title={definition ? `${fullIri} — ${definition}` : fullIri}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border-hairline bg-bg-inset px-2 py-0.5',
          'font-mono text-[12px] leading-5 transition-colors duration-150',
          'hover:border-border-glow hover:bg-bg-panel-raised',
        )}
        {...props}
      >
        <span style={{ color: mod.color }}>{prefix}:</span>
        <span className="text-text-primary">{local}</span>
        {copied ? (
          <Check className="size-3 text-ok" aria-hidden />
        ) : (
          <Copy className="size-3 text-text-muted opacity-0 transition-opacity group-hover/iri:opacity-100" aria-hidden />
        )}
      </button>
      {definition && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg',
            'border border-border-hairline bg-bg-panel-raised p-2.5 text-left font-sans text-[12px] leading-relaxed',
            'text-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover/iri:opacity-100',
          )}
        >
          {definition}
          <span className="mt-1 block truncate font-mono text-[10.5px] text-text-muted">{fullIri}</span>
        </span>
      )}
    </span>
  );
}
