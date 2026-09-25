import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CircleCheck, CircleX, Eye, Loader2, Lock, Play, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { ActionDefinition } from '@contracts/actions';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { ParamForm } from './ParamForm';
import { OutcomeView } from './OutcomeView';
import { errorCode, explorerHref, jobHref, submissionHref } from './links';
import { missingRequired, problemsByParam, toSubmitParams, type FormValue, type FormValues } from './form';
import { touchedObjectIris, type PlanLike } from './words';
import type { PreviewResult, SubmitResult } from './types';

type Outcome =
  | { kind: 'preview'; forParams: string; result: PreviewResult }
  | { kind: 'submit'; forParams: string; result: SubmitResult }
  | { kind: 'error'; forParams: string; title: string; message: string };

export interface RunPanelProps {
  actionKey: string;
  definition: ActionDefinition;
  canSubmit: boolean;
  /** Why this person cannot submit it, when they cannot. */
  deniedBecause: string | null;
  status: string;
  initialValues: FormValues;
}

function ChangedObjects({ plan }: { plan: PlanLike }) {
  const iris = touchedObjectIris(plan);
  if (iris.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-text-muted">Open in the Explorer:</span>
      {iris.map((iri) => (
        <Link
          key={iri}
          to={explorerHref(iri)}
          className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border-hairline bg-bg-inset px-2 py-0.5 font-mono text-[11px] text-text-accent transition-colors hover:border-border-glow"
        >
          {iri} <ArrowRight className="size-3 shrink-0" />
        </Link>
      ))}
    </div>
  );
}

/**
 * Runs an action: the parameter form, Preview (every check and planned
 * change, nothing written) and Submit (applied in one transaction, or the
 * rejection recorded with its reasons).
 */
