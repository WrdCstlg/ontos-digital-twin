import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Crosshair, Loader2, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import type { CsvData } from './MappingEditor';

interface PreviewInstance {
  row: number;
  source: Record<string, string>;
  iri: string;
  label: string;
  classIri: string;
  props: Record<string, string>;
  triples: string;
}

export interface PreviewDrawerProps {
  open: boolean;
  csvData: CsvData | null;
  mappingId: number | null;
  mappingName: string | null;
  onClose: () => void;
  onLocateInMapping: () => void;
}

/** Colorize one Turtle block: subjects iris, prefixes module-colored, strings emerald. */
function TurtleBlock({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed">
      {text.split('\n').map((line, i) => {
        const stringMatch = line.match(/^(.*?)"([^"]*)"(.*)$/);
        return (
          <div key={i}>
            {stringMatch ? (
              <>
                <span className="text-text-accent">{stringMatch[1]}</span>
                <span className="text-ok">"{stringMatch[2]}"</span>
                <span className="text-text-muted">{stringMatch[3]}</span>
              </>
            ) : (
              <span className={line.trim().startsWith('ontos:') ? 'text-info' : 'text-text-accent'}>{line}</span>
            )}
          </div>
        );
      })}
    </pre>
  );
}

/** Fast typewriter (2ms/char) for the selected triple block. */
function useTypewriter(text: string, active: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, 2);
    return () => clearInterval(id);
  }, [text, active]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

export function PreviewDrawer({ open, csvData, mappingId, mappingName, onClose, onLocateInMapping }: PreviewDrawerProps) {
  const [selected, setSelected] = useState(0);

  const query = trpc.mapping.previewCsv.useQuery(
    { filename: csvData?.filename ?? 'upload.csv', csvText: csvData?.text ?? '', mappingId: mappingId ?? undefined },
    { enabled: open && !!csvData, retry: false },
  );

  const instances = useMemo(
    () => ((query.data?.instances ?? []) as PreviewInstance[]).slice(0, 5),
    [query.data],
  );
  const headers = query.data?.headers ?? [];

  useEffect(() => {
    if (open) setSelected(0);
  }, [open, csvData]);

  const current = instances[Math.min(selected, Math.max(0, instances.length - 1))];
  const { shown, done } = useTypewriter(current?.triples ?? '', open && !!current);

  // client-side SHACL-flavored validation: subject IRI + at least one property
  const violations = instances.filter((inst) => !inst.iri || inst.iri.includes('{}') || Object.keys(inst.props).length === 0);
  const conform = instances.length - violations.length;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-bg-void/60 backdrop-blur-sm"
            aria-hidden
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[40vh] flex-col border-t border-border-glow bg-bg-panel shadow-2xl"
            role="dialog"
            aria-label="Instance preview"
          >
            <div className="flex items-center gap-3 border-b border-border-hairline px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-text-primary">
                  Preview — first {instances.length} rows materialized
                </div>
                <div className="font-mono text-[10.5px] text-text-muted">
                  mapping: {mappingName ?? 'ad-hoc'} · file: {csvData?.filename ?? '—'} · no data written
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close preview"
                className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>

            {query.isLoading && (
              <div className="flex flex-1 items-center justify-center gap-2 font-mono text-[12px] text-text-muted">
                <Loader2 className="size-4 animate-spin" /> materializing preview…
              </div>
            )}
            {query.error && (
              <div className="flex flex-1 items-center justify-center px-8 text-center font-mono text-[12px] text-risk">
                {query.error.message}
              </div>
            )}

            {query.data && (
              <>
                <div className="grid min-h-0 flex-1 grid-cols-2">
                  {/* source rows */}
                  <div className="min-h-0 overflow-auto border-r border-border-hairline">
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-bg-panel">
                        <tr>
                          <th className="border-b border-border-hairline px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">#</th>
                          {headers.map((h) => (
                            <th key={h} className="border-b border-border-hairline px-3 py-1.5 font-mono text-[10px] font-medium text-text-muted">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {instances.map((inst, i) => (
                          <tr
                            key={inst.row}
                            onMouseEnter={() => setSelected(i)}
                            onClick={() => setSelected(i)}
                            className={cn(
                              'cursor-pointer transition-colors',
                              i === selected ? 'bg-ok/10' : 'hover:bg-bg-panel-raised/60',
                            )}
                          >
                            <td className="border-b border-border-hairline/50 px-3 py-1.5 font-mono text-[10.5px] text-text-muted">{inst.row}</td>
                            {headers.map((h) => (
                              <td key={h} className="max-w-32 truncate border-b border-border-hairline/50 px-3 py-1.5 font-mono text-[11px] text-text-secondary">
                                {inst.source[h] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* generated triples */}
                  <div className="min-h-0 overflow-auto bg-bg-inset p-4">
                    {current ? (
                      <>
                        <div className="mb-2 font-mono text-[10.5px] text-text-muted">
                          row {current.row} → <span className="text-text-accent">{current.iri}</span>
                          <span className="ml-2 text-text-muted">· a {current.classIri}</span>
                        </div>
                        <TurtleBlock text={shown} />
                        {!done && <span className="ml-0.5 inline-block h-3.5 w-2 animate-pulse bg-iris-bright align-middle" aria-hidden />}
                      </>
                    ) : (
                      <div className="font-mono text-[11.5px] text-text-muted">no instances parsed</div>
                    )}
                  </div>
                </div>

                {/* validation strip */}
                <div
                  className={cn(
                    'flex items-center gap-2.5 border-t px-5 py-2',
                    violations.length === 0 ? 'border-ok/30 bg-ok/10' : 'border-risk/30 bg-risk/10',
                  )}
                >
                  {violations.length === 0 ? (
                    <>
                      <ShieldCheck className="size-4 text-ok" />
                      <span className="font-mono text-[11.5px] text-ok">
                        pySHACL preview · {conform}/{instances.length} conform
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="size-4 text-risk" />
                      <span className="font-mono text-[11.5px] text-risk">
                        pySHACL preview · {violations.length} violation{violations.length > 1 ? 's' : ''} — rows{' '}
                        {violations.map((v) => v.row).join(', ')} (missing subject or properties)
                      </span>
                      <button
                        type="button"
                        onClick={onLocateInMapping}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-risk/40 px-2 py-0.5 font-mono text-[10.5px] text-risk transition-colors hover:bg-risk/10"
                      >
                        <Crosshair className="size-3" /> Locate in mapping
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
