import type { ModuleKey } from '@/lib/modules';

/** Links into and out of the Actions page, and small shared helpers. */

const KNOWN_MODULES = new Set<string>(['hr', 'legal', 'compliance', 'finance', 'logistics', 'twin']);

/** The module badge key for an API module key; anything the colour system does not know is custom. */
export function badgeModule(key: string | null | undefined): ModuleKey {
  return key && KNOWN_MODULES.has(key) ? (key as ModuleKey) : 'custom';
}

/** An object in the Graph Explorer, opened in its detail drawer. */
export function explorerHref(iri: string): string {
  return `/app/explorer?${new URLSearchParams({ iri }).toString()}`;
}

/** The run panel for an action, prefilled: `/app/actions?run=<key>&<param>=<value>`. */
export function runHref(key: string, prefill: Record<string, string> = {}): string {
  return `/app/actions?${new URLSearchParams({ run: key, ...prefill }).toString()}`;
}

/** A submission's detail on the Actions page. */
export function submissionHref(id: number): string {
  return `/app/actions?submission=${id}`;
}

/** A background job on the Operations page. */
export function jobHref(id: number): string {
  return `/app/operations?job=${id}`;
}

/** The tRPC error code of a failed call (FORBIDDEN, CONFLICT, …). */
export function errorCode(err: unknown): string | undefined {
  return (err as { data?: { code?: string } } | null)?.data?.code;
}
