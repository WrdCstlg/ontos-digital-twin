import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  CircleX,
  Link2,
  Link2Off,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { explorerHref } from './links';
import { planIsEmpty, valueWords, type PlanLike, type ProblemLike } from './words';

type Criterion = { index: number; message: string; passed: boolean; detail?: string };
type Shacl = {
  status: 'conforms' | 'violations' | 'no_shapes' | 'unavailable' | 'skipped';
  violations: { focusNode: string; path?: string; severity: string; message: string; remediation?: string }[];
};

export function OutcomeSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
        {title}
        {count !== undefined && <span className="ml-1.5 font-mono normal-case tracking-normal">{count}</span>}
      </h4>
      {children}
    </section>
  );
}

/** An object IRI; a link into the Explorer unless it no longer exists. */
function ObjectRef({ iri, label, linked = true }: { iri: string; label?: string; linked?: boolean }) {
  const body = (
    <>
      {label && label !== iri && <span className="text-text-primary">{label} </span>}
      <span className="font-mono text-[11px] text-text-muted">{iri}</span>
    </>
  );
  if (!linked) return <span className="min-w-0 break-words">{body}</span>;
  return (
    <Link to={explorerHref(iri)} className="min-w-0 break-words hover:underline" title="Open in the Graph Explorer">
      {body}
    </Link>
  );
}

