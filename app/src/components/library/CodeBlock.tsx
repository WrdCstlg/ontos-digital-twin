import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * CodeBlock — inset well with mono text, hairline border, copy button.
 * Used for SHACL Turtle, sample instance JSON and doc snippets.
 */
export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  };
  return (
    <div className={cn('group/code relative overflow-hidden rounded-lg border border-border-hairline bg-bg-inset', className)}>
      {lang && (
        <span className="absolute right-2 top-2 rounded border border-border-hairline bg-bg-panel px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
          {lang}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className={cn(
          'absolute bottom-2 right-2 rounded-md border border-border-hairline bg-bg-panel p-1.5 text-text-muted',
          'opacity-0 transition-opacity hover:text-text-primary group-hover/code:opacity-100',
        )}
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto p-3.5 font-mono text-[11.5px] leading-relaxed text-text-secondary">
        <code>{code}</code>
      </pre>
    </div>
  );
}
