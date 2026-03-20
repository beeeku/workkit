import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheAside } from "../src/aside";
import { createMemoryCache } from "../src/memory";

describe("cacheAside", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("cache miss → fetch → cache", () => {
		it("should fetch and cache on first call", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi.fn().mockResolvedValue({ id: "123", name: "Alice" });

			const getUser = cacheAside({
				key: (id: string) => `/users/${id}`,
				ttl: 600,
				fetch: fetchFn,
				cache,
			});

			const user = await getUser("123");
			expect(user).toEqual({ id: "123", name: "Alice" });
			expect(fetchFn).toHaveBeenCalledWith("123");
			expect(fetchFn).toHaveBeenCalledTimes(1);
		});

		it("should pass all arguments to key and fetch functions", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi.fn().mockResolvedValue({ result: "found" });

			const search = cacheAside<{ result: string }, [string, number]>({
				key: (query: string, page: number) => `/search?q=${query}&p=${page}`,
				ttl: 60,
				fetch: fetchFn,
				cache,
			});

			await search("hello", 2);
			expect(fetchFn).toHaveBeenCalledWith("hello", 2);
		});
	});

	describe("cache hit → return cached", () => {
		it("should return cached data on second call", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi.fn().mockResolvedValue({ id: "123", name: "Alice" });

			const getUser = cacheAside({
				key: (id: string) => `/users/${id}`,
				ttl: 600,
				fetch: fetchFn,
				cache,
			});

			await getUser("123"); // miss → fetch
			const user = await getUser("123"); // hit → cached

			expect(user).toEqual({ id: "123", name: "Alice" });
			expect(fetchFn).toHaveBeenCalledTimes(1); // only called once
		});

		it("should cache different keys independently", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi
				.fn()
				.mockImplementation(async (id: string) => ({ id, name: `User ${id}` }));

			const getUser = cacheAside({
				key: (id: string) => `/users/${id}`,
				ttl: 600,
				fetch: fetchFn,
				cache,
			});

			const user1 = await getUser("1");
			const user2 = await getUser("2");
			const user1Again = await getUser("1");

			expect(user1).toEqual({ id: "1", name: "User 1" });
			expect(user2).toEqual({ id: "2", name: "User 2" });
			expect(user1Again).toEqual({ id: "1", name: "User 1" });
			expect(fetchFn).toHaveBeenCalledTimes(2); // only 2 unique keys
		});
	});

	describe("TTL expiry → re-fetch", () => {
		it("should re-fetch after TTL expires", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi
				.fn()
				.mockResolvedValueOnce({ version: 1 })
				.mockResolvedValueOnce({ version: 2 });

			const getData = cacheAside({
				key: () => "/data",
				ttl: 60,
				fetch: fetchFn,
				cache,
			});

			const first = await getData();
			expect(first).toEqual({ version: 1 });

			vi.advanceTimersByTime(61_000);

			const second = await getData();
			expect(second).toEqual({ version: 2 });
			expect(fetchFn).toHaveBeenCalledTimes(2);
		});

		it("should serve cached within TTL", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi.fn().mockResolvedValue({ data: "cached" });

			const getData = cacheAside({
				key: () => "/data",
				ttl: 300,
				fetch: fetchFn,
				cache,
			});

			await getData();
			vi.advanceTimersByTime(100_000);
			await getData();

			expect(fetchFn).toHaveBeenCalledTimes(1);
		});
	});

	describe("error handling", () => {
		it("should propagate fetch errors", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi.fn().mockRejectedValue(new Error("DB connection failed"));

			const getUser = cacheAside({
				key: (id: string) => `/users/${id}`,
				ttl: 600,
				fetch: fetchFn,
				cache,
			});

			await expect(getUser("123")).rejects.toThrow("DB connection failed");
		});

		it("should not cache failed fetches", async () => {
			const cache = createMemoryCache();
			const fetchFn = vi
				.fn()
				.mockRejectedValueOnce(new Error("First failure"))
				.mockResolvedValueOnce({ success: true });

			const getData = cacheAside({
				key: () => "/data",
				ttl: 600,
				fetch: fetchFn,
				cache,
			});

			await expect(getData()).rejects.toThrow("First failure");

			const result = await getData();
			expect(result).toEqual({ success: true });
			expect(fetchFn).toHaveBeenCalledTimes(2);
		});
	});

	describe("data types", () => {
		it("should handle string results", async () => {
			const cache = createMemoryCache();
			const getData = cacheAside<string>({
				key: () => "/data",
				ttl: 60,
				fetch: async () => "hello",
				cache,
			});

			expect(await getData()).toBe("hello");
		});

		it("should handle array results", async () => {
			const cache = createMemoryCache();
			const getData = cacheAside<number[]>({
				key: () => "/data",
				ttl: 60,
				fetch: async () => [1, 2, 3],
				cache,
			});

			expect(await getData()).toEqual([1, 2, 3]);
		});

		it("should handle null results", async () => {
			const cache = createMemoryCache();
			const getData = cacheAside<null>({
				key: () => "/data",
				ttl: 60,
				fetch: async () => null,
				cache,
			});

			expect(await getData()).toBeNull();
		});

		it("should handle boolean results", async () => {
			const cache = createMemoryCache();
			const getData = cacheAside<boolean>({
				key: () => "/data",
				ttl: 60,
				fetch: async () => true,
				cache,
			});

			expect(await getData()).toBe(true);
		});
	});

	describe("concurrent calls", () => {
		it("should handle concurrent calls for the same key", async () => {
			const cache = createMemoryCache();
			let callCount = 0;
			const fetchFn = vi.fn().mockImplementation(async () => {
				callCount++;
				return { count: callCount };
			});

			const getData = cacheAside({
				key: () => "/data",
				ttl: 600,
				fetch: fetchFn,
				cache,
			});

			// Both calls happen before either caches
			const [a, b] = await Promise.all([getData(), getData()]);

			// Both should get data (exact behavior depends on timing)
			expect(a).toBeDefined();
			expect(b).toBeDefined();
		});
	});
});
