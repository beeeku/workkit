import { ConfigError } from "@workkit/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withCache } from "../src/cache";
import type { AiInput, AiOutput, CacheStorage, Gateway } from "../src/types";

// --- Mock helpers ---

function createMockStorage(): CacheStorage & { _store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		_store: store,
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
			if (options?.expirationTtl === 1) {
				store.delete(key);
			} else {
				store.set(key, value);
			}
		}),
	};
}

function createMockGateway(
	result?: Partial<AiOutput>,
): Gateway & { runMock: ReturnType<typeof vi.fn> } {
	const defaultResult: AiOutput = {
		text: "Gateway response",
		raw: { text: "Gateway response" },
		provider: "test",
		model: "test-model",
		...result,
	};
	const runMock = vi.fn().mockResolvedValue(defaultResult);
	return {
		runMock,
		run: runMock,
		providers: () => ["test"],
		defaultProvider: () => "test",
	};
}

describe("withCache()", () => {
	it("throws ConfigError without storage", () => {
		const gw = createMockGateway();
		expect(() => withCache(gw, { storage: null as any })).toThrow(ConfigError);
	});

	it("creates a cached gateway with valid config", () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });
		expect(cached).toBeDefined();
		expect(typeof cached.run).toBe("function");
		expect(typeof cached.isCached).toBe("function");
		expect(typeof cached.invalidate).toBe("function");
	});

	it("proxies providers() to underlying gateway", () => {
		const gw = createMockGateway();
		const cached = withCache(gw, { storage: createMockStorage() });
		expect(cached.providers()).toEqual(["test"]);
	});

	it("proxies defaultProvider() to underlying gateway", () => {
		const gw = createMockGateway();
		const cached = withCache(gw, { storage: createMockStorage() });
		expect(cached.defaultProvider()).toBe("test");
	});
});

describe("run() — cache miss", () => {
	let gw: ReturnType<typeof createMockGateway>;
	let storage: ReturnType<typeof createMockStorage>;

	beforeEach(() => {
		gw = createMockGateway();
		storage = createMockStorage();
	});

	it("calls underlying gateway on cache miss", async () => {
		const cached = withCache(gw, { storage });
		await cached.run("model", { prompt: "test" });
		expect(gw.runMock).toHaveBeenCalledOnce();
	});

	it("stores result in cache after miss", async () => {
		const cached = withCache(gw, { storage });
		await cached.run("model", { prompt: "test" });
		expect(storage.put).toHaveBeenCalled();
	});

	it("stores with default TTL of 3600", async () => {
		const cached = withCache(gw, { storage });
		await cached.run("model", { prompt: "test" });
		expect(storage.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
			expirationTtl: 3600,
		});
	});

	it("stores with custom TTL", async () => {
		const cached = withCache(gw, { storage, ttl: 7200 });
		await cached.run("model", { prompt: "test" });
		expect(storage.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
			expirationTtl: 7200,
		});
	});

	it("returns the gateway result on miss", async () => {
		const cached = withCache(gw, { storage });
		const result = await cached.run("model", { prompt: "test" });
		expect(result.text).toBe("Gateway response");
	});
});

describe("run() — cache hit", () => {
	it("returns cached result without calling gateway", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		// First call — cache miss
		await cached.run("model", { prompt: "test" });
		expect(gw.runMock).toHaveBeenCalledOnce();

		// Second call — cache hit
		const result = await cached.run("model", { prompt: "test" });
		expect(gw.runMock).toHaveBeenCalledOnce(); // still 1
		expect(result.text).toBe("Gateway response");
	});

	it("different inputs produce different cache keys", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		await cached.run("model", { prompt: "hello" });
		await cached.run("model", { prompt: "world" });
		expect(gw.runMock).toHaveBeenCalledTimes(2);
	});

	it("different models produce different cache keys", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		await cached.run("model-a", { prompt: "test" });
		await cached.run("model-b", { prompt: "test" });
		expect(gw.runMock).toHaveBeenCalledTimes(2);
	});

	it("same messages input hits cache", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		const input: AiInput = {
			messages: [{ role: "user", content: "Hello" }],
		};

		await cached.run("model", input);
		await cached.run("model", input);
		expect(gw.runMock).toHaveBeenCalledOnce();
	});
});

describe("run() — custom hash function", () => {
	it("uses custom hashFn for cache key", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const hashFn = vi.fn((model: string, input: AiInput) => `custom:${model}`);

		const cached = withCache(gw, { storage, hashFn });
		await cached.run("model", { prompt: "test" });

		expect(hashFn).toHaveBeenCalledWith("model", { prompt: "test" });
		expect(storage.put).toHaveBeenCalledWith(
			"custom:model",
			expect.any(String),
			expect.any(Object),
		);
	});

	it("custom hashFn controls cache grouping", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		// Hash only by model — all inputs for same model share cache
		const hashFn = (_model: string, _input: AiInput) => "same-key";

		const cached = withCache(gw, { storage, hashFn });
		await cached.run("model", { prompt: "hello" });
		await cached.run("model", { prompt: "world" });
		expect(gw.runMock).toHaveBeenCalledOnce();
	});
});

describe("run() — corrupted cache", () => {
	it("falls through to gateway when cache has invalid JSON", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		// Manually put bad data
		const hashFn = (withCache as any).__defaultHashFn;
		// Simulate corrupted cache by directly setting in storage
		storage._store.set('ai-cache:model:{"prompt":"test"}', "not valid json{{{");
		// Ensure get returns it
		storage.get = vi.fn(async (key: string) => storage._store.get(key) ?? null);

		const result = await cached.run("model", { prompt: "test" });
		expect(gw.runMock).toHaveBeenCalled();
		expect(result.text).toBe("Gateway response");
	});
});

describe("isCached()", () => {
	it("returns false when not cached", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		const result = await cached.isCached("model", { prompt: "test" });
		expect(result).toBe(false);
	});

	it("returns true after caching", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		await cached.run("model", { prompt: "test" });
		const result = await cached.isCached("model", { prompt: "test" });
		expect(result).toBe(true);
	});
});

describe("invalidate()", () => {
	it("removes cached entry", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		await cached.run("model", { prompt: "test" });
		expect(await cached.isCached("model", { prompt: "test" })).toBe(true);

		await cached.invalidate("model", { prompt: "test" });
		expect(await cached.isCached("model", { prompt: "test" })).toBe(false);
	});

	it("forces re-fetch after invalidation", async () => {
		const gw = createMockGateway();
		const storage = createMockStorage();
		const cached = withCache(gw, { storage });

		await cached.run("model", { prompt: "test" });
		expect(gw.runMock).toHaveBeenCalledOnce();

		await cached.invalidate("model", { prompt: "test" });
		await cached.run("model", { prompt: "test" });
		expect(gw.runMock).toHaveBeenCalledTimes(2);
	});
});
