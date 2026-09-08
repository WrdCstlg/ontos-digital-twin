import { useEffect, useState } from 'react';
import { Check, Copy, FileDown } from 'lucide-react';
import { downloadText, type StudioModule } from './studio-utils';

/* session-scope: the typewriter intro plays once per page session */
let typewriterPlayed = false;

export interface TurtleViewProps {
  module: StudioModule;
  content: string | undefined;
  loading: boolean;
  error: string | null;
}

/**
 * TurtleView — read-only Turtle serialization of the module in a CodeBlock
 * style well. The serialization types in (fast) the first time the tab is
 * opened per session, then renders instantly.
 */
export function TurtleView({ module, content, loading, error }: TurtleViewProps) {
  const [typed, setTyped] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!content || typewriterPlayed) return;
    typewriterPlayed = true;
    let i = 0;
    // adaptive chunk so the whole document types in ~1.8s regardless of size
    const chunk = Math.max(4, Math.ceil(content.length / 450));
    const timer = setInterval(() => {
      i += chunk;
      if (i >= content.length) {
        setTyped(content);
        clearInterval(timer);
      } else {
        setTyped(content.slice(0, i));
      }
    }, 4);
    return () => clearInterval(timer);
  }, [content]);

  const shown = typed ?? content ?? '';
  const done = !!content && shown.length >= content.length;
  const lines = shown.split('\n');

  const copy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-inset">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-hairline px-4">
        <span className="font-mono text-[11px] text-text-muted">
          {module.prefix}-module.ttl · v{module.version} · read-only
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={copy}
            disabled={!content}
            className="flex items-center gap-1 rounded-md border border-border-hairline px-2 py-1 text-[11.5px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
          >
            {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
            Copy
          </button>
          <button
            type="button"
            onClick={() => content && downloadText(`${module.key}-v${module.version}.ttl`, content, 'text/turtle')}
            disabled={!content}
            className="flex items-center gap-1 rounded-md border border-iris/40 bg-iris/10 px-2 py-1 text-[11.5px] text-text-accent transition-colors hover:bg-iris/20 disabled:opacity-50"
          >
            <FileDown className="size-3" /> Export .ttl
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-4 font-mono text-[12px] text-text-muted">serializing module…</p>
        ) : error ? (
          <p className="p-4 text-[13px] text-risk">{error}</p>
        ) : (
          <pre className="flex p-4 font-mono text-[12px] leading-relaxed">
            <span aria-hidden className="select-none pr-4 text-right text-text-muted/50">
              {lines.map((_, i) => (
                <span key={i} className="block">
                  {i + 1}
                </span>
              ))}
            </span>
            <code className="text-text-secondary">
              {shown}
              {!done && <span className="animate-caret-blink text-iris">▍</span>}
            </code>
          </pre>
        )}
      </div>

      <div className="shrink-0 border-t border-border-hairline px-4 py-1.5 text-[11px] text-text-muted">
        Generated — the UI is the editor. Raw files are never edited directly.
      </div>
    </div>
  );
}

export default TurtleView;
