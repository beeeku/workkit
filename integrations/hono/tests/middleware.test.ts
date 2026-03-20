import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { workkit } from "../src/middleware";
import type { WorkkitEnv } from "../src/types";

// Simple Standard Schema validator for testing (avoids zod dependency in tests)
function string() {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test",
			validate(value: unknown) {
				if (typeof value === "string") {
					return { value };
				}
				return { issues: [{ message: "Expected string", path: [] }] };
			},
		},
	};
}

function number() {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test",
			validate(value: unknown) {
				if (typeof value === "number") {
					return { value };
				}
				const parsed = Number(value);
				if (!Number.isNaN(parsed)) {
					return { value: parsed };
				}
				return { issues: [{ message: "Expected number", path: [] }] };
			},
		},
	};
}

// KV-like mock for bindings
function mockKV(): KVNamespace {
	return {
		get: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
		list: vi.fn(),
		getWithMetadata: vi.fn(),
	} as unknown as KVNamespace;
}

// Helper to create a passthrough object (for bindings that pass through validation)
function binding() {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "test",
			validate(value: unknown) {
				if (value != null && typeof value === "object") {
					return { value };
				}
				return { issues: [{ message: "Expected binding", path: [] }] };
			},
		},
	};
}

describe("workkit() middleware", () => {
	it("validates env and sets context variables", async () => {
		const schema = { API_KEY: string() };
		const app = new Hono<{ Bindings: { API_KEY: string } }>();

		app.use(workkit({ env: schema }));
		app.get("/", (c) => {
			const env = c.get("workkit:env" as any);
			return c.json({ key: env.API_KEY });
		});

		const res = await app.request("/", undefined, { API_KEY: "test-key-123" });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.key).toBe("test-key-123");
	});

	it("sets workkit:envValidated to true on success", async () => {
		const schema = { API_KEY: string() };
		const app = new Hono<{ Bindings: { API_KEY: string } }>();

		app.use(workkit({ env: schema }));
		app.get("/", (c) => {
			const validated = c.get("workkit:envValidated" as any);
			return c.json({ validated });
		});

		const res = await app.request("/", undefined, { API_KEY: "key" });
		const body = await res.json();
		expect(body.validated).toBe(true);
	});

	it("throws EnvValidationError when env is invalid", async () => {
		const schema = { API_KEY: string() };
		const app = new Hono<{ Bindings: Record<string, unknown> }>();

		app.use(workkit({ env: schema }));
		app.get("/", (c) => c.text("ok"));

		const res = await app.request("/", undefined, {});
		// Without an error handler, Hono returns 500
		expect(res.status).toBe(500);
	});

	it("validates multiple env variables", async () => {
		const schema = {
			API_KEY: string(),
			DB_NAME: string(),
		};
		const app = new Hono<{ Bindings: { API_KEY: string; DB_NAME: string } }>();

		app.use(workkit({ env: schema }));
		app.get("/", (c) => {
			const env = c.get("workkit:env" as any);
			return c.json({ key: env.API_KEY, db: env.DB_NAME });
		});

		const res = await app.request("/", undefined, {
			API_KEY: "key-1",
			DB_NAME: "my-db",
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.key).toBe("key-1");
		expect(body.db).toBe("my-db");
	});

	it("caches parsed env across requests (validates once)", async () => {
		let validateCount = 0;
		const trackingValidator = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate(value: unknown) {
					validateCount++;
					return { value };
				},
			},
		};

		const schema = { KEY: trackingValidator };
		const app = new Hono<{ Bindings: { KEY: string } }>();

		app.use(workkit({ env: schema }));
		app.get("/", (c) => c.text("ok"));

		await app.request("/", undefined, { KEY: "val" });
		await app.request("/", undefined, { KEY: "val" });
		await app.request("/", undefined, { KEY: "val" });

		// Validator should only be called once (first request)
		expect(validateCount).toBe(1);
	});

	it("validates binding-type env variables (KV, D1, etc.)", async () => {
		const schema = { CACHE: binding() };
		const kv = mockKV();
		const app = new Hono<{ Bindings: { CACHE: KVNamespace } }>();

		app.use(workkit({ env: schema }));
		app.get("/", (c) => {
			const env = c.get("workkit:env" as any);
			return c.json({ hasCache: !!env.CACHE });
		});

		const res = await app.request("/", undefined, { CACHE: kv });
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.hasCache).toBe(true);
	});

	it("works with multiple routes", async () => {
		const schema = { SECRET: string() };
		const app = new Hono<{ Bindings: { SECRET: string } }>();

		app.use(workkit({ env: schema }));
		app.get("/a", (c) => {
			const env = c.get("workkit:env" as any);
			return c.json({ route: "a", secret: env.SECRET });
		});
		app.get("/b", (c) => {
			const env = c.get("workkit:env" as any);
			return c.json({ route: "b", secret: env.SECRET });
		});

		const resA = await app.request("/a", undefined, { SECRET: "shh" });
		const bodyA = await resA.json();
		expect(bodyA.route).toBe("a");
		expect(bodyA.secret).toBe("shh");

		const resB = await app.request("/b", undefined, { SECRET: "shh" });
		const bodyB = await resB.json();
		expect(bodyB.route).toBe("b");
		expect(bodyB.secret).toBe("shh");
	});
});
