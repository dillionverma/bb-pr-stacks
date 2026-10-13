// A small stale-while-revalidate memo. No BB or Node imports, so the host
// entry and the server share it and tests drive it with a fake clock.
//
// Three ages of an entry:
// - fresh: handed back as is;
// - stale: handed back at once, and a refresh starts in the background;
// - expired: the caller waits for a new value.
// Concurrent callers for one key share a single in-flight load.

export interface SwrCacheOptions {
  /** How long a value is returned without any refresh. */
  freshMs: number;
  /** How long past `freshMs` a value is still returned while refreshing. */
  staleMs: number;
  now?: () => number;
}

export interface SwrCache<K, V> {
  get(key: K, load: () => Promise<V>): Promise<V>;
  /** Forget one key, or everything. */
  clear(key?: K): void;
}

export function createSwrCache<K, V>(options: SwrCacheOptions): SwrCache<K, V> {
  const now = options.now ?? Date.now;
  const entries = new Map<K, { at: number; value: V }>();
  const inFlight = new Map<K, Promise<V>>();

  function refresh(key: K, load: () => Promise<V>): Promise<V> {
    const pending = inFlight.get(key);
    if (pending !== undefined) return pending;
    const next = load()
      .then((value) => {
        entries.set(key, { at: now(), value });
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, next);
    return next;
  }

  return {
    async get(key, load) {
      const hit = entries.get(key);
      const age = hit === undefined ? Infinity : now() - hit.at;
      if (hit !== undefined && age < options.freshMs) return hit.value;
      const pending = refresh(key, load);
      if (hit !== undefined && age < options.freshMs + options.staleMs) {
        // Stale: serve what we have; the refresh lands for the next caller.
        // Its failure is that caller's to see, not ours to leak as unhandled.
        pending.catch(() => {});
        return hit.value;
      }
      return pending;
    },
    clear(key) {
      if (key === undefined) {
        entries.clear();
        inFlight.clear();
      } else {
        entries.delete(key);
        inFlight.delete(key);
      }
    },
  };
}
