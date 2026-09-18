/**
 * Short-lived cache of normalized command results only. Nothing derived from
 * graph analysis is stored, and entries are invalidated purely by expiry, so a
 * stale dependency graph can never be served from here.
 */
interface CacheEntry<Value> {
  readonly value: Value;
  readonly expiresAt: number;
}

export class ExpiringCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 32,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): Value | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: Value): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    // Refresh insertion order as well as expiry when replacing an entry.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
