import { describe, expect, it, vi } from "vitest";
import { SseRegistry, createSseHandler } from "../../../src/adapters/inapp/sse";
import { createInAppDb } from "./_d1";

describe("createSseHandler()", () => {
	it("throws at construction when auth is missing", () => {
		const registry = new SseRegistry();
		const db = createInAppDb();
		// @ts-expect-error — intentionally missing required `auth`
		expect(() => createSseHandler({ db, registry })).toThrow(/auth.*required/i);
	});

	it("returns 401 when auth callback resolves null", async () => {
		const registry = new SseRegistry();
		const db = createInAppDb();
		const handler = createSseHandler({
			db,
			registry,
			auth: async () => null,
		});
		const res = await handler(new Request("https://example.com/sse"));
		expect(res.status).toBe(401);
	});

	it("returns 403 when origin is not in allowlist", async () => {
		const registry = new SseRegistry();
		const db = createInAppDb();
		const handler = createSseHandler({
			db,
			registry,
			auth: async () => ({ userId: "u1" }),
			originAllowlist: ["https://app.example.com"],
		});
		const res = await handler(
			new Request("https://example.com/sse", { headers: { origin: "https://evil.example.com" } }),
		);
		expect(res.status).toBe(403);
	});

	it("returns 429 when per-user connection cap is exceeded", async () => {
		const registry = new SseRegistry();
		// Fill up cap by registering subscribers directly.
		for (let i = 0; i < 5; i++) {
			registry.add({ userId: "u1", push: () => undefined, close: () => undefined });
		}
		const db = createInAppDb();
		const handler = createSseHandler({
			db,
			registry,
			auth: async () => ({ userId: "u1" }),
			maxConnPerUser: 5,
		});
		const res = await handler(new Request("https://example.com/sse"));
		expect(res.status).toBe(429);
	});

	it("returns 200 with SSE headers on successful subscription", async () => {
		const registry = new SseRegistry();
		const db = createInAppDb();
		const handler = createSseHandler({
			db,
			registry,
			auth: async () => ({ userId: "u1" }),
		});
		const res = await handler(new Request("https://example.com/sse"));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(res.headers.get("cache-control")).toContain("no-cache");
		// Drain to complete cleanup.
		const reader = res.body!.getReader();
		await reader.read();
		await reader.cancel();
	});
});

describe("SseRegistry", () => {
	it("scopes subscribers by userId — push() does NOT cross tenants", () => {
		const registry = new SseRegistry();
		const u1Push = vi.fn();
		const u2Push = vi.fn();
		registry.add({ userId: "u1", push: u1Push, close: () => undefined });
		registry.add({ userId: "u2", push: u2Push, close: () => undefined });
		registry.push("u1", "hello");
		expect(u1Push).toHaveBeenCalledWith("hello");
		expect(u2Push).not.toHaveBeenCalled();
	});

	it("disconnectUser closes and drops subscribers for the user only", () => {
		const registry = new SseRegistry();
		const u1Close = vi.fn();
		const u2Close = vi.fn();
		registry.add({ userId: "u1", push: () => undefined, close: u1Close });
		registry.add({ userId: "u2", push: () => undefined, close: u2Close });
		registry.disconnectUser("u1");
		expect(u1Close).toHaveBeenCalled();
		expect(u2Close).not.toHaveBeenCalled();
		expect(registry.count("u1")).toBe(0);
		expect(registry.count("u2")).toBe(1);
	});
});
