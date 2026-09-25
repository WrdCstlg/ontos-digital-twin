import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs`. Lets relative times
 * ("12s ago", "8s left on lease") advance between data refreshes while
 * keeping render itself pure.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
