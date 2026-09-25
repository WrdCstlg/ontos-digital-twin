import { useMemo } from 'react';
import { Lock, Plus, Zap } from 'lucide-react';
import { ModuleBadge } from '@/components/ui/module-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ago } from '@/components/operations/utils';
import { cn } from '@/lib/utils';
import { ActionStatusBadge } from './Badges';
import { badgeModule } from './links';
import type { ActionTypeRow } from './types';

export interface CatalogueProps {
  types: ActionTypeRow[];
  isLoading: boolean;
  error: string | null;
  onReload: () => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  now: number;
  canAuthor: boolean;
  onCreate: () => void;
}

function reason(t: ActionTypeRow): string | null {
  if (t.canSubmit) return null;
  if (t.deniedBecause) return t.deniedBecause;
  return t.status === 'draft' ? 'A draft: not runnable until it is made active' : 'Disabled: not runnable';
}

/**
 * The action types, grouped by module: name, description, status, the
 * minimum role, parameter count and how often it was applied or rejected.
 * A type this person cannot run says why.
 */
export function Catalogue({ types, isLoading, error, onReload, selectedKey, onSelect, now, canAuthor, onCreate }: CatalogueProps) {
  const groups = useMemo(() => {
    const out: { module: ActionTypeRow['module']; types: ActionTypeRow[] }[] = [];
    for (const t of types) {
      const g = out.find((x) => x.module.key === t.module.key);
      if (g) g.types.push(t);
      else out.push({ module: t.module, types: [t] });
    }
    return out;
  }, [types]);

  return (
    <section className="min-w-0 rounded-xl border border-border-hairline bg-bg-panel" aria-label="Action types">
      <div className="flex items-center gap-2.5 border-b border-border-hairline px-4 py-3">
        <Zap className="size-4 text-text-muted" />
        <h2 className="font-display text-[16px] font-semibold text-text-primary">Action types</h2>
        {!isLoading && !error && <span className="font-mono text-[11px] text-text-muted">{types.length}</span>}
      </div>

      {isLoading && (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="px-4 py-8 text-center text-[13px] text-text-muted">
          The action types could not be loaded: <span className="break-words font-mono text-[12px] text-risk">{error}</span>{' '}
          <button type="button" onClick={onReload} className="text-text-accent hover:underline">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && types.length === 0 && (
        <div className="px-4 py-10 text-center">
          <p className="text-[13px] text-text-secondary">No action types in this workspace yet.</p>
          <p className="mt-1 font-mono text-[11px] text-text-muted">
            {canAuthor ? 'define one: parameters, criteria and the edits it makes' : 'an ontologist or admin defines them'}
          </p>
          {canAuthor && (
            <button
              type="button"
              onClick={onCreate}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-iris/40 bg-iris/15 px-3.5 py-2 text-[13px] font-medium text-text-accent transition-colors hover:bg-iris/25"
            >
              <Plus className="size-3.5" /> New action type
            </button>
          )}
        </div>
      )}

      {!isLoading && !error && groups.length > 0 && (
        <div className="space-y-4 p-3 sm:p-4">
          {groups.map((g) => (
            <div key={g.module.key} role="group" aria-label={g.module.name}>
              <div className="mb-2 flex items-center gap-2">
                <ModuleBadge module={badgeModule(g.module.key)} long />
                <span className="font-mono text-[10.5px] text-text-muted">{g.types.length}</span>
              </div>
              <ul className="space-y-2">
                {g.types.map((t) => {
                  const why = reason(t);
                  const selected = selectedKey === t.key;
                  const last = t.submissions.lastAt;
                  return (
                    <li key={t.key}>
                      <button
                        type="button"
                        onClick={() => onSelect(t.key)}
                        aria-current={selected ? 'true' : undefined}
                        data-testid="action-type"
                        className={cn(
                          'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                          selected
                            ? 'border-iris/50 bg-bg-panel-raised/70'
                            : 'border-border-hairline hover:border-border-glow hover:bg-bg-panel-raised/40',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-[14px] font-medium text-text-primary">{t.displayName}</span>
                          <ActionStatusBadge status={t.status} className="shrink-0 pt-0.5" />
                        </div>
                        {t.description && (
                          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.5] text-text-secondary">{t.description}</p>
                        )}
                        <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-text-muted">
                          <span>{t.key}</span>
                          <span>min {t.minRole}</span>
                          <span>
                            {t.definition.parameters.length} param{t.definition.parameters.length === 1 ? '' : 's'}
                          </span>
                          <span>
                            <span className="text-ok/90">{t.submissions.applied} applied</span> ·{' '}
                            <span className={t.submissions.rejected ? 'text-risk/90' : undefined}>{t.submissions.rejected} rejected</span>
                          </span>
                          {last && <span>last {ago(last, now)}</span>}
                        </p>
                        {why && (
                          <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-warn/90">
                            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                            <span className="min-w-0">{why}</span>
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
