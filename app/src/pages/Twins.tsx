import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { trpc } from '@/providers/trpc';
import { Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DisclosureChip } from '@/components/twins/DisclosureChip';
import { TickControl } from '@/components/twins/TickControl';
import { TwinRegistry } from '@/components/twins/TwinRegistry';
import { TwinDetail } from '@/components/twins/TwinDetail';
import { EventLog } from '@/components/twins/EventLog';
import { IotConnectorsModal } from '@/components/twins/IotConnectorsModal';
import type { LogEntry, TickResult, TwinGroup } from '@/components/twins/meta';

/** Max twins whose cards flash per tick — the 8–10 concurrent-animation guardrail. */
const FLASH_CAP = 8;
/** Log lines kept per tick before a summary line takes over. */
const LOG_PER_TICK = 40;
const LOG_CAP = 120;

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

export default function Twins() {
  const utils = trpc.useUtils();

  /* ── registry state ─────────────────────────────────────────── */
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const list = trpc.twin.listTwins.useQuery(
    debounced ? { q: debounced, limit: 500 } : { limit: 500 },
    { refetchOnWindowFocus: false },
  );

  /* ── detail state ───────────────────────────────────────────── */
  const [selectedIri, setSelectedIri] = useState<string | null>(null);
  const [iotModalOpen, setIotModalOpen] = useState(false);
  const iotConnectors = trpc.iot.listConnectors.useQuery();

  /* ── live pulse ─────────────────────────────────────────────── */
  const [tickCount, setTickCount] = useState(0);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [autoTick, setAutoTick] = useState(false);
  const [changedByTwin, setChangedByTwin] = useState<Map<string, Set<string>>>(new Map());
  const [log, setLog] = useState<LogEntry[]>([]);

  const selectedRef = useRef(selectedIri);
  useEffect(() => {
    selectedRef.current = selectedIri;
  }, [selectedIri]);
  const tickCountRef = useRef(0);

  const handleTick = useCallback(
    (res: TickResult) => {
      tickCountRef.current += 1;
      const tickNo = tickCountRef.current;
      setTickCount(tickNo);
      setLastTickAt(res.tickedAt);

      // flash map — selected twin always flashes; others capped (guardrail)
      const flash = new Map<string, Set<string>>();
      let flashed = 0;
      for (const t of res.twins) {
        const keys = new Set(t.changes.map((c) => c.key).filter((k) => k !== 'lastTickAt'));
        if (!keys.size) continue;
        if (t.iri === selectedRef.current) {
          flash.set(t.iri, keys);
        } else if (flashed < FLASH_CAP) {
          flash.set(t.iri, keys);
          flashed++;
        }
      }
      setChangedByTwin(flash);

      // event log — skip lastTickAt noise, truncate with a summary line
      const entries: LogEntry[] = [];
      let skipped = 0;
      for (const t of res.twins) {
        for (const c of t.changes) {
          if (c.key === 'lastTickAt') continue;
          if (entries.length >= LOG_PER_TICK) {
            skipped++;
            continue;
          }
          entries.push({
            id: `${tickNo}-${t.iri}-${c.key}-${entries.length}`,
            at: res.tickedAt,
            tickNo,
            iri: t.iri,
            label: t.label.replace(/^Twin — /, ''),
            key: c.key,
            oldV: c.old,
            newV: c.new,
            kind: c.key === 'status' ? 'status' : 'value',
          });
        }
      }
      if (skipped > 0) {
        entries.push({
          id: `${tickNo}-more`,
          at: res.tickedAt,
          tickNo,
          iri: '',
          label: `+${skipped} more changes`,
          key: '',
          oldV: '',
          newV: '',
          kind: 'value',
        });
      }
      setLog((prev) => [...entries, ...prev].slice(0, LOG_CAP));

      // refetch live state (batched via httpBatchLink)
      void utils.twin.listTwins.invalidate();
      void utils.twin.getTwin.invalidate();
      void utils.twin.getStateHistory.invalidate();
    },
    [utils],
  );

  const tick = trpc.twin.tick.useMutation({
    onSuccess: handleTick,
    onError: (err) => toast.error(`tick failed — ${err.message}`),
  });

  const doTick = useCallback(() => {
    if (!tick.isPending) tick.mutate({});
  }, [tick]);

  const tickRef = useRef(doTick);
  useEffect(() => {
    tickRef.current = doTick;
  }, [doTick]);

  useEffect(() => {
    if (!autoTick) return;
    const iv = setInterval(() => tickRef.current(), 2000);
    return () => clearInterval(iv);
  }, [autoTick]);

  const changedForDetail = selectedIri ? (changedByTwin.get(selectedIri) ?? new Set<string>()) : new Set<string>();

  return (
    <div className="-m-6 flex h-[calc(100dvh-3.5rem)] flex-col gap-4 p-6 lg:-m-8 lg:p-6">
      <Toaster position="bottom-right" theme="dark" />

      {/* Section 1 — page header (persistent) */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-wrap items-end gap-x-6 gap-y-3"
      >
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-module-twin">
            Digital Twin module · DTDL v3 · prefix dtwin:
          </div>
          <h1 className="mt-1 font-display text-[32px] font-semibold leading-none tracking-[-0.02em] text-text-primary">
            Twin Explorer
          </h1>
          <p className="mt-1.5 text-[13px] text-text-secondary">
            Simulated live twins mirroring physical logistics &amp; facilities assets in the knowledge graph.
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 + i * 0.06, ease: EASE }}
            >
              <DisclosureChip variant={i === 0 ? 'simulated' : 'dtdl'} />
            </motion.span>
          ))}
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.27, ease: EASE }}
            className="flex items-center gap-2"
          >
            <Button
              size="sm"
              variant="outline"
              className="gap-2 h-9 border-border bg-card/60 hover:bg-card text-xs font-medium"
              onClick={() => setIotModalOpen(true)}
            >
              <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
              IoT Brokers
              {iotConnectors.data && iotConnectors.data.filter((c) => c.status === 'connected').length > 0 && (
                <span className="ml-0.5 inline-flex items-center px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400">
                  {iotConnectors.data.filter((c) => c.status === 'connected').length}
                </span>
              )}
            </Button>
            <TickControl
              tickCount={tickCount}
              lastTickAt={lastTickAt}
              autoTick={autoTick}
              onAutoTickChange={setAutoTick}
              onTick={doTick}
              ticking={tick.isPending}
            />
          </motion.span>
        </div>
      </motion.header>

      {/* Registry ⇄ Detail states */}
      <AnimatePresence mode="wait" initial={false}>
        {selectedIri ? (
          <motion.div
            key={`detail-${selectedIri}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TwinDetail
              iri={selectedIri}
              tickId={tickCount}
              changedKeys={changedForDetail}
              onBack={() => setSelectedIri(null)}
              onSelectTwin={setSelectedIri}
            />
          </motion.div>
        ) : (
          <motion.div
            key="registry"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TwinRegistry
              groups={(list.data?.groups ?? []) as unknown as TwinGroup[]}
              loading={list.isLoading}
              error={list.isError ? list.error.message : null}
              onRetry={() => void list.refetch()}
              search={search}
              onSearchChange={setSearch}
              tickId={tickCount}
              changedByTwin={changedByTwin}
              onSelect={setSelectedIri}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Section 5 — live pulse event log */}
      <EventLog entries={log} autoTick={autoTick} tickCount={tickCount} onSelect={(iri) => iri && setSelectedIri(iri)} />

      {/* IoT Brokers & Telemetry Management Modal */}
      <IotConnectorsModal
        open={iotModalOpen}
        onOpenChange={setIotModalOpen}
        onTelemetryIngested={() => void list.refetch()}
      />
    </div>
  );
}
