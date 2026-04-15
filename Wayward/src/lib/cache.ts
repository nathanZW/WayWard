export class LruCache<TKey, TValue> {
  private readonly cache = new Map<TKey, TValue>();

  constructor(private readonly maxSize: number) {}

  get(key: TKey): TValue | undefined {
    const value = this.cache.get(key);
    if (value === undefined) return undefined;

    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: TKey, value: TValue): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, value);

    if (this.cache.size <= this.maxSize) return;

    const oldestKey = this.cache.keys().next().value;
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
