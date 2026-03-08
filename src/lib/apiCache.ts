/** Keyed in-memory cache with TTL and max entry limit. */
export class ApiCache<T> {
  private cache = new Map<string, { data: T; fetchedAt: number }>();

  constructor(
    private ttl: number,
    private maxEntries = 200
  ) {}

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, { data, fetchedAt: Date.now() });
    if (this.cache.size > this.maxEntries) {
      const now = Date.now();
      for (const [k, v] of this.cache) {
        if (now - v.fetchedAt > this.ttl) this.cache.delete(k);
      }
    }
  }
}

/** Single-value in-memory cache with TTL. */
export class SingleCache<T> {
  private entry: { data: T; fetchedAt: number } | null = null;

  constructor(private ttl: number) {}

  get(): T | null {
    if (!this.entry) return null;
    if (Date.now() - this.entry.fetchedAt > this.ttl) {
      this.entry = null;
      return null;
    }
    return this.entry.data;
  }

  set(data: T): void {
    this.entry = { data, fetchedAt: Date.now() };
  }
}
