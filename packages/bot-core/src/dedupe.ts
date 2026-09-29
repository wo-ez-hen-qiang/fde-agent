/**
 * In-memory TTL de-duplicator for platform event ids.
 * Feishu re-delivers an event (same event_id) when it does not get a 200 within ~3s,
 * retrying for hours, so ids are remembered for `ttlMs` (default 12h) and the set is
 * size-capped (oldest evicted first). Single-process only; see design doc for multi-replica.
 */
export class EventDeduper {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 12 * 60 * 60 * 1000,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true the first time a key is seen (within TTL), false for duplicates. */
  firstSeen(key: string): boolean {
    const t = this.now();
    const prev = this.seen.get(key);
    if (prev !== undefined && t - prev < this.ttlMs) return false;
    this.seen.delete(key);
    this.seen.set(key, t);
    this.evict(t);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }

  private evict(t: number): void {
    // Map iterates in insertion order -> oldest first
    for (const [k, ts] of this.seen) {
      if (this.seen.size <= this.maxEntries && t - ts < this.ttlMs) break;
      this.seen.delete(k);
    }
  }
}
