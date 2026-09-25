import { History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ago, stamp } from '@/components/operations/utils';
import { cn } from '@/lib/utils';
import { SubmissionStatusBadge } from './Badges';
import { summariseSubmission } from './words';
import type { SubmissionRow } from './types';

export type SubmissionFilter = 'all' | 'applied' | 'rejected';

export interface SubmissionHistoryProps {
  submissions: SubmissionRow[];
  isLoading: boolean;
  error: string | null;
  onReload: () => void;
  /** Action types to filter by, key and name. */
  actions: { key: string; displayName: string }[];
  actionKey: string;
  onActionKey: (key: string) => void;
  status: SubmissionFilter;
  onStatus: (s: SubmissionFilter) => void;
  onOpen: (id: number) => void;
  openId: number | null;
  limit: number;
  now: number;
}

const FILTERS: { key: SubmissionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'applied', label: 'Applied' },
  { key: 'rejected', label: 'Rejected' },
];

/**
 * Every submission, newest first: when, which action, who, applied or
 * rejected, and one line on what it changed or why it was refused.
 */
export function SubmissionHistory({
  submissions,
  isLoading,
  error,
  onReload,
  actions,
  actionKey,
  onActionKey,
  status,
  onStatus,
  onOpen,
  openId,
  limit,
  now,
}: SubmissionHistoryProps) {
  const nameOf = new Map(actions.map((a) => [a.key, a.displayName]));
  const cols = 5;
  return (
    <section className="min-w-0 rounded-xl border border-border-hairline bg-bg-panel" aria-label="Submission history">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-hairline px-4 py-3">
        <History className="size-4 text-text-muted" />
        <h2 className="font-display text-[16px] font-semibold text-text-primary">Submission history</h2>
        <select
          value={actionKey}
          onChange={(e) => onActionKey(e.target.value)}
          aria-label="Filter by action"
          className="h-8 min-w-0 max-w-full rounded-lg border border-border-hairline bg-bg-inset px-2 text-[12px] text-text-secondary outline-none focus:border-border-glow"
        >
          <option value="">Every action</option>
          {actions.map((a) => (
            <option key={a.key} value={a.key}>
              {a.displayName}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 rounded-lg border border-border-hairline bg-bg-inset p-1" role="group" aria-label="Result filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onStatus(f.key)}
              aria-pressed={status === f.key}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] transition-colors',
                status === f.key ? 'bg-bg-panel-raised text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10.5px] text-text-muted sm:ml-auto">newest {limit}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-border-hairline">
              {[
                { h: 'When', cls: 'w-[84px] sm:w-[110px]' },
                { h: 'Action', cls: 'sm:w-[30%] md:w-[24%]' },
                { h: 'By', cls: 'hidden md:table-cell md:w-[16%]' },
                { h: 'Result', cls: 'w-[92px]' },
                { h: 'Summary', cls: 'hidden sm:table-cell' },
              ].map(({ h, cls }) => (
                <th
                  key={h}
                  className={cn('whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted', cls)}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 4 }, (_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border-hairline/50">
                  <td colSpan={cols} className="px-3 py-1.5">
                    <Skeleton className="h-7 w-full" />
                  </td>
                </tr>
              ))}
            {!isLoading && error && (
              <tr>
                <td colSpan={cols} className="px-3 py-8 text-center text-[13px] text-text-muted">
                  The history could not be loaded: <span className="break-words font-mono text-[12px] text-risk">{error}</span>{' '}
                  <button type="button" onClick={onReload} className="text-text-accent hover:underline">
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {!isLoading && !error && submissions.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-3 py-10 text-center">
                  <p className="text-[13px] text-text-secondary">
                    {actionKey || status !== 'all' ? 'No submissions match these filters.' : 'No action has been submitted yet.'}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-text-muted">
                    {actionKey || status !== 'all'
                      ? 'clear the filters to see every submission'
                      : 'applied and rejected submissions both appear here'}
                  </p>
                </td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              submissions.map((s) => {
                const summary = summariseSubmission(s);
                return (
                  <tr
                    key={s.id}
                    onClick={() => onOpen(s.id)}
                    className={cn(
                      'cursor-pointer border-b border-border-hairline/50 align-top transition-colors hover:bg-bg-panel-raised',
                      openId === s.id && 'bg-bg-panel-raised/60',
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-text-secondary" title={stamp(s.createdAt)}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(s.id);
                        }}
                        className="text-left text-text-accent hover:underline"
                        aria-label={`Open submission ${s.id}`}
                      >
                        #{s.id}
                      </button>
                      <div className="text-text-muted">{ago(s.createdAt, now)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="truncate text-[12.5px] text-text-primary">{nameOf.get(s.actionKey) ?? s.actionKey}</div>
                      <div className="truncate font-mono text-[10.5px] text-text-muted">
                        {s.actionKey} v{s.actionVersion}
                        <span className="md:hidden"> · {s.submittedBy}</span>
                      </div>
                      <div
                        className={cn('mt-0.5 line-clamp-2 text-[11.5px] sm:hidden', s.status === 'rejected' ? 'text-risk/90' : 'text-text-secondary')}
                      >
                        {summary}
                      </div>
                    </td>
                    <td className="hidden truncate px-3 py-2 text-[12px] text-text-secondary md:table-cell" title={s.submittedBy}>
                      {s.submittedBy}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <SubmissionStatusBadge status={s.status} />
                    </td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <span
                        className={cn('block truncate text-[12px]', s.status === 'rejected' ? 'text-risk/90' : 'text-text-secondary')}
                        title={summary}
                      >
                        {summary}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
