import { Link } from 'react-router';
import { Lock, Zap } from 'lucide-react';
import { trpc } from '@/providers/trpc';
import { getModule } from '@/lib/modules';
import { Skeleton } from '@/components/ui/skeleton';
import { badgeModule, runHref } from './links';
import type { ForObjectRow } from './types';

function ActionLink({ row, iri }: { row: ForObjectRow; iri: string }) {
  const color = getModule(badgeModule(row.module.key)).color;
  if (!row.canSubmit) {
    return (
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-hairline px-2 py-1 text-[12px] text-text-muted"
        title={row.deniedBecause ?? undefined}
      >
        <Lock className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{row.displayName}</span>
        <span className="sr-only">: {row.deniedBecause}</span>
      </span>
    );
  }
  return (
    <Link
      to={runHref(row.key, { [row.paramName]: iri })}
      title={row.description ?? undefined}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] text-text-primary transition-colors hover:bg-bg-panel-raised"
      style={{ borderColor: `${color}55` }}
    >
      <Zap className="size-3 shrink-0" style={{ color }} aria-hidden />
      <span className="truncate">{row.displayName}</span>
    </Link>
  );
}

/**
 * The actions an object can be the subject of, each a link to its run panel
 * with the object filled in. For the Explorer's object drawer.
 */
export function ObjectActionLinks({ iri }: { iri: string }) {
  const q = trpc.actions.forObject.useQuery({ iri }, { staleTime: 30_000, retry: 1 });
  if (q.isLoading) return <Skeleton className="h-7 w-2/3" />;
  if (q.isError) return <p className="font-mono text-[11px] text-risk">{q.error.message}</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <p className="text-[12px] text-text-muted">No action type applies to this object.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((r) => (
        <ActionLink key={r.key} row={r} iri={iri} />
      ))}
    </div>
  );
}

/**
 * "Act on it": for each object an insight's evidence names, the actions that
 * apply to it. Objects no action applies to are left out.
 */
export function ActOnIt({ iris }: { iris: string[] }) {
  const results = trpc.useQueries((t) => iris.map((iri) => t.actions.forObject({ iri }, { staleTime: 30_000, retry: 1 })));
  const loading = results.some((r) => r.isLoading);
  const rows = iris
    .map((iri, i) => ({ iri, actions: results[i]?.data ?? [] }))
    .filter((r) => r.actions.length > 0);

  if (loading && rows.length === 0) return <Skeleton className="h-10 w-full" />;
  if (rows.length === 0) {
    return <p className="text-[13px] text-text-muted">No action type applies to the objects in this evidence.</p>;
  }
  return (
    <ul className="divide-y divide-border-hairline rounded-lg border border-border-hairline" aria-label="Act on it">
      {rows.map((r) => (
        <li key={r.iri} className="space-y-1.5 px-3 py-2.5">
          <div className="truncate font-mono text-[11.5px] text-text-secondary" title={r.iri}>
            {r.iri}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {r.actions.map((a) => (
              <ActionLink key={a.key} row={a} iri={r.iri} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
