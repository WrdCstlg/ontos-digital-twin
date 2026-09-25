import { trpc } from '@/providers/trpc';

/**
 * Whether this person may define action types: workspace admins and
 * ontologists, as the API decides from their workspace role. The API refuses
 * authoring calls from anyone else either way.
 */
export function useCanAuthorActions(): boolean {
  const q = trpc.actions.capabilities.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return q.data?.canAuthor ?? false;
}
