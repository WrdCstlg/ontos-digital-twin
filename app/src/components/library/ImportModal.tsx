import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileUp, Loader2, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sniffOntology, type ImportParseResult, type LibraryModule } from './lib';

type Phase = 'idle' | 'parsing' | 'preview' | 'queued';

const ACCEPT = '.owl,.ttl,.jsonld,.rdf';

/**
 * ImportModal — drag-drop zone with format auto-detect, minimal client-side
 * parse preview (class/property counts), then a "queued for validation"
 * hand-off (server-side pySHACL validation is async in the demo).
 */
export function ImportModal({
  open,
  modules,
  onClose,
  onToast,
}: {
  open: boolean;
  modules: LibraryModule[];
  onClose: () => void;
  onToast: (msg: string, kind?: 'ok' | 'info') => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [mode, setMode] = useState<'new' | 'merge'>('new');
  const [mergeTarget, setMergeTarget] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase('idle');
    setFileName('');
    setParsed(null);
    setMode('new');
    setMergeTarget('');
    setDragOver(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setPhase('parsing');
    const text = await file.text().catch(() => '');
    /* brief beat so the indeterminate bar is visible */
    await new Promise((r) => setTimeout(r, 900));
    setParsed(sniffOntology(file.name, text));
    setPhase('preview');
  };

  const queueImport = () => {
    setPhase('queued');
    setTimeout(() => {
      onToast(
        mode === 'new'
          ? `Import queued for validation — ${fileName}`
          : `Merge queued for validation — ${fileName} → ${mergeTarget || modules[0]?.key}`,
        'info',
      );
      close();
    }, 1100);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="iscrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]"
          />
          <motion.div
            key="imodal"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-label="Import ontology"
            className="fixed left-1/2 top-1/2 z-[70] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-hairline bg-bg-panel-raised p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[18px] font-semibold text-text-primary">Import ontology</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-panel hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-text-secondary">
              Drop an OWL / Turtle / JSON-LD / RDF/XML file. Format is auto-detected; validation (pySHACL) runs async.
            </p>

            {/* drop zone */}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
              className={cn(
                'mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 transition-colors',
                dragOver ? 'border-iris bg-iris/10' : 'border-border-glow bg-bg-inset hover:border-iris/60',
              )}
            >
              <UploadCloud className={cn('size-8', dragOver ? 'text-iris-bright' : 'text-text-muted')} />
              <span className="text-[13px] font-medium text-text-primary">
                {fileName || 'Drop file here or click to browse'}
              </span>
              <span className="font-mono text-[10.5px] text-text-muted">accepts {ACCEPT.replaceAll(',', ' ')}</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = '';
              }}
            />

            {/* parsing progress */}
            {phase === 'parsing' && (
              <div className="mt-4">
                <div className="flex items-center gap-2 font-mono text-[11.5px] text-text-secondary">
                  <Loader2 className="size-3.5 animate-spin text-iris-bright" />
                  parsing {fileName}…
                </div>
                <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-bg-inset">
                  <motion.span
                    className="absolute inset-y-0 w-1/3 rounded-full bg-iris"
                    animate={{ x: ['-100%', '300%'] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
              </div>
            )}

            {/* parse preview */}
            {phase === 'preview' && parsed && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-4 space-y-4"
              >
                <div className="rounded-xl border border-border-hairline bg-bg-inset p-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-mono text-[12px] text-text-primary">
                      <FileUp className="size-3.5 text-text-muted" />
                      {fileName}
                    </span>
                    <span className="rounded border border-iris/40 bg-iris/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-accent">
                      {parsed.format}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    {[
                      ['classes', parsed.classes],
                      ['object props', parsed.objectProps],
                      ['datatype props', parsed.datatypeProps],
                      ['shapes', parsed.shapes],
                    ].map(([label, n]) => (
                      <div key={label as string} className="rounded-lg border border-border-hairline bg-bg-panel p-2">
                        <div className="font-mono text-[16px] font-medium tabular-nums text-text-primary">{n}</div>
                        <div className="mt-0.5 text-[9.5px] uppercase tracking-[0.06em] text-text-muted">{label}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 flex items-center gap-2 font-mono text-[10.5px] text-warn">
                    <span className="size-1.5 rounded-full bg-warn" />
                    pySHACL validation: will run on import (queued)
                  </p>
                </div>

                {/* mode radio */}
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border-hairline bg-bg-inset px-3.5 py-2.5 transition-colors has-[:checked]:border-iris/50 has-[:checked]:bg-iris/10">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={mode === 'new'}
                      onChange={() => setMode('new')}
                      className="accent-iris"
                    />
                    <span className="text-[12.5px] text-text-primary">Import as new module</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border-hairline bg-bg-inset px-3.5 py-2.5 transition-colors has-[:checked]:border-iris/50 has-[:checked]:bg-iris/10">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={mode === 'merge'}
                      onChange={() => setMode('merge')}
                      className="accent-iris"
                    />
                    <span className="text-[12.5px] text-text-primary">Merge into existing</span>
                    {mode === 'merge' && (
                      <select
                        value={mergeTarget || modules[0]?.key || ''}
                        onChange={(e) => setMergeTarget(e.target.value)}
                        className="ml-auto appearance-none rounded-md border border-border-hairline bg-bg-panel px-2 py-1 font-mono text-[11px] text-text-secondary outline-none"
                      >
                        {modules.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.key}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-border-hairline px-4 py-2 text-[12.5px] font-medium text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={queueImport}
                    className="rounded-lg bg-gradient-to-r from-iris-deep to-iris px-4 py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Queue import
                  </button>
                </div>
              </motion.div>
            )}

            {/* queued state */}
            {phase === 'queued' && (
              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
                <Loader2 className="size-4 animate-spin text-ok" />
                <span className="font-mono text-[12px] text-ok">queued for validation…</span>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
