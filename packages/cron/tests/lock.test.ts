import { describe, expect, it, vi } from "vitest";
import { acquireLock, withLock } from "../src/lock";
import { createMockCtx, createMockEvent, createMockKV } from "./helpers/mock";

type TestEnv = { LOCK_KV: ReturnType<typeof createMockKV> };

describe("acquireLock()", () => {
	it("acquires lock on empty KV", async () => {
		const kv = createMockKV();
		const result = await acquireLock(kv, "my-lock");
		expect(result.acquired).toBe(true);
	});

	it("stores lock value in KV", async () => {
		const kv = createMockKV();
		await acquireLock(kv, "my-lock");
		const value = await kv.get("my-lock");
		expect(value).toBeTruthy();
	});

	it("fails when lock already held", async () => {
		const kv = createMockKV();
		const first = await acquireLock(kv, "my-lock");
		expect(first.acquired).toBe(true);

		const second = await acquireLock(kv, "my-lock");
		expect(second.acquired).toBe(false);
	});

	it("provides a release function", async () => {
		const kv = createMockKV();
		const result = await acquireLock(kv, "my-lock");
		expect(typeof result.release).toBe("function");
	});

	it("release removes the lock", async () => {
		const kv = createMockKV();
		const result = await acquireLock(kv, "my-lock");
		await result.release();

		const value = await kv.get("my-lock");
		expect(value).toBeNull();
	});

	it("allows re-acquisition after release", async () => {
		const kv = createMockKV();
		const first = await acquireLock(kv, "my-lock");
		await first.release();

		const second = await acquireLock(kv, "my-lock");
		expect(second.acquired).toBe(true);
	});

	it("uses custom TTL", async () => {
		const kv = createMockKV();
		await acquireLock(kv, "my-lock", { ttl: 60 });
		const entry = kv._store.get("my-lock");
		expect(entry).toBeTruthy();
		expect(entry!.expiry).toBeTruthy();
	});

	it("uses custom lock value", async () => {
		const kv = createMockKV();
		await acquireLock(kv, "my-lock", { lockValue: "custom-id" });
		const value = await kv.get("my-lock");
		expect(value).toBe("custom-id");
	});

	it("uses default TTL of 300 seconds", async () => {
		const kv = createMockKV();
		await acquireLock(kv, "my-lock");
		const entry = kv._store.get("my-lock");
		expect(entry!.expiry).toBeTruthy();
		// Default TTL is 300s
		const expectedExpiry = Date.now() + 300 * 1000;
		expect(Math.abs(entry!.expiry! - expectedExpiry)).toBeLessThan(1000);
	});
});

describe("withLock()", () => {
	it("runs handler when lock is acquired", async () => {
		const kv = createMockKV();
		const spy = vi.fn();

		const locked = withLock(() => kv, "job-lock", { ttl: 60 }, spy);

		const event = createMockEvent("0 * * * *");
		const env = { LOCK_KV: kv } as TestEnv;
		const ctx = createMockCtx();

		await locked(event, env, ctx);
		expect(spy).toHaveBeenCalledWith(event, env, ctx);
	});

	it("skips handler when lock is held", async () => {
		const kv = createMockKV();
		const spy = vi.fn();

		// Pre-acquire the lock
		await acquireLock(kv, "job-lock");

		const locked = withLock(() => kv, "job-lock", { ttl: 60 }, spy);

		await locked(createMockEvent("0 * * * *"), { LOCK_KV: kv } as TestEnv, createMockCtx());
		expect(spy).not.toHaveBeenCalled();
	});

	it("releases lock after handler completes", async () => {
		const kv = createMockKV();
		const locked = withLock(() => kv, "job-lock", {}, vi.fn());

		await locked(createMockEvent("0 * * * *"), { LOCK_KV: kv } as TestEnv, createMockCtx());

		// Lock should be released
		const value = await kv.get("job-lock");
		expect(value).toBeNull();
	});

	it("releases lock even if handler throws", async () => {
		const kv = createMockKV();
		const locked = withLock(() => kv, "job-lock", {}, vi.fn().mockRejectedValue(new Error("boom")));

		await expect(
			locked(createMockEvent("0 * * * *"), { LOCK_KV: kv } as TestEnv, createMockCtx()),
		).rejects.toThrow("boom");

		const value = await kv.get("job-lock");
		expect(value).toBeNull();
	});

	it("resolves KV from env using accessor", async () => {
		const kv = createMockKV();
		const spy = vi.fn();

		const locked = withLock((env: TestEnv) => env.LOCK_KV, "lock-key", {}, spy);

		const env = { LOCK_KV: kv } as TestEnv;
		await locked(createMockEvent("0 * * * *"), env, createMockCtx());

		expect(spy).toHaveBeenCalled();
	});

	it("supports concurrent lock rejection between two handlers", async () => {
		const kv = createMockKV();
		const spy1 = vi.fn();
		const spy2 = vi.fn();

		const locked1 = withLock(() => kv, "shared-lock", { ttl: 60 }, spy1);
		const locked2 = withLock(() => kv, "shared-lock", { ttl: 60 }, spy2);

		const env = { LOCK_KV: kv } as TestEnv;
		const event = createMockEvent("0 * * * *");

		// First acquires the lock
		await locked1(event, env, createMockCtx());
		expect(spy1).toHaveBeenCalledOnce();

		// Re-acquire before release completes by manually setting the lock
		await kv.put("shared-lock", "held", { expirationTtl: 60 });

		// Second should be rejected because lock is held
		await locked2(event, env, createMockCtx());
		expect(spy2).not.toHaveBeenCalled();
	});
});
