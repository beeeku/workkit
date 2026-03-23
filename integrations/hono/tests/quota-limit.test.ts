import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotaLimit } from "../src/quota-limit";

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

describe("quotaLimit() middleware", () => {
	let kv: ReturnType<typeof createMockKV>;

	beforeEach(() => {
		kv = createMockKV();
	});

	it("allows requests when under quota", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [{ window: "1h", limit: 10 }],
				keyFn: () => "user-1",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	it("blocks requests when quota exceeded", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [{ window: "1m", limit: 2 }],
				keyFn: () => "user-1",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// First two requests should succeed
		const res1 = await app.request("/");
		expect(res1.status).toBe(200);

		const res2 = await app.request("/");
		expect(res2.status).toBe(200);

		// Third request should be blocked
		const res3 = await app.request("/");
		expect(res3.status).toBe(429);
	});

	it("returns 429 with quota breakdown in body", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [
					{ window: "1m", limit: 1 },
					{ window: "1h", limit: 10 },
				],
				keyFn: () => "user-1",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// Exhaust the 1m limit
		await app.request("/");
		const res = await app.request("/");

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toBe("Quota exceeded");
		expect(body.quotas).toBeDefined();
		expect(Array.isArray(body.quotas)).toBe(true);
		expect(body.quotas.length).toBe(2);

		// Each quota entry should have window, used, limit, remaining
		for (const q of body.quotas) {
			expect(q.window).toBeDefined();
			expect(q.used).toBeDefined();
			expect(q.limit).toBeDefined();
			expect(q.remaining).toBeDefined();
		}
	});

	it("sets rate limit headers on allowed requests", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [{ window: "1h", limit: 100 }],
				keyFn: () => "user-1",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("X-RateLimit-Limit")).toBe("100");
		expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
		expect(res.headers.get("X-RateLimit-Reset")).toBeDefined();
	});

	it("sets Retry-After header on blocked requests", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [{ window: "1m", limit: 1 }],
				keyFn: () => "user-1",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		await app.request("/");
		const res = await app.request("/");

		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBeDefined();
	});

	it("uses custom onQuotaExceeded handler", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [{ window: "1m", limit: 1 }],
				keyFn: () => "user-1",
				onQuotaExceeded: (c) => c.json({ custom: true, message: "quota hit" }, 429),
			}),
		);
		app.get("/", (c) => c.text("ok"));

		await app.request("/");
		const res = await app.request("/");

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.custom).toBe(true);
		expect(body.message).toBe("quota hit");
	});

	it("supports async keyFn", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [{ window: "1h", limit: 10 }],
				keyFn: async () => {
					await Promise.resolve();
					return "async-key";
				},
			}),
		);
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/");
		expect(res.status).toBe(200);
	});

	it("enforces multiple windows — blocked by tightest", async () => {
		const app = new Hono();
		app.use(
			quotaLimit({
				namespace: kv,
				limits: [
					{ window: "1m", limit: 2 },
					{ window: "1h", limit: 100 },
				],
				keyFn: () => "user-1",
			}),
		);
		app.get("/", (c) => c.text("ok"));

		// Two requests exhaust the 1m window
		await app.request("/");
		await app.request("/");

		// Third should be blocked by 1m limit even though 1h has plenty left
		const res = await app.request("/");
		expect(res.status).toBe(429);
	});
});
