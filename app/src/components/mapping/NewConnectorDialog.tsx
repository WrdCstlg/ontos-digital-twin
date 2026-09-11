import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Database, FileSpreadsheet, Globe, Loader2, PlugZap, Upload } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { parseCsvHead } from './utils';

type ConnType = 'csv' | 'sql' | 'rest';

const TYPE_CARDS: { type: ConnType; icon: typeof Database; title: string; desc: string; tag: string }[] = [
  { type: 'csv', icon: FileSpreadsheet, title: 'CSV / Excel upload', desc: 'Inline file data, scheduled or manual sync', tag: 'file' },
  { type: 'rest', icon: Globe, title: 'REST API', desc: 'Poll or webhook-triggered extraction', tag: 'http' },
  { type: 'sql', icon: Database, title: 'SQL database', desc: 'PostgreSQL · MySQL · SQL Server, CDC capable', tag: 'jdbc' },
];

interface Suggestion {
  column: string;
  property: string | null;
}

export interface NewConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: ConnType;
  onCreated: () => void;
  onError: (message: string) => void;
}

/** 3-step new-connector wizard: type → connection form → initial mapping suggestion. */
export function NewConnectorDialog({ open, onOpenChange, initialType, onCreated, onError }: NewConnectorDialogProps) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState<ConnType>(initialType ?? 'csv');
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('postgresql');
  const [host, setHost] = useState('');
  const [database, setDatabase] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [auth, setAuth] = useState('oauth2-client-credentials');
  const [csv, setCsv] = useState<{ filename: string; text: string } | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const createMutation = trpc.mapping.createConnector.useMutation({
    onSuccess: async () => {
      await utils.mapping.listConnectors.invalidate();
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => onError(err.message),
  });

  const hrProps = trpc.ontology.listProperties.useQuery(
    { moduleKey: 'hr' },
    { enabled: open && step === 2 && type === 'csv', staleTime: 60_000 },
  );

  // reset when opened
  const [prevOpen, setPrevOpen] = useState(open);
  if (!prevOpen && open) {
    setPrevOpen(open);
    setStep(0);
    setType(initialType ?? 'csv');
    setName('');
    setHost('');
    setDatabase('');
    setBaseUrl('');
    setCsv(null);
    setTestState('idle');
    setSuggestions([]);
  } else if (prevOpen && !open) {
    setPrevOpen(open);
  }

  const valid =
    name.trim().length > 0 &&
    (type === 'csv' ? csv != null : type === 'sql' ? host.trim().length > 0 && database.trim().length > 0 : baseUrl.trim().length > 0);

  const runTest = () => {
    if (!valid) {
      setTestState('fail');
      return;
    }
    setTestState('testing');
    // demo simulator: validate inputs client-side, pulse, then report
    setTimeout(() => setTestState(valid ? 'ok' : 'fail'), 900);
  };

  const toStep3 = () => {
    if (type === 'csv' && csv) {
      const { headers } = parseCsvHead(csv.text, 1);
      const props = hrProps.data ?? [];
      setSuggestions(
        headers.map((col) => {
          const norm = col.toLowerCase().replace(/[^a-z0-9]/g, '');
          const hit = props.find((p) => {
            const local = p.iri.split(':')[1]?.toLowerCase() ?? '';
            return local === norm || local.includes(norm) || (norm.length > 3 && norm.includes(local));
          });
          return { column: col, property: hit?.iri ?? null };
        }),
      );
    }
    setStep(2);
  };

  const create = () => {
    const config: Record<string, unknown> =
      type === 'csv'
        ? { filename: csv!.filename, rows: parseCsvHead(csv!.text, 1_000_000).rows.length, csvText: csv!.text }
        : type === 'sql'
          ? { driver, host, database, mode: 'poll' }
          : { baseUrl, auth };
    createMutation.mutate({ name: name.trim(), type, config, status: testState === 'ok' ? 'connected' : 'draft' });
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv({ filename: f.name, text: String(reader.result ?? '') });
      if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
      setTestState('idle');
    };
    reader.readAsText(f);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border-hairline bg-bg-panel sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-text-primary">New connector</DialogTitle>
          <DialogDescription className="text-text-muted">
            Step {step + 1} of 3 — {step === 0 ? 'choose a source type' : step === 1 ? 'connection details' : 'initial mapping suggestion'}
          </DialogDescription>
        </DialogHeader>

        {/* step indicator */}
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((s) => (
            <span key={s} className={cn('h-1 flex-1 rounded-full transition-colors', s <= step ? 'bg-iris' : 'bg-border-hairline')} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="s0"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
              className="grid gap-2.5"
            >
              {TYPE_CARDS.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  onClick={() => setType(c.type)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors',
                    type === c.type
                      ? 'border-iris/60 bg-iris/10'
                      : 'border-border-hairline bg-bg-inset hover:border-border-glow',
                  )}
                >
                  <c.icon className={cn('size-5 shrink-0', type === c.type ? 'text-text-accent' : 'text-text-muted')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-text-primary">{c.title}</span>
                    <span className="block truncate text-[12px] text-text-muted">{c.desc}</span>
                  </span>
                  <span className="rounded border border-border-hairline bg-bg-panel px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-muted">
                    {c.tag}
                  </span>
                  {type === c.type && <Check className="size-4 shrink-0 text-iris-bright" />}
                </button>
              ))}
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="s1"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
              className="grid gap-3"
            >
              <div className="grid gap-1.5">
                <Label htmlFor="nc-name" className="text-text-secondary">Connector name</Label>
                <Input
                  id="nc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. HRIS Export"
                  className="border-border-hairline bg-bg-inset"
                />
              </div>

              {type === 'csv' && (
                <div className="grid gap-1.5">
                  <Label className="text-text-secondary">File</Label>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2.5 rounded-lg border border-dashed border-border-glow bg-bg-inset px-3.5 py-3 text-left text-[13px] text-text-muted transition-colors hover:border-iris/60 hover:text-text-secondary"
                  >
                    <Upload className="size-4 shrink-0" />
                    {csv ? (
                      <span className="font-mono text-[12px] text-text-primary">
                        {csv.filename} · {parseCsvHead(csv.text, 1_000_000).rows.length} rows
                      </span>
                    ) : (
                      'Choose a .csv file — data is stored inline for the demo sync engine'
                    )}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </div>
              )}

              {type === 'sql' && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="nc-driver" className="text-text-secondary">Driver</Label>
                    <select
                      id="nc-driver"
                      value={driver}
                      onChange={(e) => setDriver(e.target.value)}
                      className="h-9 rounded-md border border-border-hairline bg-bg-inset px-2.5 font-mono text-[12.5px] text-text-primary"
                    >
                      <option value="postgresql">PostgreSQL</option>
                      <option value="mysql">MySQL</option>
                      <option value="sqlserver">SQL Server</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="nc-host" className="text-text-secondary">Host</Label>
                      <Input id="nc-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="db.acme.corp" className="border-border-hairline bg-bg-inset font-mono text-[12.5px]" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="nc-db" className="text-text-secondary">Database</Label>
                      <Input id="nc-db" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="contracts" className="border-border-hairline bg-bg-inset font-mono text-[12.5px]" />
                    </div>
                  </div>
                </>
              )}

              {type === 'rest' && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="nc-url" className="text-text-secondary">Base URL</Label>
                    <Input id="nc-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://erp.acme.corp/api/v2" className="border-border-hairline bg-bg-inset font-mono text-[12.5px]" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="nc-auth" className="text-text-secondary">Auth</Label>
                    <select
                      id="nc-auth"
                      value={auth}
                      onChange={(e) => setAuth(e.target.value)}
                      className="h-9 rounded-md border border-border-hairline bg-bg-inset px-2.5 font-mono text-[12.5px] text-text-primary"
                    >
                      <option value="oauth2-client-credentials">OAuth2 client credentials</option>
                      <option value="bearer">Bearer token</option>
                      <option value="api-key">API key</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={runTest}
                  disabled={testState === 'testing'}
                  className="inline-flex items-center gap-2 rounded-md border border-border-glow px-3 py-1.5 text-[12.5px] text-text-secondary transition-colors hover:bg-bg-panel-raised disabled:opacity-60"
                >
                  {testState === 'testing' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                  Test connection
                </button>
                <AnimatePresence>
                  {testState === 'ok' && (
                    <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1.5 font-mono text-[11.5px] text-ok">
                      <Check className="size-3.5" /> reachable · credentials accepted
                    </motion.span>
                  )}
                  {testState === 'fail' && (
                    <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="font-mono text-[11.5px] text-risk">
                      missing required fields
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="s2"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
              className="grid gap-3"
            >
              {type === 'csv' && csv ? (
                <>
                  <p className="text-[12.5px] text-text-muted">
                    Columns auto-matched to <span className="font-mono text-module-hr">hr:</span> properties by name. You can refine
                    everything in the mapping editor after creation.
                  </p>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-border-hairline bg-bg-inset">
                    {suggestions.map((s) => (
                      <div key={s.column} className="flex items-center justify-between border-b border-border-hairline/60 px-3 py-1.5 last:border-0">
                        <span className="font-mono text-[12px] text-text-primary">{s.column}</span>
                        {s.property ? (
                          <motion.span
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded border border-iris/40 bg-iris/15 px-1.5 py-0.5 font-mono text-[11px] text-text-accent"
                          >
                            → {s.property}
                          </motion.span>
                        ) : (
                          <span className="font-mono text-[11px] text-text-muted">→ no match</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="rounded-lg border border-border-hairline bg-bg-inset px-3.5 py-3 text-[12.5px] text-text-muted">
                  Schema discovery for {type.toUpperCase()} sources runs on first sync in this demo build. Create the connector,
                  then declare the mapping in the editor.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-text-muted transition-colors hover:text-text-primary disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" /> Back
          </button>
          {step < 2 ? (
            <button
              type="button"
              onClick={() => (step === 1 ? toStep3() : setStep(1))}
              disabled={step === 1 && !valid}
              className="inline-flex items-center gap-1 rounded-md bg-iris px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-40"
            >
              Continue <ChevronRight className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={create}
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-iris px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-60"
            >
              {createMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Create connector
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
