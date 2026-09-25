import { Link } from 'react-router';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { ActionDefinition } from '@contracts/actions';
import { trpc } from '@/providers/trpc';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { JobStatusBadge } from '@/components/operations/JobStatusBadge';
import { firstLine, stamp, type JobStatus } from '@/components/operations/utils';
import { cn } from '@/lib/utils';
import { SubmissionStatusBadge } from './Badges';
import { OutcomeSection, PlanView, ProblemList, ShaclView } from './OutcomeView';
import { explorerHref, jobHref, runHref } from './links';
import { asPlan, asProblems, valueWords } from './words';
import type { ShaclCheck, SideEffectRow, SubmissionDetail as Detail } from './types';

function asShacl(json: unknown): ShaclCheck | null {
  const s = json as ShaclCheck | null;
  return s && typeof s === 'object' && typeof s.status === 'string' && Array.isArray(s.violations) ? s : null;
}

function Params({ params, definition }: { params: unknown; definition: ActionDefinition | null }) {
  const entries = params && typeof params === 'object' ? Object.entries(params as Record<string, unknown>) : [];
  if (entries.length === 0) return <p className="text-[12.5px] text-text-muted">No parameters.</p>;
  return (
    <dl className="divide-y divide-border-hairline rounded-lg border border-border-hairline" aria-label="Parameters">
      {entries.map(([name, value]) => {
        const p = definition?.parameters.find((x) => x.name === name);
        const isObject = p?.type === 'object' && typeof value === 'string' && value !== '';
        return (
          <div key={name} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)] sm:gap-3">
            <dt className="min-w-0 text-[12.5px] text-text-secondary">
              {p?.label ?? name}
              <span className="block truncate font-mono text-[10.5px] text-text-muted">{name}</span>
            </dt>
            <dd className="min-w-0 break-words font-mono text-[12px] text-text-primary">
              {isObject ? (
                <Link to={explorerHref(value as string)} className="text-text-accent hover:underline">
                  {value as string}
                </Link>
              ) : (
                valueWords(value)
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function SideEffects({ jobs, declared }: { jobs: SideEffectRow[]; declared: number }) {
  if (jobs.length === 0) {
    return (
      <p className="text-[12.5px] text-text-muted">
        {declared > 0 ? 'None were queued: side effects run only after an action is applied.' : 'This action has no side effects.'}
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Side effects">
      {jobs.map((j) => {
        const err = firstLine(j.lastError);
        return (
          <li key={j.id} className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link to={jobHref(j.id)} className="inline-flex items-center gap-1 font-mono text-[12px] text-text-accent hover:underline">
                job #{j.id} <ArrowRight className="size-3" />
              </Link>
              <JobStatusBadge status={j.status as JobStatus} />
              <span
                className={cn(
                  'font-mono text-[11px] tabular-nums',
                  j.status === 'failed' ? 'text-risk' : j.attempts > 1 ? 'text-warn' : 'text-text-muted',
                )}
              >
                attempt {j.attempts} of {j.maxAttempts}
              </span>
              {j.finishedAt && <span className="font-mono text-[10.5px] text-text-muted">finished {stamp(j.finishedAt)}</span>}
            </div>
            {err && (
              <p
                className={cn('mt-1 break-words font-mono text-[11px]', j.status === 'failed' ? 'text-risk' : 'text-warn')}
                title={j.lastError ?? undefined}
              >
                {j.status === 'succeeded' ? 'recovered from: ' : 'last error: '}
                {err}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Body({ detail, definition, displayName }: { detail: Detail; definition: ActionDefinition | null; displayName: string | null }) {
  const { submission, sideEffects } = detail;
  const applied = submission.status === 'applied';
  const plan = asPlan(submission.resultJson);
  const problems = asProblems(submission.errorsJson);
  return (
    <div className="space-y-5 p-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border-hairline bg-bg-inset p-3">
        <div className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Submitted</dt>
          <dd className="mt-0.5 font-mono text-[11px] text-text-secondary">{stamp(submission.createdAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">By</dt>
          <dd className="mt-0.5 truncate text-[12px] text-text-secondary">{submission.submittedBy}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Action</dt>
          <dd className="mt-0.5 truncate text-[12px]">
            <Link to={runHref(submission.actionKey)} className="text-text-accent hover:underline">
              {displayName ?? submission.actionKey}
            </Link>
            <span className="font-mono text-[10.5px] text-text-muted"> v{submission.actionVersion}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">Result</dt>
          <dd className="mt-0.5">
            <SubmissionStatusBadge status={submission.status} />
          </dd>
        </div>
      </dl>

      <OutcomeSection title="Parameters">
        <Params params={submission.paramsJson} definition={definition} />
      </OutcomeSection>

      {applied ? (
        <OutcomeSection title="Changes made">
          {plan ? <PlanView plan={plan} applied /> : <p className="text-[12.5px] text-text-muted">No change record.</p>}
        </OutcomeSection>
      ) : (
        <OutcomeSection title="Why it was rejected" count={problems.length}>
          <p className="mb-2 text-[12.5px] text-text-secondary">Nothing was changed. The reasons were recorded:</p>
          {problems.length ? <ProblemList problems={problems} /> : <p className="text-[12.5px] text-text-muted">No reasons recorded.</p>}
        </OutcomeSection>
      )}

      <OutcomeSection title="SHACL validation">
        <ShaclView shacl={asShacl(submission.shaclJson)} enabled={definition?.validation.shacl} />
      </OutcomeSection>

      <OutcomeSection title="Side effects" count={sideEffects.length || undefined}>
        <SideEffects jobs={sideEffects} declared={definition?.sideEffects.length ?? 0} />
        {sideEffects.length > 0 && (
          <Link to="/app/operations" className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-text-accent hover:underline">
            all background jobs in Operations <ArrowRight className="size-3" />
          </Link>
        )}
      </OutcomeSection>
    </div>
  );
}

export interface SubmissionDetailSheetProps {
  id: number | null;
  onClose: () => void;
  /** Current definitions by action key, for the display name and when a submission's own version is unavailable. */
  definitions: Map<string, { displayName: string; definition: ActionDefinition }>;
}

/** One submission in full: its parameters, the changes or the reasons it was rejected, SHACL, and its side-effect jobs. */
export function SubmissionDetailSheet({ id, onClose, definitions }: SubmissionDetailSheetProps) {
  const q = trpc.actions.getSubmission.useQuery(
    { id: id ?? 0 },
    {
      enabled: id != null,
      retry: 1,
      // Follow side-effect jobs while they are queued or running.
      refetchInterval: (query) =>
        query.state.data?.sideEffects.some((j) => j.status === 'queued' || j.status === 'running') ? 2000 : false,
    },
  );
  const detail = q.data;
  const info = detail ? definitions.get(detail.submission.actionKey) : undefined;

  return (
    <Sheet open={id != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-l border-border-hairline bg-bg-panel p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b border-border-hairline p-5 pr-12">
          <SheetTitle className="text-left font-display text-[18px] font-semibold text-text-primary">
            Submission #{id}
          </SheetTitle>
          <SheetDescription className="text-left text-[12.5px] text-text-muted">
            {detail
              ? `${info?.displayName ?? detail.submission.actionKey} · ${detail.submission.status}`
              : 'What was asked, what it did, and what ran afterwards.'}
          </SheetDescription>
        </SheetHeader>
        {q.isLoading && (
          <div className="flex h-40 items-center justify-center gap-2 font-mono text-[12px] text-text-muted">
            <Loader2 className="size-4 animate-spin text-iris-bright" /> loading submission …
          </div>
        )}
        {q.isError && (
          <div className="m-5 rounded-lg border-l-2 border-risk bg-risk/10 px-3 py-2.5 font-mono text-[12px] text-risk">{q.error.message}</div>
        )}
        {detail && (
          <Body
            detail={detail}
            // The version this submission ran, falling back to the current one.
            definition={detail.definition ?? info?.definition ?? null}
            displayName={info?.displayName ?? null}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
