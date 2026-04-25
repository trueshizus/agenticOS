/**
 * DedupStore: the idempotency boundary.
 *
 * Persistence model — DELIBERATE CHOICE:
 *   v0 uses an in-memory `Set<string>`. Restarting the process forgets every
 *   seen id. This is fine for a single-process runtime where the source
 *   re-validates on reconnect, and it keeps the trace as the single source of
 *   truth. Replace with a JSONL- or SQLite-backed store when the runtime needs
 *   to survive restarts; the contract below is the only thing callers depend on.
 */
export interface DedupStore {
  /** Returns true if the id was newly recorded; false if it was already present. */
  recordIfAbsent(id: string): boolean;
  has(id: string): boolean;
  size(): number;
}

export function createInMemoryDedupStore(): DedupStore {
  const seen = new Set<string>();
  return {
    recordIfAbsent(id) {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    has(id) {
      return seen.has(id);
    },
    size() {
      return seen.size;
    },
  };
}
