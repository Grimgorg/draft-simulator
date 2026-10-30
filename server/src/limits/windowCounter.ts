/** Counts events per key (a client address) within a fixed window that starts at the key's first event. */
export interface WindowCounter {
  /** Events counted for `key` in its current window; 0 once the window has passed. */
  count(key: string): number;
  add(key: string): void;
  reset(key: string): void;
}

/**
 * Past this many keys, adding a new one first drops every key whose window has passed, so an attacker cycling
 * through addresses can't grow the map past the keys active within one window.
 */
const PRUNE_AT = 10_000;

export function createWindowCounter(windowMs: number, now: () => number = Date.now): WindowCounter {
  const entries = new Map<string, { count: number; windowStart: number }>();

  function current(key: string) {
    const entry = entries.get(key);
    if (entry && now() - entry.windowStart < windowMs) return entry;
    entries.delete(key);
    return undefined;
  }

  return {
    count: (key) => current(key)?.count ?? 0,
    add(key) {
      const entry = current(key);
      if (entry) {
        entry.count++;
        return;
      }
      if (entries.size >= PRUNE_AT) {
        for (const [other, { windowStart }] of entries) {
          if (now() - windowStart >= windowMs) entries.delete(other);
        }
      }
      entries.set(key, { count: 1, windowStart: now() });
    },
    reset(key) {
      entries.delete(key);
    },
  };
}
