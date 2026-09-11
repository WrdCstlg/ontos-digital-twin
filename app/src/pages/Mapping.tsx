import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Database, FileSpreadsheet, Globe, Loader2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';
import { Toaster } from '@/components/ui/sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ConnectorGrid } from '@/components/mapping/ConnectorGrid';
import { NewConnectorDialog } from '@/components/mapping/NewConnectorDialog';
import { MappingEditor, type CsvData } from '@/components/mapping/MappingEditor';
import { PreviewDrawer } from '@/components/mapping/PreviewDrawer';
import { SyncJobs } from '@/components/mapping/SyncJobs';
import { RdfStarBanner } from '@/components/mapping/RdfStarBanner';
import { AuthNotice } from '@/components/mapping/AuthNotice';
import type { ConnectorLike, MappingLike, SyncJobLike } from '@/components/mapping/utils';

type StatusFilter = 'all' | 'active' | 'error' | 'paused';

const PILLS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'error', label: 'Error' },
  { key: 'paused', label: 'Paused' },
];

function matchesStatus(conn: ConnectorLike, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return conn.status === 'connected';
  if (filter === 'error') return conn.status === 'error';
  return conn.status === 'draft';
}

export default function Mapping() {
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedConnectorId, setSelectedConnectorId] = useState<number | null>(null);
  const [wizard, setWizard] = useState<{ open: boolean; type?: 'csv' | 'sql' | 'rest' }>({ open: false });
  const [csvData, setCsvData] = useState<CsvData | null>(null);
  const [preview, setPreview] = useState<{ open: boolean; mappingId: number | null }>({ open: false, mappingId: null });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [runningMappingId, setRunningMappingId] = useState<number | null>(null);
  const uploadConnRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── queries ── */
  const connectorsQ = trpc.mapping.listConnectors.useQuery(undefined, { retry: 1 });
  const mappingsQ = trpc.mapping.listMappings.useQuery(undefined, { retry: 1 });
  const jobsQ = trpc.mapping.listSyncJobs.useQuery(
    { limit: 25 },
    {
      retry: 1,
      refetchInterval: (q) =>
        (q.state.data ?? []).some((j) => j.status === 'running') ? 2000 : false,
    },
  );

  const connectors = useMemo(() => (connectorsQ.data ?? []) as ConnectorLike[], [connectorsQ.data]);
  const mappings = useMemo(() => (mappingsQ.data ?? []) as unknown as MappingLike[], [mappingsQ.data]);
  const jobs = useMemo(() => (jobsQ.data ?? []) as unknown as SyncJobLike[], [jobsQ.data]);

  const filteredConnectors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return connectors.filter((c) => {
      if (!matchesStatus(c, statusFilter)) return false;
      if (!q) return true;
      const mappingNames = mappings.filter((m) => m.connectorId === c.id).map((m) => m.name).join(' ');
      return `${c.name} ${c.type} ${JSON.stringify(c.configJson ?? {})} ${mappingNames}`.toLowerCase().includes(q);
    });
  }, [connectors, mappings, search, statusFilter]);

  // default selection: first connector
  const selectedConnector =
    connectors.find((c) => c.id === selectedConnectorId) ?? connectors[0] ?? null;
  const selectedMappings = useMemo(
    () => mappings.filter((m) => m.connectorId === selectedConnector?.id),
    [mappings, selectedConnector],
  );

  /* ── run sync ── */
  const runSyncMutation = trpc.mapping.runSync.useMutation({
    onSuccess: async (res) => {
      setRunningMappingId(null);
      toast.success(`Sync complete — snapshot ${res.snapshot}`, {
        description: `${res.nodesUpserted} instances upserted · ${res.edgesCreated} edges created`,
      });
      if (res.shaclReport && !res.shaclReport.conforms) {
        toast.warning(`SHACL Validation: ${res.shaclReport.violationCount} issue(s) detected`, {
          description:
            res.shaclReport.signatureSummary?.[0]?.remediationAction ||
            "Check SHACL compliance report for remediation actions",
        });
      }
      await Promise.all([utils.mapping.listSyncJobs.invalidate(), utils.mapping.listMappings.invalidate()]);
    },
    onError: (err) => {
      setRunningMappingId(null);
      setMutationError(err.message);
    },
  });

  const runSync = (mappingId: number) => {
    setMutationError(null);
    setRunningMappingId(mappingId);
    runSyncMutation.mutate({ mappingId });
  };

  /* ── CSV upload (client-side read → previewCsv) ── */
  const requestCsvUpload = (connectorId: number) => {
    uploadConnRef.current = connectorId;
    fileRef.current?.click();
  };

  const onFileChosen = (f: File | undefined) => {
    if (!f) return;
    const connectorId = uploadConnRef.current ?? selectedConnector?.id ?? 0;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvData({ filename: f.name, text: String(reader.result ?? ''), connectorId });
      const m = mappings.find((x) => x.connectorId === connectorId);
      setPreview({ open: true, mappingId: m?.id ?? null });
    };
    reader.onerror = () => toast.error('Could not read file');
    reader.readAsText(f);
  };

  const queryError = connectorsQ.error ?? mappingsQ.error ?? jobsQ.error;

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <Toaster position="bottom-right" theme="dark" />

      {/* ── Section 1: header + toolbar ── */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-4"
      >
        <div>
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.02em] text-text-primary">
            Mapping &amp; Sync
          </h1>
          <p className="mt-1 max-w-2xl text-[14px] text-text-secondary">
            Declare how enterprise sources instantiate the ontology. Every edge knows its source, mapping, and timestamp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-64 flex-1 items-center gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-2 transition-colors focus-within:border-iris">
            <Search className="size-3.5 shrink-0 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter sources, mappings…"
              className="w-full bg-transparent font-mono text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border-hairline bg-bg-inset p-1">
            {PILLS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setStatusFilter(p.key)}
                className={cn(
                  'rounded-md px-3 py-1 text-[12px] transition-colors',
                  statusFilter === p.key
                    ? 'bg-bg-panel-raised text-text-primary'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-iris px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-iris-bright"
              >
                <Plus className="size-4" /> New connector
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 border-border-hairline bg-bg-panel-raised">
              <DropdownMenuItem onSelect={() => setWizard({ open: true, type: 'csv' })}>
                <FileSpreadsheet className="size-4 text-module-hr" />
                <span className="flex-1">CSV / Excel upload</span>
                <span className="font-mono text-[10px] uppercase text-text-muted">file</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setWizard({ open: true, type: 'rest' })}>
                <Globe className="size-4 text-module-logistics" />
                <span className="flex-1">REST API</span>
                <span className="font-mono text-[10px] uppercase text-text-muted">http</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setWizard({ open: true, type: 'sql' })}>
                <Database className="size-4 text-module-legal" />
                <span className="flex-1">SQL</span>
                <span className="font-mono text-[10px] uppercase text-text-muted">pg / mysql / mssql</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <AuthNotice message={mutationError} isAuthenticated={isAuthenticated} onDismiss={() => setMutationError(null)} />
      </motion.header>

      {/* ── Section 6 banner (top placement keeps it visible) ── */}
      <RdfStarBanner />

      {queryError && (
        <div className="rounded-xl border border-risk/30 bg-risk/10 px-4 py-3 font-mono text-[12px] text-risk">
          Failed to load mapping data: {queryError.message}
        </div>
      )}

      {/* ── Section 2: connector cards ── */}
      {connectorsQ.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-border-hairline bg-bg-panel" />
          ))}
        </div>
      ) : filteredConnectors.length === 0 && connectors.length > 0 ? (
        <div className="rounded-xl border border-dashed border-border-hairline bg-bg-panel/40 px-6 py-10 text-center text-[13px] text-text-muted">
          No connectors match “{search}” with filter {statusFilter}.
        </div>
      ) : (
        <ConnectorGrid
          connectors={filteredConnectors}
          mappings={mappings}
          jobs={jobs}
          selectedId={selectedConnector?.id ?? null}
          onOpenMapping={(id) => setSelectedConnectorId(id)}
          onNewConnector={() => setWizard({ open: true })}
          onUploadCsv={requestCsvUpload}
          onRunNow={runSync}
          runningMappingId={runningMappingId}
        />
      )}

      {/* ── Section 3: mapping editor ── */}
      {mappingsQ.isLoading ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-border-hairline bg-bg-panel font-mono text-[12px] text-text-muted">
          <Loader2 className="mr-2 size-4 animate-spin" /> loading mappings…
        </div>
      ) : (
        <MappingEditor
          connector={selectedConnector}
          mappings={selectedMappings}
          csvData={csvData}
          onRequestCsvUpload={() => selectedConnector && requestCsvUpload(selectedConnector.id)}
          onPreview={(mappingId) => setPreview({ open: true, mappingId })}
          onRunSync={runSync}
          runningMappingId={runningMappingId}
          onError={setMutationError}
        />
      )}

      {/* ── Section 5: sync jobs & provenance ── */}
      <SyncJobs jobs={jobs} isLoading={jobsQ.isLoading} />

      {/* ── Section 4: preview drawer ── */}
      <PreviewDrawer
        open={preview.open && csvData != null}
        csvData={csvData}
        mappingId={preview.mappingId}
        mappingName={mappings.find((m) => m.id === preview.mappingId)?.name ?? null}
        onClose={() => setPreview((p) => ({ ...p, open: false }))}
        onLocateInMapping={() => setPreview((p) => ({ ...p, open: false }))}
      />

      {/* new connector wizard */}
      <NewConnectorDialog
        open={wizard.open}
        onOpenChange={(open) => setWizard((w) => ({ ...w, open }))}
        initialType={wizard.type}
        onCreated={() => toast.success('Connector created')}
        onError={setMutationError}
      />

      {/* hidden CSV file input for upload+preview flow */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          onFileChosen(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
