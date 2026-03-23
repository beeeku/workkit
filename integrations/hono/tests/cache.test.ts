import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheResponse } from "../src/cache";

function createMockCache() {
	const store = new Map<string, Response>();

	return {
		match: vi.fn(async (req: Request) => {
			return store.get(req.url) ?? undefined;
		}),
		put: vi.fn(async (req: Request, res: Response) => {
			store.set(req.url, res);
		}),
		delete: vi.fn(),
		_store: store,
	} as unknown as Cache & { _store: Map<string, Response> };
}

function createExecutionCtx() {
	return {
		waitUntil: vi.fn((p: Promise<any>) => p),
		passThroughOnException: vi.fn(),
	};
}

describe("cacheResponse() middleware", () => {
	let cache: ReturnType<typeof createMockCache>;

	beforeEach(() => {
		cache = createMockCache();
	});

	it("calls handler on cache miss", async () => {
		const handler = vi.fn(async (c: any) => c.json({ data: "fresh" }));
		const app = new Hono();

		app.get("/api/data", cacheResponse({ ttl: 300, cache }), handler);

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		const res = await app.request(req, undefined, executionCtx);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data).toBe("fresh");
		expect(handler).toHaveBeenCalledOnce();
	});

	it("returns cached response on cache hit", async () => {
		const cachedBody = JSON.stringify({ data: "cached" });
		cache._store.set(
			"http://localhost/api/data",
			new Response(cachedBody, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const handler = vi.fn(async (c: any) => c.json({ data: "fresh" }));
		const app = new Hono();
		app.get("/api/data", cacheResponse({ ttl: 300, cache }), handler);

		const res = await app.request("/api/data");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.data).toBe("cached");
		// Handler should NOT be called on cache hit
		expect(handler).not.toHaveBeenCalled();
	});

	it("stores response in cache after handler", async () => {
		const app = new Hono();
		app.get("/api/data", cacheResponse({ ttl: 300, cache }), async (c) => {
			return c.json({ data: "new" });
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		await app.request(req, undefined, executionCtx);
		expect(cache.put).toHaveBeenCalledOnce();
	});

	it("sets Cache-Control header on cached response", async () => {
		const app = new Hono();
		app.get("/api/data", cacheResponse({ ttl: 600, cache }), async (c) => {
			return c.json({ data: "test" });
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		await app.request(req, undefined, executionCtx);

		// Check that cache.put was called with correct Cache-Control
		const putCall = (cache.put as any).mock.calls[0];
		const cachedResponse = putCall[1] as Response;
		expect(cachedResponse.headers.get("Cache-Control")).toBe("s-maxage=600");
	});

	it("does not cache non-2xx responses", async () => {
		const app = new Hono();
		app.get("/api/data", cacheResponse({ ttl: 300, cache }), async (c) => {
			return c.json({ error: "not found" }, 404);
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		await app.request(req, undefined, executionCtx);
		expect(cache.put).not.toHaveBeenCalled();
	});

	it("does not cache non-GET requests by default", async () => {
		const app = new Hono();
		app.post("/api/data", cacheResponse({ ttl: 300, cache }), async (c) => {
			return c.json({ created: true });
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data", { method: "POST" });
		const res = await app.request(req, undefined, executionCtx);
		expect(res.status).toBe(200);
		expect(cache.match).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
	});

	it("caches specified methods when configured", async () => {
		const app = new Hono();
		app.post("/api/data", cacheResponse({ ttl: 300, cache, methods: ["POST"] }), async (c) => {
			return c.json({ created: true });
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data", { method: "POST" });
		await app.request(req, undefined, executionCtx);
		expect(cache.match).toHaveBeenCalled();
	});

	it("uses custom keyFn for cache key", async () => {
		const app = new Hono();
		app.get(
			"/api/data",
			cacheResponse({
				ttl: 300,
				cache,
				keyFn: (c) => `http://cache/${c.req.path}`,
			}),
			async (c) => c.json({ data: "test" }),
		);

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		await app.request(req, undefined, executionCtx);

		const matchCall = (cache.match as any).mock.calls[0];
		const matchRequest = matchCall[0] as Request;
		expect(matchRequest.url).toBe("http://cache//api/data");
	});

	it("skips caching when no cache available (no caches global)", async () => {
		const app = new Hono();
		app.get(
			"/api/data",
			cacheResponse({ ttl: 300 }), // no cache option, and no global caches
			async (c) => c.json({ data: "test" }),
		);

		// This should not throw even without a cache
		const res = await app.request("/api/data");
		expect(res.status).toBe(200);
	});

	it("does not cache when handler returns 500", async () => {
		const app = new Hono();
		app.get("/api/data", cacheResponse({ ttl: 300, cache }), async (c) => {
			return c.json({ error: "server error" }, 500);
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		await app.request(req, undefined, executionCtx);
		expect(cache.put).not.toHaveBeenCalled();
	});

	it("does not cache when handler returns 301 redirect", async () => {
		const app = new Hono();
		app.get("/old", cacheResponse({ ttl: 300, cache }), async (c) => {
			return c.redirect("/new");
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/old");
		await app.request(req, undefined, executionCtx);
		expect(cache.put).not.toHaveBeenCalled();
	});
});

describe("cacheResponse() jitter", () => {
	let cache: ReturnType<typeof createMockCache>;

	beforeEach(() => {
		cache = createMockCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("without jitter, TTL is exact", async () => {
		const app = new Hono();
		app.get("/api/data", cacheResponse({ ttl: 300, cache }), async (c) => {
			return c.json({ data: "test" });
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		await app.request(req, undefined, executionCtx);

		const putCall = (cache.put as any).mock.calls[0];
		const cachedResponse = putCall[1] as Response;
		expect(cachedResponse.headers.get("Cache-Control")).toBe("s-maxage=300");
	});

	it("with jitter, TTL varies within range", async () => {
		const ttls = new Set<string>();

		// Run multiple requests to collect different TTL values
		for (let i = 0; i < 20; i++) {
			const localCache = createMockCache();
			const app = new Hono();
			app.get(
				"/api/data",
				cacheResponse({ ttl: 300, jitter: 30, cache: localCache }),
				async (c) => {
					return c.json({ data: "test" });
				},
			);

			const executionCtx = createExecutionCtx();
			const req = new Request("http://localhost/api/data");
			await app.request(req, undefined, executionCtx);

			const putCall = (localCache.put as any).mock.calls[0];
			const cachedResponse = putCall[1] as Response;
			const cacheControl = cachedResponse.headers.get("Cache-Control")!;
			const actualTtl = Number.parseInt(cacheControl.replace("s-maxage=", ""), 10);

			// TTL should be within [270, 330]
			expect(actualTtl).toBeGreaterThanOrEqual(270);
			expect(actualTtl).toBeLessThanOrEqual(330);
			ttls.add(cacheControl);
		}

		// With 20 iterations, we should see at least 2 different values
		// (probability of all same is astronomically low with jitter=30)
		expect(ttls.size).toBeGreaterThanOrEqual(2);
	});

	it("TTL never goes below 1 even with large jitter", async () => {
		// Mock Math.random to return 0 (worst case: ttl - jitter)
		vi.spyOn(Math, "random").mockReturnValue(0);

		const app = new Hono();
		app.get("/api/data", cacheResponse({ ttl: 5, jitter: 100, cache }), async (c) => {
			return c.json({ data: "test" });
		});

		const executionCtx = createExecutionCtx();
		const req = new Request("http://localhost/api/data");
		await app.request(req, undefined, executionCtx);

		const putCall = (cache.put as any).mock.calls[0];
		const cachedResponse = putCall[1] as Response;
		const cacheControl = cachedResponse.headers.get("Cache-Control")!;
		const actualTtl = Number.parseInt(cacheControl.replace("s-maxage=", ""), 10);

		// Should be clamped to 1 minimum
		expect(actualTtl).toBeGreaterThanOrEqual(1);
	});
});
