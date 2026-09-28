import { trpc } from '@/providers/trpc';

/**
 * Whether this person may run the twin simulation: a tick writes twin state,
 * so it is for editors and above, as the API decides from their workspace
 * role. The API refuses a tick from anyone else either way.
 */
export function useCanSimulate(): boolean {
  const q = trpc.twin.capabilities.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return q.data?.canSimulate ?? false;
}
