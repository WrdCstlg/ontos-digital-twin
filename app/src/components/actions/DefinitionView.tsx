import { useState } from 'react';
import { ChevronDown, ShieldCheck, ShieldOff, Webhook } from 'lucide-react';
import type { ActionDefinition } from '@contracts/actions';
import { cn } from '@/lib/utils';
import { OutcomeSection } from './OutcomeView';
import { describeCriterion, describeParameterType, describeRule } from './words';

/**
 * An action type's definition for everyone to read: its parameters, the
 * criteria a submission must meet, its rules in words, whether the result is
 * checked against SHACL, and the webhooks it calls afterwards.
 */
export function DefinitionView({ definition }: { definition: ActionDefinition }) {
  const [showJson, setShowJson] = useState(false);
  const { parameters, criteria, rules, validation, sideEffects } = definition;

  return (
    <div className="grid gap-5">
      <OutcomeSection title="Parameters" count={parameters.length}>
        {parameters.length === 0 ? (
          <p className="text-[12.5px] text-text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-border-hairline rounded-lg border border-border-hairline" aria-label="Parameters">
            {parameters.map((p) => (
              <li key={p.name} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:gap-3">
                <div className="min-w-0">
                  <span className="text-[13px] text-text-primary">{p.label}</span>
                  {p.required ? (
                    <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-risk">required</span>
                  ) : (
                    <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">optional</span>
                  )}
                  <span className="block truncate font-mono text-[10.5px] text-text-muted">{p.name}</span>
                </div>
                <div className="min-w-0 text-[12.5px]">
                  <span className="break-words font-mono text-[11.5px] text-text-secondary">{describeParameterType(p)}</span>
                  {p.description && <p className="mt-0.5 break-words text-text-muted">{p.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </OutcomeSection>

      <OutcomeSection title="Criteria" count={criteria.length}>
        {criteria.length === 0 ? (
          <p className="text-[12.5px] text-text-muted">None: any valid parameters are accepted.</p>
        ) : (
          <ol className="space-y-1.5" aria-label="Criteria">
            {criteria.map((c, i) => (
              <li key={i} className="flex gap-2.5 rounded-md border border-border-hairline bg-bg-inset px-3 py-2">
                <span className="font-mono text-[11px] text-text-muted">{i + 1}.</span>
                <span className="min-w-0">
                  <span className="block break-words text-[12.5px] text-text-secondary">{describeCriterion(c, definition)}</span>
                  <span className="block break-words text-[11.5px] text-text-muted">otherwise: “{c.message}”</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </OutcomeSection>

      <OutcomeSection title="Rules" count={rules.length}>
        <ol className="space-y-1.5" aria-label="Rules">
          {rules.map((r, i) => (
            <li key={i} className="flex gap-2.5 text-[12.5px]">
              <span className="font-mono text-[11px] text-text-muted">{i + 1}.</span>
              <span className="min-w-0 break-words text-text-secondary">{describeRule(r, definition)}</span>
            </li>
          ))}
        </ol>
      </OutcomeSection>

      <OutcomeSection title="Validation">
        {validation.shacl ? (
          <p className="flex items-start gap-2 text-[12.5px] text-text-secondary">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
            SHACL on: the objects it creates or changes are checked against their classes’ shapes, and a violation
            rejects the submission.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-[12.5px] text-text-muted">
            <ShieldOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            SHACL off: the result is not checked against shapes.
          </p>
        )}
      </OutcomeSection>

      <OutcomeSection title="Side effects" count={sideEffects.length}>
        {sideEffects.length === 0 ? (
          <p className="text-[12.5px] text-text-muted">None.</p>
        ) : (
          <ul className="space-y-1.5">
            {sideEffects.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px]">
                <Webhook className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
                <span className="min-w-0">
                  <span className="block break-all font-mono text-[11.5px] text-text-secondary">POST {s.url}</span>
                  {s.description && <span className="block text-text-muted">{s.description}</span>}
                </span>
              </li>
            ))}
            <li className="pl-[22px] text-[11.5px] text-text-muted">
              Called by a background worker after the edits commit, with up to three attempts; see Operations.
            </li>
          </ul>
        )}
      </OutcomeSection>

      <div>
        <button
          type="button"
          onClick={() => setShowJson((s) => !s)}
          aria-expanded={showJson}
          className="inline-flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted transition-colors hover:text-text-secondary"
        >
          <ChevronDown className={cn('size-3 transition-transform', showJson && 'rotate-180')} /> Definition JSON
        </button>
        {showJson && (
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border-hairline bg-bg-inset p-3 font-mono text-[11px] leading-[1.5] text-text-secondary">
            {JSON.stringify(definition, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