export function RunPanel({ actionKey, definition, canSubmit, deniedBecause, status, initialValues }: RunPanelProps) {
  const utils = trpc.useUtils();
  const [values, setValues] = useState<FormValues>(initialValues);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const params = toSubmitParams(definition.parameters, values);
  const paramsKey = JSON.stringify(params);
  const stale = outcome !== null && outcome.forParams !== paramsKey;
  const missing = missingRequired(definition.parameters, values);

  const previewM = trpc.actions.preview.useMutation({
    onSuccess: (result, vars) => setOutcome({ kind: 'preview', forParams: JSON.stringify(vars.params), result }),
    onError: (err, vars) =>
      setOutcome({ kind: 'error', forParams: JSON.stringify(vars.params), title: 'The preview failed', message: err.message }),
  });

  const submitM = trpc.actions.submit.useMutation({
    onSuccess: (result, vars) => {
      setOutcome({ kind: 'submit', forParams: JSON.stringify(vars.params), result });
      const s = result.submission;
      if (s.status === 'applied') {
        toast.success(`Applied · submission #${s.id}`, { description: 'The changes are in the graph.' });
      } else {
        toast.error(`Rejected · submission #${s.id}`, { description: 'Nothing was changed; the reasons were recorded.' });
      }
      void Promise.all([
        utils.actions.listTypes.invalidate(),
        utils.actions.listSubmissions.invalidate(),
        utils.actions.getType.invalidate({ key: actionKey }),
        utils.actions.forObject.invalidate(),
        s.status === 'applied' ? utils.graph.invalidate() : Promise.resolve(),
      ]);
    },
    onError: (err, vars) => {
      const code = errorCode(err);
      const title =
        code === 'FORBIDDEN'
          ? 'You cannot submit this action'
          : code === 'CONFLICT'
            ? 'The objects changed meanwhile'
            : code === 'BAD_REQUEST'
              ? 'This action cannot be submitted'
              : 'The submission failed';
      setOutcome({ kind: 'error', forParams: JSON.stringify(vars.params), title, message: err.message });
      toast.error(title, { description: err.message });
    },
  });

  const busy = previewM.isPending || submitM.isPending;
  const setValue = (name: string, v: FormValue) => setValues((cur) => ({ ...cur, [name]: v }));

  if (!canSubmit) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-border-hairline bg-bg-inset px-3.5 py-3 text-[13px]">
        <Lock className="mt-0.5 size-4 shrink-0 text-text-muted" />
        <div>
          <p className="text-text-primary">You cannot run this action.</p>
          <p className="mt-0.5 text-text-secondary">
            {deniedBecause ?? (status !== 'active' ? `It is ${status}; only active actions can be submitted.` : 'Not allowed.')}
          </p>
          <p className="mt-1 text-[12px] text-text-muted">Its definition shows what it would do.</p>
        </div>
      </div>
    );
  }

  const fieldErrors =
    outcome && !stale && outcome.kind !== 'error' ? problemsByParam(outcome.result.problems) : {};

  return (
    <div className="grid gap-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          previewM.mutate({ key: actionKey, params });
        }}
        className="grid gap-4"
        aria-label="Parameters"
      >
        <ParamForm parameters={definition.parameters} values={values} onChange={setValue} errors={fieldErrors} disabled={busy} />

        <div className="flex flex-wrap items-center gap-2 border-t border-border-hairline pt-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/15 px-3.5 py-1.5 text-[13px] font-medium text-text-accent transition-colors hover:bg-iris/25 disabled:opacity-50"
          >
            {previewM.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />} Preview
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => submitM.mutate({ key: actionKey, params })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-iris px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-50"
          >
            {submitM.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Submit
          </button>
          <span className="text-[11.5px] text-text-muted">
            {missing.length > 0
              ? `Still needed: ${missing.join(', ')}`
              : 'Preview changes nothing. Submit applies it, or records why not.'}
          </span>
        </div>
      </form>

      {outcome && (
        <section
          aria-label="Outcome"
          aria-live="polite"
          className={cn('rounded-xl border bg-bg-panel p-4', stale ? 'border-border-hairline opacity-70' : 'border-border-glow')}
        >
          {stale && (
            <p className="mb-3 flex items-center gap-1.5 text-[12px] text-warn">
              <TriangleAlert className="size-3.5" /> The parameters changed since this {outcome.kind === 'submit' ? 'submission' : 'preview'}.
            </p>
          )}

          {outcome.kind === 'error' && (
            <div className="flex items-start gap-2 text-[13px]">
              <CircleX className="mt-0.5 size-4 shrink-0 text-risk" />
              <div className="min-w-0">
                <p className="font-medium text-risk">{outcome.title}</p>
                <p className="mt-0.5 break-words text-text-secondary">{outcome.message}</p>
                {outcome.title === 'The objects changed meanwhile' && (
                  <p className="mt-1 text-[12px] text-text-muted">Preview again to see the objects as they are now.</p>
                )}
              </div>
            </div>
          )}

          {outcome.kind === 'preview' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-[15px] font-semibold text-text-primary">Preview</h3>
                {outcome.result.canApply ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 font-mono text-[10.5px] text-ok">
                    <CircleCheck className="size-3" /> would apply
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-risk/30 bg-risk/10 px-2 py-0.5 font-mono text-[10.5px] text-risk">
                    <CircleX className="size-3" /> would be rejected · {outcome.result.problems.length} problem
                    {outcome.result.problems.length === 1 ? '' : 's'}
                  </span>
                )}
                <span className="font-mono text-[10.5px] text-text-muted">nothing has been changed</span>
              </div>
              <OutcomeView
                problems={outcome.result.problems}
                criteria={outcome.result.criteria}
                plan={outcome.result.plan}
                shacl={outcome.result.shacl}
                declaredCriteria={definition.criteria.length}
                shaclEnabled={definition.validation.shacl}
              />
            </>
          )}

          {outcome.kind === 'submit' &&
            (() => {
              const { submission, problems, criteria, plan, shacl } = outcome.result;
              const applied = submission.status === 'applied';
              const jobs = Array.isArray(submission.sideEffectJobIds) ? (submission.sideEffectJobIds as number[]) : [];
              return (
                <>
                  <div className="mb-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {applied ? <CircleCheck className="size-4 text-ok" /> : <CircleX className="size-4 text-risk" />}
                      <h3 className={cn('font-display text-[15px] font-semibold', applied ? 'text-ok' : 'text-risk')}>
                        {applied ? 'Applied' : 'Rejected'}
                      </h3>
                      <Link to={submissionHref(submission.id)} className="font-mono text-[11.5px] text-text-accent hover:underline">
                        submission #{submission.id}
                      </Link>
                      <span className="font-mono text-[10.5px] text-text-muted">v{submission.actionVersion}</span>
                    </div>
                    {applied ? (
                      <>
                        <ChangedObjects plan={plan} />
                        {jobs.length > 0 && (
                          <p className="text-[12px] text-text-secondary">
                            {jobs.length} side effect{jobs.length === 1 ? '' : 's'} queued for a worker:{' '}
                            {jobs.map((id, i) => (
                              <span key={id}>
                                {i > 0 && ', '}
                                <Link to={jobHref(id)} className="font-mono text-text-accent hover:underline">
                                  job #{id}
                                </Link>
                              </span>
                            ))}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[12.5px] text-text-secondary">
                        Nothing was changed. The rejection and its reasons were recorded in the history, so it is
                        auditable like an applied one.
                      </p>
                    )}
                  </div>
                  <OutcomeView
                    problems={problems}
                    criteria={criteria}
                    plan={plan}
                    shacl={shacl}
                    applied={applied}
                    declaredCriteria={definition.criteria.length}
                    shaclEnabled={definition.validation.shacl}
                  />
                </>
              );
            })()}
        </section>
      )}
    </div>
  );
}
