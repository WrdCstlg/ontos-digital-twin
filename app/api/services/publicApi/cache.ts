/**
 * A value per key, kept for a few seconds: every Ontology API request needs its
 * workspace's ontology model, and the model changes rarely. Bounded in time
 * (ttlMs, on the monotonic clock) and in size (max keys, oldest dropped first).
 * A load that fails is not kept, so the next request tries again; concurrent
 * requests for the same key share one load. Keys are compared by value (===),
 * so they should be ids, never objects loaded afresh for each request.
 */
export function createTtlCache<K extends string | number, V>(opts: { ttlMs: number; max: number; now?: () => number }) {
  const now = opts.now ?? (() => performance.now());
  const entries = new Map<K, { at: number; value: Promise<V> }>();
  return {
    get(key: K, load: () => Promise<V>): Promise<V> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < opts.ttlMs) return hit.value;
      entries.delete(key);
      const value = load();
      entries.set(key, { at: now(), value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      while (entries.size > opts.max) entries.delete(entries.keys().next().value as K);
      return value;
    },
    /** Forget a key, e.g. after the ontology changed. */
    forget(key: K): void {
      entries.delete(key);
    },
    get size(): number {
      return entries.size;
    },
  };
}
