import { useState } from 'react';
import { BookOpen, Loader2, PencilRuler, Play, X } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { ModuleBadge } from '@/components/ui/module-badge';
import { cn } from '@/lib/utils';
import { ActionStatusBadge, MetaChip } from './Badges';
import { ActionTypeEditor } from './ActionTypeEditor';
import { DefinitionView } from './DefinitionView';
import { RunPanel } from './RunPanel';
import { badgeModule, errorCode } from './links';
import { prefillSignature, valuesFromSearch } from './form';

type Tab = 'run' | 'definition' | 'edit';

const TABS: { key: Tab; label: string; icon: typeof Play }[] = [
  { key: 'run', label: 'Run', icon: Play },
  { key: 'definition', label: 'Definition', icon: BookOpen },
  { key: 'edit', label: 'Edit', icon: PencilRuler },
];

export interface ActionPanelProps {
  actionKey: string;
  /** The page's search params: `?run=<key>&<param>=<value>` prefills the form. */
  search: URLSearchParams;
  canAuthor: boolean;
  onClose: () => void;
}

/**
 * One action type: run it, read its definition, or (authors) edit it. Opens
 * on Run when this person can submit it and on Definition when they cannot.
 */
export function ActionPanel({ actionKey, search, canAuthor, onClose }: ActionPanelProps) {
  const q = trpc.actions.getType.useQuery(
    { key: actionKey },
    { retry: (count, err) => errorCode(err) !== 'NOT_FOUND' && errorCode(err) !== 'BAD_REQUEST' && count < 1 },
  );
  const asked = search.get('tab');
  const [tab, setTab] = useState<Tab | null>(asked === 'run' || asked === 'definition' || asked === 'edit' ? asked : null);
  const t = q.data;

  if (q.isLoading) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 font-mono text-[12px] text-text-muted">
        <Loader2 className="size-4 animate-spin text-iris-bright" /> loading {actionKey} …
      </div>
    );
  }
  if (q.isError || !t) {
    const code = errorCode(q.error);
    return (
      <div className="p-5 text-[13px]">
        <p className="text-text-primary">
          {code === 'NOT_FOUND' || code === 'BAD_REQUEST' ? `There is no action type “${actionKey}”.` : 'The action type could not be loaded.'}
        </p>
        <p className="mt-1 break-words font-mono text-[12px] text-risk">{q.error?.message}</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void q.refetch()} className="text-[12.5px] text-text-accent hover:underline">
            Retry
          </button>
          <button type="button" onClick={onClose} className="text-[12.5px] text-text-muted hover:text-text-primary">
            Close
          </button>
        </div>
      </div>
    );
  }

  const current: Tab = tab === 'edit' && !canAuthor ? 'run' : (tab ?? (t.canSubmit ? 'run' : 'definition'));
  const tabs = TABS.filter((x) => x.key !== 'edit' || canAuthor);

  return (
    <div>
      <div className="border-b border-border-hairline px-4 py-3 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ModuleBadge module={badgeModule(t.module.key)} />
              <ActionStatusBadge status={t.status} />
              <MetaChip>v{t.version}</MetaChip>
              <MetaChip>min {t.minRole}</MetaChip>
            </div>
            <h2 className="mt-2 font-display text-[20px] font-semibold leading-tight text-text-primary">{t.displayName}</h2>
            <p className="mt-0.5 font-mono text-[11px] text-text-muted">{t.key}</p>
            {t.description && <p className="mt-1.5 text-[13px] leading-[1.55] text-text-secondary">{t.description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-panel-raised hover:text-text-primary"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border-hairline bg-bg-inset p-1" role="tablist" aria-label="Action views">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={current === key}
              onClick={() => setTab(key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] transition-colors',
                current === key ? 'bg-bg-panel-raised text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Run and Edit stay mounted while hidden, so switching tabs keeps a half-filled form or unsaved edits. */}
      <div className="p-4 sm:p-5" role="tabpanel" aria-label={TABS.find((x) => x.key === current)?.label}>
        <div hidden={current !== 'run'}>
          <RunPanel
            // A new deep link starts a fresh form.
            key={prefillSignature(search)}
            actionKey={t.key}
            definition={t.definition}
            canSubmit={t.canSubmit}
            deniedBecause={t.deniedBecause}
            status={t.status}
            initialValues={valuesFromSearch(t.definition.parameters, search)}
          />
        </div>
        {current === 'definition' && <DefinitionView definition={t.definition} />}
        {canAuthor && (
          <div hidden={current !== 'edit'}>
            <ActionTypeEditor key={t.key} type={t} onSaved={() => undefined} />
          </div>
        )}
      </div>
    </div>
  );
}
