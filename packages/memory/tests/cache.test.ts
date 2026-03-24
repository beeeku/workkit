import { describe, it, expect, vi } from "vitest";
import { createCache } from "../src/cache";

function createMockKV() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    get: vi.fn(async (key: string) => store.get(key)?.value ?? null),
    put: vi.fn(async (key: string, value: string, opts?: any) => {
      store.set(key, { value, ttl: opts?.expirationTtl });
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    _store: store,
  } as any;
}

describe("createCache", () => {
  it("is disabled when no kv provided", () => {
    const cache = createCache();
    expect(cache.enabled).toBe(false);
  });

  it("is enabled when kv provided", () => {
    const kv = createMockKV();
    const cache = createCache(kv);
    expect(cache.enabled).toBe(true);
  });

  it("get returns null when no kv", async () => {
    const cache = createCache();
    const result = await cache.get("key");
    expect(result).toBeNull();
  });

  it("set is no-op when no kv", async () => {
    const cache = createCache();
    await expect(cache.set("key", { foo: "bar" }, 60)).resolves.toBeUndefined();
  });

  it("invalidate is no-op when no kv", async () => {
    const cache = createCache();
    await expect(cache.invalidate()).resolves.toBeUndefined();
  });

  it("stores and retrieves values with generation prefix", async () => {
    const kv = createMockKV();
    const cache = createCache(kv);

    await cache.set("mykey", { hello: "world" }, 300);
    const result = await cache.get<{ hello: string }>("mykey");

    expect(result).toEqual({ hello: "world" });
    // Should have used generation prefix in the key
    const storedKeys = [...kv._store.keys()];
    expect(storedKeys.some(k => k.includes("mykey") && k.startsWith("gen"))).toBe(true);
  });

  it("stores value with ttl", async () => {
    const kv = createMockKV();
    const cache = createCache(kv);

    await cache.set("ttlkey", "value", 120);

    // Find the stored entry (not memory:gen)
    let stored: { value: string; ttl?: number } | undefined;
    for (const [k, v] of kv._store.entries()) {
      if (k.includes("ttlkey")) stored = v;
    }

    expect(stored).toBeDefined();
    expect(stored!.ttl).toBe(120);
  });

  it("invalidate bumps generation", async () => {
    const kv = createMockKV();
    const cache = createCache(kv);

    await cache.set("somekey", "before", 60);
    await cache.invalidate();

    // After invalidation, generation should be 1
    const genVal = kv._store.get("memory:gen");
    expect(genVal).toBeDefined();
    expect(genVal!.value).toBe("1");
  });

  it("get returns null after invalidation (different generation prefix)", async () => {
    const kv = createMockKV();
    const cache = createCache(kv);

    await cache.set("mykey", "cached_value", 300);
    await cache.invalidate();

    // After invalidation, the old key (gen0:mykey) is no longer looked up
    const result = await cache.get("mykey");
    expect(result).toBeNull();
  });

  it("invalidateKey bumps generation and deletes the key", async () => {
    const kv = createMockKV();
    const cache = createCache(kv);

    await cache.set("targetkey", "value", 60);
    await cache.invalidateKey("targetkey");

    const genVal = kv._store.get("memory:gen");
    expect(genVal!.value).toBe("1");

    // delete should have been called
    expect(kv.delete).toHaveBeenCalled();
  });

  it("loads generation from kv on first access", async () => {
    const kv = createMockKV();
    // Pre-seed the generation in the mock store
    kv._store.set("memory:gen", { value: "5" });

    const cache = createCache(kv);
    await cache.get("anykey");

    // Should have called kv.get to load generation
    expect(kv.get).toHaveBeenCalledWith("memory:gen");
  });

  it("does not reload generation after first load", async () => {
    const kv = createMockKV();
    const cache = createCache(kv);

    await cache.get("key1");
    await cache.get("key2");

    // memory:gen should only be fetched once
    const genCalls = kv.get.mock.calls.filter((c: any[]) => c[0] === "memory:gen");
    expect(genCalls.length).toBe(1);
  });
});
