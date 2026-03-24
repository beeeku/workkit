export function createCache(kv?: KVNamespace) {
  let generation = 0;
  let generationLoaded = false;

  async function loadGeneration() {
    if (!kv || generationLoaded) return;
    const val = await kv.get("memory:gen");
    generation = val ? parseInt(val, 10) : 0;
    generationLoaded = true;
  }

  function cacheKey(key: string) {
    return `gen${generation}:${key}`;
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      if (!kv) return null;
      await loadGeneration();
      const raw = await kv.get(cacheKey(key), "text");
      return raw ? JSON.parse(raw) : null;
    },

    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      if (!kv) return;
      await loadGeneration();
      await kv.put(cacheKey(key), JSON.stringify(value), { expirationTtl: ttlSeconds });
    },

    async invalidate(): Promise<void> {
      if (!kv) return;
      generation++;
      generationLoaded = true;
      await kv.put("memory:gen", String(generation));
    },

    async invalidateKey(key: string): Promise<void> {
      if (!kv) return;
      await this.invalidate();
      await kv.delete(cacheKey(key));
    },

    get enabled() { return !!kv; },
  };
}
