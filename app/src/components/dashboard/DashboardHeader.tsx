import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, RefreshCw, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useAuth } from '@/hooks/useAuth';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Toast {
  id: number;
  message: string;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Dashboard §1 — time-aware greeting, workspace meta (real snapshot/module
 * counts from trpc.dashboard.overview) and sync action with slide-in toast.
 */
export function DashboardHeader() {
  const { user } = useAuth();
  const overview = trpc.dashboard.overview.useQuery();
  const connectors = trpc.mapping.listConnectors.useQuery();
  const [running, setRunning] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const pushToast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const runSync = () => {
    if (running) return;
    setRunning(true);
    const n = connectors.data?.length ?? 0;
    pushToast(
      n > 0
        ? `Incremental sync started — ${n} source${n === 1 ? '' : 's'} queued`
        : 'Incremental sync started — sources queued',
    );
    window.setTimeout(() => setRunning(false), 2400);
  };

  const firstName = user?.name?.split(' ')[0] ?? 'Amara';
  const ws = overview.data?.workspace;
  const kpis = overview.data?.kpis;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Workspace{' '}
            <span className="font-medium text-text-primary">{ws?.name ?? '…'}</span>
            {' · '}
            {kpis ? `${kpis.modulesActive} modules active` : '…'}
            {' · graph snapshot '}
            <span className="font-mono text-text-accent">{kpis?.snapshot?.label ?? '…'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={runSync}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-lg border border-border-hairline px-3.5 py-2 text-[14px] text-text-secondary transition-colors duration-150 hover:border-border-glow hover:text-text-primary disabled:opacity-70"
          >
            <RefreshCw className={running ? 'size-4 animate-spin' : 'size-4'} />
            {running ? 'Sync queued…' : 'Run sync now'}
          </button>
          <button
            type="button"
            onClick={() => pushToast('Workspace creation is disabled in this evaluation workspace')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3.5 py-2 text-[14px] font-medium text-white transition-transform duration-150 hover:scale-[1.02]"
          >
            <Plus className="size-4" />
            New workspace
          </button>
        </div>
      </motion.div>

      {/* Toasts — slide in top-right (x 24→0, 250ms) */}
      <div className="pointer-events-none fixed right-5 top-16 z-50 flex w-[340px] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border-hairline bg-bg-panel-raised px-3.5 py-3 shadow-xl"
            >
              <RefreshCw className="mt-0.5 size-3.5 shrink-0 animate-spin text-iris-bright [animation-duration:1.8s]" />
              <span className="flex-1 font-mono text-[12px] leading-5 text-text-secondary">{t.message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
                className="text-text-muted transition-colors hover:text-text-primary"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
