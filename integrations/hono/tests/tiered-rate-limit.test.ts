import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tieredRateLimit } from "../src/tiered-rate-limit";

function createMockKV() {
	const store = new Map<string, string>();

	return {
		get: vi.fn(async (key: string, format?: string) => {
			const val = store.get(key) ?? null;
			if (val && format === "json") {
				return JSON.parse(val);
			}
			return val;
		}),
		put: vi.fn(async (key: string, value: string, _opts?: any) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
		list: vi.fn(),
		getWithMetadata: vi.fn(),
		_store: store,
	} as unknown as KVNamespace & { _store: Map<string, string> };
}

describe("tieredRateLimit() middleware", () => {
	let kv: ReturnType<typeof createMockKV>;

	beforeEach(() => {
		kv = createMockKV();
	});

	it("allows requests when under free tier limit", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 10 },
					pro: { limit: 100 },
				},
				window: "1h",
				keyFn: () => "user-1",
				tierFn: () => "free",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	it("rate limits free tier after limit reached", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 2 },
					pro: { limit: 100 },
				},
				window: "1m",
				keyFn: () => "user-1",
				tierFn: () => "free",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// First two requests should succeed
		const res1 = await app.request("/");
		expect(res1.status).toBe(200);

		const res2 = await app.request("/");
		expect(res2.status).toBe(200);

		// Third request should be rate limited
		const res3 = await app.request("/");
		expect(res3.status).toBe(429);
	});

	it("pro tier has higher limit than free tier", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 1 },
					pro: { limit: 100 },
				},
				window: "1m",
				keyFn: () => "user-pro",
				tierFn: () => "pro",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// First request should succeed for pro
		const res1 = await app.request("/");
		expect(res1.status).toBe(200);

		// Second request should also succeed (pro has 100 limit)
		const res2 = await app.request("/");
		expect(res2.status).toBe(200);
	});

	it("unknown tier falls back to defaultTier", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 5 },
					pro: { limit: 100 },
				},
				window: "1m",
				defaultTier: "free",
				keyFn: () => "user-1",
				tierFn: () => "unknown-tier",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// Should fallback to free tier and work
		const res = await app.request("/");
		expect(res.status).toBe(200);
	});

	it("unknown tier without defaultTier returns 500", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 5 },
				},
				window: "1m",
				keyFn: () => "user-1",
				tierFn: () => "unknown-tier",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/");
		expect(res.status).toBe(500);
	});

	it("returns 429 with rate limit headers", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 1 },
				},
				window: "1m",
				keyFn: () => "user-1",
				tierFn: () => "free",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// Exhaust the limit
		await app.request("/");
		const res = await app.request("/");

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toBe("Rate limit exceeded");
		expect(res.headers.get("X-RateLimit-Limit")).toBeDefined();
		expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
		expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
		expect(res.headers.get("Retry-After")).toBeDefined();
	});

	it("sets rate limit headers on allowed requests", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 10 },
				},
				window: "1m",
				keyFn: () => "user-1",
				tierFn: () => "free",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
		expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
		expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
	});

	it("uses custom onRateLimited handler", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 1 },
				},
				window: "1m",
				keyFn: () => "user-1",
				tierFn: () => "free",
				onRateLimited: (c) => c.json({ custom: true, message: "slow down" }, 429),
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// Exhaust the limit
		await app.request("/");
		const res = await app.request("/");

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.custom).toBe(true);
		expect(body.message).toBe("slow down");
	});

	it("supports async keyFn and tierFn", async () => {
		const app = new Hono();
		app.use(
			tieredRateLimit({
				namespace: kv,
				tiers: {
					free: { limit: 10 },
				},
				window: "1m",
				keyFn: async () => {
					await Promise.resolve();
					return "async-key";
				},
				tierFn: async () => {
					await Promise.resolve();
					return "free";
				},
			}),
		);
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/");
		expect(res.status).toBe(200);
	});

	it("caches the tiered limiter across requests", async () => {
		const app = new Hono();
		const middleware = tieredRateLimit({
			namespace: kv,
			tiers: {
				free: { limit: 10 },
			},
			window: "1m",
			keyFn: () => "user-1",
			tierFn: () => "free",
		});
		app.use(middleware);
		app.get("/", (c) => c.text("ok"));

		// Multiple requests should use the same limiter instance
		await app.request("/");
		await app.request("/");

		// Verify state is shared (second request should decrement remaining)
		const res = await app.request("/");
		expect(res.status).toBe(200);
		// After 3 requests, remaining should be 7
		expect(res.headers.get("X-RateLimit-Remaining")).toBe("7");
	});
});
