import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "../src/memory";
import { taggedCache } from "../src/tagged";

describe("taggedCache", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("basic operations", () => {
		it("should put and get a response", async () => {
			const tc = taggedCache();
			await tc.put("/api/users", new Response("users data"));

			const cached = await tc.get("/api/users");
			expect(cached).toBeDefined();
			expect(await cached!.text()).toBe("users data");
		});

		it("should return undefined for cache miss", async () => {
			const tc = taggedCache();
			const result = await tc.get("/nonexistent");
			expect(result).toBeUndefined();
		});

		it("should delete an entry", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("data"));
			const deleted = await tc.delete("/test");
			expect(deleted).toBe(true);
			expect(await tc.get("/test")).toBeUndefined();
		});

		it("should return false when deleting nonexistent entry", async () => {
			const tc = taggedCache();
			const deleted = await tc.delete("/nonexistent");
			expect(deleted).toBe(false);
		});
	});

	describe("tagging", () => {
		it("should store tags with put", async () => {
			const tc = taggedCache();
			await tc.put("/api/users/123", new Response("user 123"), { tags: ["user:123", "users"] });

			const tags = tc.getTags("/api/users/123");
			expect(tags).toContain("user:123");
			expect(tags).toContain("users");
			expect(tags).toHaveLength(2);
		});

		it("should return empty tags for untagged entry", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("data"));
			expect(tc.getTags("/test")).toEqual([]);
		});

		it("should return empty tags for nonexistent entry", async () => {
			const tc = taggedCache();
			expect(tc.getTags("/nonexistent")).toEqual([]);
		});

		it("should track keys by tag", async () => {
			const tc = taggedCache();
			await tc.put("/api/users/1", new Response("user 1"), { tags: ["users"] });
			await tc.put("/api/users/2", new Response("user 2"), { tags: ["users"] });
			await tc.put("/api/posts/1", new Response("post 1"), { tags: ["posts"] });

			const userKeys = tc.getKeysByTag("users");
			expect(userKeys).toHaveLength(2);
			expect(userKeys).toContain("/api/users/1");
			expect(userKeys).toContain("/api/users/2");

			const postKeys = tc.getKeysByTag("posts");
			expect(postKeys).toHaveLength(1);
			expect(postKeys).toContain("/api/posts/1");
		});

		it("should return empty array for unknown tag", async () => {
			const tc = taggedCache();
			expect(tc.getKeysByTag("nonexistent")).toEqual([]);
		});

		it("should support multiple tags per entry", async () => {
			const tc = taggedCache();
			await tc.put("/api/users/123", new Response("data"), {
				tags: ["user:123", "users", "team:engineering"],
			});

			expect(tc.getTags("/api/users/123")).toHaveLength(3);
			expect(tc.getKeysByTag("user:123")).toContain("/api/users/123");
			expect(tc.getKeysByTag("users")).toContain("/api/users/123");
			expect(tc.getKeysByTag("team:engineering")).toContain("/api/users/123");
		});
	});

	describe("invalidateTag", () => {
		it("should invalidate all entries with a specific tag", async () => {
			const tc = taggedCache();
			await tc.put("/api/users/1", new Response("user 1"), { tags: ["users"] });
			await tc.put("/api/users/2", new Response("user 2"), { tags: ["users"] });
			await tc.put("/api/posts/1", new Response("post 1"), { tags: ["posts"] });

			const count = await tc.invalidateTag("users");

			expect(count).toBe(2);
			expect(await tc.get("/api/users/1")).toBeUndefined();
			expect(await tc.get("/api/users/2")).toBeUndefined();
			expect(await tc.get("/api/posts/1")).toBeDefined(); // unaffected
		});

		it("should invalidate only matching tag", async () => {
			const tc = taggedCache();
			await tc.put("/api/users/123", new Response("data"), { tags: ["user:123", "users"] });
			await tc.put("/api/users/456", new Response("data"), { tags: ["user:456", "users"] });

			const count = await tc.invalidateTag("user:123");
			expect(count).toBe(1);

			expect(await tc.get("/api/users/123")).toBeUndefined();
			expect(await tc.get("/api/users/456")).toBeDefined();
		});

		it("should return 0 for unknown tag", async () => {
			const tc = taggedCache();
			const count = await tc.invalidateTag("nonexistent");
			expect(count).toBe(0);
		});

		it("should clean up tag mappings after invalidation", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("data"), { tags: ["tag-a", "tag-b"] });

			await tc.invalidateTag("tag-a");

			expect(tc.getKeysByTag("tag-a")).toEqual([]);
			expect(tc.getKeysByTag("tag-b")).toEqual([]);
			expect(tc.getTags("/test")).toEqual([]);
		});

		it("should handle invalidating tag shared across many entries", async () => {
			const tc = taggedCache();

			for (let i = 0; i < 20; i++) {
				await tc.put(`/item/${i}`, new Response(`item ${i}`), { tags: ["all", `item:${i}`] });
			}

			const count = await tc.invalidateTag("all");
			expect(count).toBe(20);

			for (let i = 0; i < 20; i++) {
				expect(await tc.get(`/item/${i}`)).toBeUndefined();
			}
		});

		it("should not affect entries without the invalidated tag", async () => {
			const tc = taggedCache();
			await tc.put("/a", new Response("a"), { tags: ["group-1"] });
			await tc.put("/b", new Response("b"), { tags: ["group-2"] });
			await tc.put("/c", new Response("c"), { tags: ["group-1", "group-2"] });

			await tc.invalidateTag("group-1");

			expect(await tc.get("/a")).toBeUndefined();
			expect(await tc.get("/b")).toBeDefined();
			expect(await tc.get("/c")).toBeUndefined(); // had group-1
		});
	});

	describe("re-put behavior", () => {
		it("should update tags on re-put", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("v1"), { tags: ["old-tag"] });
			await tc.put("/test", new Response("v2"), { tags: ["new-tag"] });

			expect(tc.getTags("/test")).toEqual(["new-tag"]);
			expect(tc.getKeysByTag("old-tag")).toEqual([]);
			expect(tc.getKeysByTag("new-tag")).toContain("/test");
		});

		it("should update data on re-put", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("v1"), { tags: ["tag"] });
			await tc.put("/test", new Response("v2"), { tags: ["tag"] });

			const cached = await tc.get("/test");
			expect(await cached!.text()).toBe("v2");
		});

		it("should clear tags on re-put without tags", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("v1"), { tags: ["tag-a"] });
			await tc.put("/test", new Response("v2")); // no tags

			expect(tc.getTags("/test")).toEqual([]);
			expect(tc.getKeysByTag("tag-a")).toEqual([]);
		});
	});

	describe("delete cleans up tags", () => {
		it("should remove tag mappings on delete", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("data"), { tags: ["tag-x"] });

			await tc.delete("/test");

			expect(tc.getTags("/test")).toEqual([]);
			expect(tc.getKeysByTag("tag-x")).toEqual([]);
		});
	});

	describe("with custom cache", () => {
		it("should use provided cache instance", async () => {
			const memCache = createMemoryCache({ maxSize: 5 });
			const tc = taggedCache({ cache: memCache });

			await tc.put("/test", new Response("data"), { tags: ["tag"] });
			const cached = await tc.get("/test");
			expect(await cached!.text()).toBe("data");
		});

		it("should respect underlying cache TTL", async () => {
			const memCache = createMemoryCache();
			const tc = taggedCache({ cache: memCache });

			await tc.put("/test", new Response("data"), { ttl: 10, tags: ["tag"] });

			vi.advanceTimersByTime(11_000);

			const cached = await tc.get("/test");
			expect(cached).toBeUndefined();
		});
	});

	describe("edge cases", () => {
		it("should handle empty tags array", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("data"), { tags: [] });
			expect(tc.getTags("/test")).toEqual([]);
		});

		it("should handle duplicate tags in put", async () => {
			const tc = taggedCache();
			await tc.put("/test", new Response("data"), { tags: ["dup", "dup", "dup"] });
			// Tags stored as Set, so duplicates are collapsed
			expect(tc.getTags("/test")).toEqual(["dup"]);
		});

		it("should handle invalidating a tag after some entries are manually deleted", async () => {
			const tc = taggedCache();
			await tc.put("/a", new Response("a"), { tags: ["group"] });
			await tc.put("/b", new Response("b"), { tags: ["group"] });

			await tc.delete("/a");

			// Invalidating should handle the already-deleted entry gracefully
			const count = await tc.invalidateTag("group");
			expect(count).toBe(1); // only /b was actually deleted from cache
		});
	});
});