/** Problems that stop an action from applying. */
export function ProblemList({ problems }: { problems: ProblemLike[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="Problems">
      {problems.map((p, i) => (
        <li
          key={`${p.code}-${i}`}
          className="flex items-start gap-2 rounded-md border border-risk/30 bg-risk/5 px-3 py-2 text-[12.5px] text-risk"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {p.message}
            {p.path && <span className="ml-1.5 font-mono text-[10.5px] text-risk/70">{p.path}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The criteria checklist: each criterion passed or failed, with what was compared. */
export function CriteriaList({ criteria, declared }: { criteria: Criterion[]; declared?: number }) {
  if (criteria.length === 0) {
    return (
      <p className="text-[12.5px] text-text-muted">
        {declared ? 'Not evaluated: the parameters have to be valid first.' : 'This action has no criteria.'}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5" aria-label="Criteria">
      {criteria.map((c) => (
        <li
          key={c.index}
          data-passed={c.passed}
          className={cn(
            'flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]',
            c.passed ? 'border-border-hairline bg-bg-inset text-text-secondary' : 'border-risk/30 bg-risk/5 text-risk',
          )}
        >
          {c.passed ? (
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-label="passed" />
          ) : (
            <CircleX className="mt-0.5 size-3.5 shrink-0" aria-label="failed" />
          )}
          <span className="min-w-0 break-words">
            {c.message}
            {c.detail && (
              <span className={cn('block font-mono text-[10.5px]', c.passed ? 'text-text-muted' : 'text-risk/75')}>
                {c.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LinkLine({ l, kind }: { l: { from: string; predicate: string; to: string }; kind: 'add' | 'remove' }) {
  const Icon = kind === 'add' ? Link2 : Link2Off;
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', kind === 'add' ? 'text-ok' : 'text-risk')} aria-hidden />
      <span className="min-w-0 break-words font-mono text-[11.5px] text-text-secondary">
        {l.from} <span className="text-text-accent">—{l.predicate}→</span> {l.to}
      </span>
    </li>
  );
}

/**
 * The planned (or applied) changes: objects created, properties changed as
 * before → after, objects deleted, and links added and removed.
 */
export function PlanView({ plan, applied = false }: { plan: PlanLike; applied?: boolean }) {
  if (planIsEmpty(plan)) {
    return <p className="text-[12.5px] text-text-muted">{applied ? 'Nothing was changed.' : 'Nothing would change.'}</p>;
  }
  return (
    <div className="space-y-3" aria-label="Planned changes">
      {plan.created.length > 0 && (
        <OutcomeSection title={applied ? 'Created' : 'Creates'} count={plan.created.length}>
          <ul className="space-y-1.5">
            {plan.created.map((c) => (
              <li key={c.iri} className="flex items-start gap-2 text-[12.5px]">
                <CirclePlus className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
                <span className="min-w-0">
                  <ObjectRef iri={c.iri} label={c.label} linked={applied} />
                  <span className="ml-1.5 font-mono text-[10.5px] text-text-muted">a {c.classIri}</span>
                </span>
              </li>
            ))}
          </ul>
        </OutcomeSection>
      )}

      {plan.modified.length > 0 && (
        <OutcomeSection title={applied ? 'Changed' : 'Changes'} count={plan.modified.length}>
          <ul className="space-y-2">
            {plan.modified.map((m) => (
              <li key={m.iri} className="rounded-md border border-border-hairline bg-bg-inset px-3 py-2">
                <div className="flex items-start gap-2 text-[12.5px]">
                  <PencilLine className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                  <ObjectRef iri={m.iri} />
                </div>
                <dl className="mt-1.5 space-y-1 pl-[22px]">
                  {m.label && (
                    <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                      <dt className="font-mono text-[11px] text-text-muted">label</dt>
                      <dd className="min-w-0 break-words text-text-secondary">
                        <span className="text-text-muted line-through decoration-text-muted/60">{m.label.from}</span>
                        <ArrowRight className="mx-1 inline size-3 text-text-muted" aria-label="becomes" />
                        <span className="text-text-primary">{m.label.to}</span>
                      </dd>
                    </div>
                  )}
                  {Object.entries(m.set).map(([k, v]) => (
                    <div key={k} className="flex flex-wrap items-baseline gap-x-2 text-[12px]" data-testid={`change-${k}`}>
                      <dt className="font-mono text-[11px] text-text-muted">{k}</dt>
                      <dd className="min-w-0 break-words font-mono text-[11.5px]">
                        <span className="text-text-muted">{valueWords(v.from)}</span>
                        <ArrowRight className="mx-1 inline size-3 text-text-muted" aria-label="becomes" />
                        <span className="text-text-primary">{valueWords(v.to)}</span>
                      </dd>
                    </div>
                  ))}
                  {m.unset.map((k) => (
                    <div key={k} className="flex flex-wrap items-baseline gap-x-2 text-[12px]" data-testid={`change-${k}`}>
                      <dt className="font-mono text-[11px] text-text-muted">{k}</dt>
                      <dd className="font-mono text-[11.5px] text-risk/80">removed</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </OutcomeSection>
      )}

      {plan.deleted.length > 0 && (
        <OutcomeSection title={applied ? 'Deleted' : 'Deletes'} count={plan.deleted.length}>
          <ul className="space-y-1.5">
            {plan.deleted.map((d) => (
              <li key={d.iri} className="flex items-start gap-2 text-[12.5px]">
                <CircleMinus className="mt-0.5 size-3.5 shrink-0 text-risk" aria-hidden />
                <ObjectRef iri={d.iri} label={d.label} linked={false} />
              </li>
            ))}
          </ul>
        </OutcomeSection>
      )}

      {plan.linksAdded.length > 0 && (
        <OutcomeSection title={applied ? 'Links added' : 'Adds links'} count={plan.linksAdded.length}>
          <ul className="space-y-1">
            {plan.linksAdded.map((l) => (
              <LinkLine key={`${l.from}|${l.predicate}|${l.to}`} l={l} kind="add" />
            ))}
          </ul>
        </OutcomeSection>
      )}

      {plan.linksRemoved.length > 0 && (
        <OutcomeSection title={applied ? 'Links removed' : 'Removes links'} count={plan.linksRemoved.length}>
          <ul className="space-y-1">
            {plan.linksRemoved.map((l) => (
              <LinkLine key={`${l.from}|${l.predicate}|${l.to}`} l={l} kind="remove" />
            ))}
          </ul>
        </OutcomeSection>
      )}
    </div>
  );
}

const SHACL_TEXT: Record<Shacl['status'], string> = {
  conforms: 'The result conforms to its classes’ SHACL shapes.',
  violations: 'The result violates its classes’ SHACL shapes, so it cannot be applied.',
  no_shapes: 'None of the objects it touches has SHACL shapes to check.',
  unavailable: 'The semantic engine was not available to check SHACL shapes.',
  skipped: 'Not checked.',
};

/** The SHACL outcome, with each violation's message and remediation. */
export function ShaclView({ shacl, enabled }: { shacl: Shacl | null; enabled?: boolean }) {
  if (!shacl) return <p className="text-[12.5px] text-text-muted">No SHACL record.</p>;
  const Icon =
    shacl.status === 'conforms'
      ? ShieldCheck
      : shacl.status === 'violations' || shacl.status === 'unavailable'
        ? ShieldAlert
        : ShieldQuestion;
  const tone =
    shacl.status === 'conforms'
      ? 'text-ok'
      : shacl.status === 'violations'
        ? 'text-risk'
        : shacl.status === 'unavailable'
          ? 'text-warn'
          : 'text-text-muted';
  const skippedText =
    shacl.status === 'skipped'
      ? enabled === false
        ? 'Not checked: this action does not validate against SHACL.'
        : enabled
          ? 'Not checked yet: the parameters and criteria have to pass first.'
          : SHACL_TEXT.skipped
      : SHACL_TEXT[shacl.status];
  return (
    <div className="space-y-2">
      <p className={cn('flex items-start gap-2 text-[12.5px]', tone)}>
        <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{skippedText}</span>
      </p>
      {shacl.violations.length > 0 && (
        <ul className="space-y-1.5" aria-label="SHACL violations">
          {shacl.violations.map((v, i) => (
            <li
              key={`${v.focusNode}-${v.path ?? ''}-${i}`}
              className={cn(
                'rounded-md border px-3 py-2 text-[12.5px]',
                v.severity === 'Violation' ? 'border-risk/30 bg-risk/5' : 'border-warn/30 bg-warn/5',
              )}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cn('font-mono text-[10px] uppercase tracking-[0.06em]', v.severity === 'Violation' ? 'text-risk' : 'text-warn')}>
                  {v.severity}
                </span>
                <span className="min-w-0 break-words font-mono text-[10.5px] text-text-muted">
                  {v.focusNode}
                  {v.path && ` · ${v.path}`}
                </span>
              </div>
              <p className="mt-0.5 break-words text-text-primary">{v.message}</p>
              {v.remediation && (
                <p className="mt-1 break-words text-[12px] text-text-secondary">
                  <span className="font-medium text-text-accent">Fix: </span>
                  {v.remediation}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface OutcomeViewProps {
  problems: ProblemLike[];
  criteria: Criterion[];
  plan: PlanLike | null;
  shacl: Shacl | null;
  /** Whether the plan has been applied (past tense, links to live objects). */
  applied?: boolean;
  /** How many criteria the action declares, to explain an empty checklist. */
  declaredCriteria?: number;
  /** Whether the action validates against SHACL, to explain a skipped check. */
  shaclEnabled?: boolean;
}

/**
 * What an action would do or did: problems first, then the criteria
 * checklist, the planned changes and the SHACL outcome. Used for a preview,
 * a submission's outcome and the submission history.
 */
export function OutcomeView({ problems, criteria, plan, shacl, applied, declaredCriteria, shaclEnabled }: OutcomeViewProps) {
  // Criteria failures are already in the checklist; list the rest as problems.
  const other = problems.filter((p) => p.code !== 'criterion_failed' && p.code !== 'shacl_violation');
  return (
    <div className="grid gap-4">
      {other.length > 0 && (
        <OutcomeSection title="Problems" count={other.length}>
          <ProblemList problems={other} />
        </OutcomeSection>
      )}
      <OutcomeSection title="Criteria" count={criteria.length || undefined}>
        <CriteriaList criteria={criteria} declared={declaredCriteria} />
      </OutcomeSection>
      <OutcomeSection title={applied ? 'Changes made' : 'Planned changes'}>
        {plan ? <PlanView plan={plan} applied={applied} /> : <p className="text-[12.5px] text-text-muted">No changes recorded.</p>}
      </OutcomeSection>
      <OutcomeSection title="SHACL validation">
        <ShaclView shacl={shacl} enabled={shaclEnabled} />
      </OutcomeSection>
    </div>
  );
}
