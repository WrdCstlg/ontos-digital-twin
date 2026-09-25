import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatSeconds, payloadMappingId, prettyJson, secondsUntil, stamp, type JobRow } from './utils';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">{children}</dd>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-hairline bg-bg-inset p-3">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <pre className="max-h-64 overflow-auto font-mono text-[11px] leading-[1.5] text-text-secondary">{prettyJson(value)}</pre>
    </div>
  );
}

export interface JobDetailProps {
  job: JobRow;
  now: number;
  mappingName?: string | null;
}

/** Everything the queue knows about one job: timings, lease, payload, result, error history. */
export function JobDetail({ job, now, mappingName }: JobDetailProps) {
  const runIn = job.status === 'queued' ? secondsUntil(job.runAfter, now) : null;
  const leaseLeft = job.status === 'running' ? secondsUntil(job.leaseExpiresAt, now) : null;
  const mappingId = payloadMappingId(job);

  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border-hairline bg-bg-inset p-3 md:grid-cols-4">
        <Field label="Created">
          {stamp(job.createdAt)}
          {job.createdBy && <span className="text-text-muted"> · {job.createdBy}</span>}
        </Field>
        <Field label="Started">{stamp(job.startedAt)}</Field>
        <Field label="Finished">{stamp(job.finishedAt)}</Field>
        <Field label="Run after">
          {stamp(job.runAfter)}
          {runIn != null && runIn > 0 && <span className="text-warn"> · in {formatSeconds(runIn)}</span>}
        </Field>
        <Field label="Attempts">
          {job.attempts} of {job.maxAttempts}
        </Field>
        <Field label="Lease owner">{job.leaseOwner ?? '—'}</Field>
        <Field label="Lease expires">
          {stamp(job.leaseExpiresAt)}
          {leaseLeft != null && (
            <span className={leaseLeft >= 0 ? 'text-ok' : 'text-risk'}>
              {' '}
              · {leaseLeft >= 0 ? `${formatSeconds(leaseLeft)} left` : `lapsed ${formatSeconds(-leaseLeft)} ago`}
            </span>
          )}
        </Field>
        <Field label="Kind">{job.kind}</Field>
      </dl>

      {job.lastError && (
        <div
          className={cn(
            'rounded-lg border p-3',
            job.status === 'failed' ? 'border-risk/30 bg-risk/5' : 'border-border-hairline bg-bg-inset',
          )}
        >
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
            Last error{job.status === 'succeeded' ? ' (recovered)' : ''}
          </div>
          <pre
            className={cn(
              'whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5]',
              job.status === 'failed' ? 'text-risk' : job.status === 'succeeded' ? 'text-text-muted' : 'text-warn',
            )}
          >
            {job.lastError}
          </pre>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <JsonBlock label="Payload" value={job.payloadJson} />
        <JsonBlock label="Result" value={job.resultJson} />
      </div>

      {mappingId != null && (
        <Link
          to="/app/mapping"
          className="inline-flex w-fit items-center gap-1 font-mono text-[11px] text-text-accent hover:underline"
        >
          {mappingName ? `${mappingName} · ` : ''}open in Mapping &amp; Sync <ArrowRight className="size-3" />
        </Link>
      )}
    </div>
  );
}
