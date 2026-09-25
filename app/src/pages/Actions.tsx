import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, MousePointerClick, Plus, RefreshCw, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { Catalogue } from '@/components/actions/Catalogue';
import { ActionPanel } from '@/components/actions/ActionPanel';
import { ActionTypeEditor } from '@/components/actions/ActionTypeEditor';
import { SubmissionHistory, type SubmissionFilter } from '@/components/actions/SubmissionHistory';
import { SubmissionDetailSheet } from '@/components/actions/SubmissionDetail';
import { useCanAuthorActions } from '@/components/actions/useCanAuthor';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const HISTORY_LIMIT = 50;

/** Below the lg breakpoint the panel sits under the catalogue; bring it into view when it opens. */
function scrollIntoViewOnNarrow(el: HTMLElement | null) {
  if (!el || !window.matchMedia?.('(max-width: 1023px)').matches) return;
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/**
 * Actions — /app/actions. Action types are named, parameterised edits to the
 * graph (like Foundry's action types): a catalogue by module, a run panel
 * with preview and submit, every submission applied or rejected, a readable
 * definition, and authoring for ontologists and admins.
 *
 * Deep links: `?run=<key>&<param>=<value>` opens an action with its form
 * filled in (the Explorer and Insights link here); `?submission=<id>` opens a
 * submission.
 */
export default function Actions() {
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const now = useNow(15_000);
  const canAuthor = useCanAuthorActions();
  const panelRef = useRef<HTMLDivElement>(null);

  const runKey = params.get('run');
  const submissionId = Number(params.get('submission')) || null;
  const [creating, setCreating] = useState(false);

  const typesQ = trpc.actions.listTypes.useQuery(undefined, { retry: 1 });
  const types = useMemo(() => typesQ.data ?? [], [typesQ.data]);

  const [histAction, setHistAction] = useState('');
  const [histStatus, setHistStatus] = useState<SubmissionFilter>('all');
  const subsQ = trpc.actions.listSubmissions.useQuery(
    {
      actionKey: histAction || undefined,
      status: histStatus === 'all' ? undefined : histStatus,
      limit: HISTORY_LIMIT,
    },
    { retry: 1, placeholderData: (prev) => prev },
  );

  const definitions = useMemo(
    () => new Map(types.map((t) => [t.key, { displayName: t.displayName, definition: t.definition }] as const)),
    [types],
  );
  const totals = useMemo(
    () =>
      types.reduce(
        (a, t) => ({
          runnable: a.runnable + (t.canSubmit ? 1 : 0),
          applied: a.applied + t.submissions.applied,
          rejected: a.rejected + t.submissions.rejected,
        }),
        { runnable: 0, applied: 0, rejected: 0 },
      ),
    [types],
  );

  // A deep link (or a choice) opens the panel; on a phone, scroll down to it.
  useEffect(() => {
    if (runKey) scrollIntoViewOnNarrow(panelRef.current);
  }, [runKey]);

  const select = (key: string) => {
    setCreating(false);
    setParams({ run: key });
  };
  const closePanel = () => {
    setCreating(false);
    setParams((p) => {
      const next = new URLSearchParams();
      const s = p.get('submission');
      if (s) next.set('submission', s);
      return next;
    });
  };
  const startCreating = () => {
    setCreating(true);
    scrollIntoViewOnNarrow(panelRef.current);
  };
  const openSubmission = (id: number) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('submission', String(id));
        return next;
      },
      { replace: true },
    );
  const closeSubmission = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('submission');
        return next;
      },
      { replace: true },
    );

  const refreshAll = () => {
    void utils.actions.invalidate();
  };
  const fetching = typesQ.isFetching || subsQ.isFetching;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6">
      <Toaster position="bottom-right" theme="dark" />

      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="min-w-0">
          <h1 className="font-display text-[32px] font-semibold leading-[1.2] tracking-[-0.02em] text-text-primary">Actions</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-text-secondary">
            Named, governed edits to the graph. Each one checks its criteria, shows every change before it is made, and
            is recorded with who ran it, whether it was applied or rejected.
          </p>
          {typesQ.data && (
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] text-text-muted">
              <span>
                <span className="text-text-primary">{types.length}</span> action type{types.length === 1 ? '' : 's'}
              </span>
              <span>
                <span className="text-text-primary">{totals.runnable}</span> you can run
              </span>
              <span>
                <span className="text-ok">{totals.applied}</span> applied
              </span>
              <span>
                <span className={totals.rejected ? 'text-risk' : 'text-text-primary'}>{totals.rejected}</span> rejected
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            to="/app/operations"
            className="hidden items-center gap-1.5 rounded-lg border border-border-hairline px-3.5 py-2 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary sm:inline-flex"
          >
            Operations <ArrowRight className="size-3.5" />
          </Link>
          {canAuthor && (
            <button
              type="button"
              onClick={startCreating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-iris-deep to-iris px-3.5 py-2 text-[13px] font-medium text-white transition-all hover:from-iris hover:to-iris-bright"
            >
              <Plus className="size-3.5" /> New action type
            </button>
          )}
          <button
            type="button"
            onClick={refreshAll}
            aria-label="Refresh"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-2 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
          >
            <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} />
          </button>
        </div>
      </motion.header>

      {/* ── Catalogue + panel ── */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Catalogue
          types={types}
          isLoading={typesQ.isLoading}
          error={typesQ.error?.message ?? null}
          onReload={() => void typesQ.refetch()}
          selectedKey={creating ? null : runKey}
          onSelect={select}
          now={now}
          canAuthor={canAuthor}
          onCreate={startCreating}
        />

        <div ref={panelRef} className="min-w-0 scroll-mt-20 rounded-xl border border-border-hairline bg-bg-panel">
          {creating ? (
            <div>
              <div className="flex items-start gap-3 border-b border-border-hairline px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-[20px] font-semibold text-text-primary">New action type</h2>
                  <p className="mt-0.5 text-[13px] text-text-secondary">
                    Parameters, the criteria a submission must meet, and the edits it makes. Check it, then create it; a
                    draft is not runnable until you make it active.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  aria-label="Close"
                  className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4 sm:p-5">
                <ActionTypeEditor
                  onSaved={(key) => {
                    setCreating(false);
                    setParams({ run: key, tab: 'definition' });
                  }}
                  onCancel={() => setCreating(false)}
                />
              </div>
            </div>
          ) : runKey ? (
            <ActionPanel key={runKey} actionKey={runKey} search={params} canAuthor={canAuthor} onClose={closePanel} />
          ) : (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <span className="flex size-12 items-center justify-center rounded-full border border-dashed border-border-glow" aria-hidden>
                <MousePointerClick className="size-5 text-text-muted" />
              </span>
              <p className="mt-4 text-[14px] text-text-secondary">Choose an action type to run it or read its definition.</p>
              <p className="mt-1 max-w-sm font-mono text-[11.5px] text-text-muted">
                or start from an object: its drawer in the Graph Explorer lists the actions that apply to it
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── History ── */}
      <SubmissionHistory
        submissions={subsQ.data ?? []}
        isLoading={subsQ.isLoading}
        error={subsQ.error?.message ?? null}
        onReload={() => void subsQ.refetch()}
        actions={types.map((t) => ({ key: t.key, displayName: t.displayName }))}
        actionKey={histAction}
        onActionKey={setHistAction}
        status={histStatus}
        onStatus={setHistStatus}
        onOpen={openSubmission}
        openId={submissionId}
        limit={HISTORY_LIMIT}
        now={now}
      />

      <SubmissionDetailSheet id={submissionId} onClose={closeSubmission} definitions={definitions} />
    </div>
  );
}
