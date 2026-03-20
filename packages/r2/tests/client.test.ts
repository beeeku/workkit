import { BindingNotFoundError, ConfigError, ValidationError } from "@workkit/errors";
import { beforeEach, describe, expect, it } from "vitest";
import { r2 } from "../src/client";
import type { WorkkitR2 } from "../src/types";
import { createMockR2 } from "./helpers/mock-r2";

type AvatarMeta = { userId: string; uploadedAt: string };

describe("r2() factory", () => {
	it("throws BindingNotFoundError for null binding", () => {
		expect(() => r2(null as any)).toThrow(BindingNotFoundError);
	});

	it("throws BindingNotFoundError for undefined binding", () => {
		expect(() => r2(undefined as any)).toThrow(BindingNotFoundError);
	});

	it("throws ConfigError for non-R2Bucket object", () => {
		expect(() => r2({ foo: "bar" } as any)).toThrow(ConfigError);
	});

	it("throws ConfigError for object missing head()", () => {
		expect(() =>
			r2({ get: () => {}, put: () => {}, delete: () => {}, list: () => {} } as any),
		).toThrow(ConfigError);
	});

	it("creates a WorkkitR2 instance with default options", () => {
		const mock = createMockR2();
		const bucket = r2(mock);
		expect(bucket).toBeDefined();
		expect(typeof bucket.get).toBe("function");
		expect(typeof bucket.put).toBe("function");
		expect(typeof bucket.delete).toBe("function");
		expect(typeof bucket.head).toBe("function");
		expect(typeof bucket.list).toBe("function");
		expect(typeof bucket.listPage).toBe("function");
	});

	it("exposes .raw as the original R2Bucket binding", () => {
		const mock = createMockR2();
		const bucket = r2(mock);
		expect(bucket.raw).toBe(mock);
	});
});

describe("get()", () => {
	let mock: ReturnType<typeof createMockR2>;
	let bucket: WorkkitR2<AvatarMeta>;

	beforeEach(() => {
		mock = createMockR2();
		bucket = r2<AvatarMeta>(mock);
	});

	it("returns typed object body for existing key", async () => {
		await mock.put("avatars/123.png", "image-data", {
			customMetadata: { userId: "123", uploadedAt: "2024-01-01" },
		});
		const obj = await bucket.get("avatars/123.png");
		expect(obj).not.toBeNull();
		expect(obj!.key).toBe("avatars/123.png");
		expect(obj!.customMetadata.userId).toBe("123");
		expect(obj!.body).toBeDefined();
	});

	it("returns null for missing key", async () => {
		const result = await bucket.get("nonexistent");
		expect(result).toBeNull();
	});

	it("reads body as text", async () => {
		await mock.put("file.txt", "hello world");
		const obj = await bucket.get("file.txt");
		const text = await obj!.text();
		expect(text).toBe("hello world");
	});

	it("reads body as json", async () => {
		await mock.put("data.json", JSON.stringify({ foo: "bar" }));
		const obj = await bucket.get("data.json");
		const data = await obj!.json();
		expect(data).toEqual({ foo: "bar" });
	});

	it("reads body as arrayBuffer", async () => {
		await mock.put("file.bin", "binary-data");
		const obj = await bucket.get("file.bin");
		const buf = await obj!.arrayBuffer();
		expect(buf).toBeInstanceOf(ArrayBuffer);
		expect(new TextDecoder().decode(buf)).toBe("binary-data");
	});

	it("throws ValidationError for empty key", async () => {
		await expect(bucket.get("")).rejects.toThrow(ValidationError);
	});

	it("respects conditional get with etagMatches", async () => {
		await mock.put("file.txt", "content");
		const head = await mock.head("file.txt");
		const obj = await bucket.get("file.txt", {
			onlyIf: { etagMatches: head!.etag },
		});
		expect(obj).not.toBeNull();
	});

	it("returns null when etag does not match", async () => {
		await mock.put("file.txt", "content");
		const obj = await bucket.get("file.txt", {
			onlyIf: { etagMatches: "wrong-etag" },
		});
		expect(obj).toBeNull();
	});

	it("supports range reads with offset and length", async () => {
		await mock.put("file.txt", "hello world");
		const obj = await bucket.get("file.txt", {
			range: { offset: 6, length: 5 },
		});
		expect(obj).not.toBeNull();
		const text = await obj!.text();
		expect(text).toBe("world");
	});

	it("supports range reads with suffix", async () => {
		await mock.put("file.txt", "hello world");
		const obj = await bucket.get("file.txt", {
			range: { suffix: 5 },
		});
		const text = await obj!.text();
		expect(text).toBe("world");
	});
});

describe("head()", () => {
	let mock: ReturnType<typeof createMockR2>;
	let bucket: WorkkitR2<AvatarMeta>;

	beforeEach(() => {
		mock = createMockR2();
		bucket = r2<AvatarMeta>(mock);
	});

	it("returns object metadata without body", async () => {
		await mock.put("file.txt", "content", {
			httpMetadata: { contentType: "text/plain" },
			customMetadata: { userId: "abc", uploadedAt: "2024-01-01" },
		});
		const meta = await bucket.head("file.txt");
		expect(meta).not.toBeNull();
		expect(meta!.key).toBe("file.txt");
		expect(meta!.size).toBeGreaterThan(0);
		expect(meta!.httpMetadata?.contentType).toBe("text/plain");
		expect(meta!.customMetadata.userId).toBe("abc");
		// Should NOT have body property
		expect((meta as any).body).toBeUndefined();
	});

	it("returns null for missing key", async () => {
		const result = await bucket.head("nonexistent");
		expect(result).toBeNull();
	});

	it("throws ValidationError for empty key", async () => {
		await expect(bucket.head("")).rejects.toThrow(ValidationError);
	});

	it("returns correct size", async () => {
		const content = "hello world";
		await mock.put("file.txt", content);
		const meta = await bucket.head("file.txt");
		expect(meta!.size).toBe(new TextEncoder().encode(content).byteLength);
	});

	it("returns etag and version", async () => {
		await mock.put("file.txt", "content");
		const meta = await bucket.head("file.txt");
		expect(meta!.etag).toBeDefined();
		expect(meta!.version).toBeDefined();
		expect(meta!.httpEtag).toBeDefined();
	});
});

describe("put()", () => {
	let mock: ReturnType<typeof createMockR2>;
	let bucket: WorkkitR2<AvatarMeta>;

	beforeEach(() => {
		mock = createMockR2();
		bucket = r2<AvatarMeta>(mock);
	});

	it("stores a string value", async () => {
		const result = await bucket.put("file.txt", "hello");
		expect(result.key).toBe("file.txt");
		expect(result.size).toBe(5);
		expect(mock._store.has("file.txt")).toBe(true);
	});

	it("stores with typed custom metadata", async () => {
		const result = await bucket.put("avatars/123.png", "image-data", {
			customMetadata: { userId: "123", uploadedAt: "2024-01-01" },
		});
		expect(result.customMetadata).toEqual({ userId: "123", uploadedAt: "2024-01-01" });
	});

	it("stores with HTTP metadata", async () => {
		const result = await bucket.put("file.txt", "content", {
			httpMetadata: { contentType: "text/plain", cacheControl: "max-age=3600" },
		});
		expect(result.httpMetadata?.contentType).toBe("text/plain");
	});

	it("returns TypedR2Object with etag and version", async () => {
		const result = await bucket.put("file.txt", "content");
		expect(result.etag).toBeDefined();
		expect(result.version).toBeDefined();
		expect(result.uploaded).toBeInstanceOf(Date);
	});

	it("stores an ArrayBuffer", async () => {
		const buffer = new TextEncoder().encode("buffer-data").buffer;
		const result = await bucket.put("file.bin", buffer);
		expect(result.size).toBe(11);
	});

	it("stores null (empty object)", async () => {
		const result = await bucket.put("empty", null);
		expect(result.size).toBe(0);
	});

	it("overwrites existing object", async () => {
		await bucket.put("file.txt", "first");
		const result = await bucket.put("file.txt", "second");
		expect(result.size).toBe(6);
		const obj = await bucket.get("file.txt");
		const text = await obj!.text();
		expect(text).toBe("second");
	});

	it("throws ValidationError for empty key", async () => {
		await expect(bucket.put("", "data")).rejects.toThrow(ValidationError);
	});

	it("applies default HTTP metadata from options", async () => {
		const bucketWithDefaults = r2<AvatarMeta>(mock, {
			defaultHttpMetadata: { contentType: "application/octet-stream" },
		});
		const result = await bucketWithDefaults.put("file.bin", "data");
		expect(result.httpMetadata?.contentType).toBe("application/octet-stream");
	});

	it("per-call httpMetadata overrides defaults", async () => {
		const bucketWithDefaults = r2<AvatarMeta>(mock, {
			defaultHttpMetadata: { contentType: "application/octet-stream" },
		});
		const result = await bucketWithDefaults.put("file.txt", "data", {
			httpMetadata: { contentType: "text/plain" },
		});
		expect(result.httpMetadata?.contentType).toBe("text/plain");
	});
});

describe("delete()", () => {
	let mock: ReturnType<typeof createMockR2>;
	let bucket: WorkkitR2;

	beforeEach(() => {
		mock = createMockR2();
		bucket = r2(mock);
	});

	it("deletes a single object", async () => {
		await mock.put("file.txt", "content");
		expect(mock._store.has("file.txt")).toBe(true);
		await bucket.delete("file.txt");
		expect(mock._store.has("file.txt")).toBe(false);
	});

	it("deletes multiple objects (batch)", async () => {
		await mock.put("a.txt", "a");
		await mock.put("b.txt", "b");
		await mock.put("c.txt", "c");
		await bucket.delete(["a.txt", "b.txt"]);
		expect(mock._store.has("a.txt")).toBe(false);
		expect(mock._store.has("b.txt")).toBe(false);
		expect(mock._store.has("c.txt")).toBe(true);
	});

	it("succeeds silently for non-existent key", async () => {
		await expect(bucket.delete("nonexistent")).resolves.toBeUndefined();
	});

	it("throws ValidationError for empty key", async () => {
		await expect(bucket.delete("")).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for empty key in batch", async () => {
		await expect(bucket.delete(["valid", ""])).rejects.toThrow(ValidationError);
	});
});

describe("list()", () => {
	let mock: ReturnType<typeof createMockR2>;
	let bucket: WorkkitR2<AvatarMeta>;

	beforeEach(async () => {
		mock = createMockR2();
		bucket = r2<AvatarMeta>(mock);
		// Seed with data
		for (let i = 0; i < 5; i++) {
			await mock.put(`avatars/${i}.png`, `data-${i}`, {
				customMetadata: { userId: String(i), uploadedAt: "2024-01-01" },
			});
		}
		await mock.put("docs/readme.md", "# Hello");
		await mock.put("docs/guide.md", "# Guide");
	});

	it("iterates over all objects", async () => {
		const objects: any[] = [];
		for await (const obj of bucket.list()) {
			objects.push(obj);
		}
		expect(objects).toHaveLength(7);
	});

	it("filters by prefix", async () => {
		const objects: any[] = [];
		for await (const obj of bucket.list({ prefix: "avatars/" })) {
			objects.push(obj);
		}
		expect(objects).toHaveLength(5);
		for (const obj of objects) {
			expect(obj.key).toMatch(/^avatars\//);
		}
	});

	it("returns typed metadata on list items", async () => {
		const objects: any[] = [];
		for await (const obj of bucket.list({ prefix: "avatars/" })) {
			objects.push(obj);
		}
		expect(objects[0].customMetadata).toBeDefined();
	});

	it("respects limit option", async () => {
		const objects: any[] = [];
		for await (const obj of bucket.list({ limit: 3 })) {
			objects.push(obj);
		}
		// Should still get all 7, just in smaller pages
		expect(objects).toHaveLength(7);
	});

	it("paginates automatically with small limit", async () => {
		const page1 = await bucket.listPage({ limit: 3 });
		expect(page1.objects).toHaveLength(3);
		expect(page1.truncated).toBe(true);
		expect(page1.cursor).toBeDefined();

		const page2 = await bucket.listPage({ limit: 3, cursor: page1.cursor });
		expect(page2.objects).toHaveLength(3);
		expect(page2.truncated).toBe(true);

		const page3 = await bucket.listPage({ limit: 3, cursor: page2.cursor });
		expect(page3.objects).toHaveLength(1);
		expect(page3.truncated).toBe(false);
	});

	it("returns empty for non-matching prefix", async () => {
		const objects: any[] = [];
		for await (const obj of bucket.list({ prefix: "nonexistent/" })) {
			objects.push(obj);
		}
		expect(objects).toHaveLength(0);
	});

	it("listPage returns a single page", async () => {
		const page = await bucket.listPage({ limit: 3 });
		expect(page.objects).toHaveLength(3);
		expect(page.truncated).toBe(true);
		expect(page.cursor).toBeDefined();
		expect(page.delimitedPrefixes).toEqual([]);
	});

	it("supports delimiter for hierarchical listing", async () => {
		const page = await bucket.listPage({ delimiter: "/" });
		// With delimiter '/', objects at root level should be listed,
		// and subdirectories should appear as delimitedPrefixes
		expect(page.delimitedPrefixes).toContain("avatars/");
		expect(page.delimitedPrefixes).toContain("docs/");
	});
});

describe("key validation", () => {
	let bucket: WorkkitR2;

	beforeEach(() => {
		bucket = r2(createMockR2());
	});

	it("rejects empty key for get", async () => {
		await expect(bucket.get("")).rejects.toThrow(ValidationError);
	});

	it("rejects empty key for put", async () => {
		await expect(bucket.put("", "data")).rejects.toThrow(ValidationError);
	});

	it("rejects empty key for head", async () => {
		await expect(bucket.head("")).rejects.toThrow(ValidationError);
	});

	it("rejects empty key for delete", async () => {
		await expect(bucket.delete("")).rejects.toThrow(ValidationError);
	});

	it("rejects key longer than 1024 bytes", async () => {
		const longKey = "a".repeat(1025);
		await expect(bucket.get(longKey)).rejects.toThrow(ValidationError);
	});

	it("accepts key exactly 1024 bytes", async () => {
		const maxKey = "a".repeat(1024);
		// Should not throw
		const result = await bucket.get(maxKey);
		expect(result).toBeNull();
	});
});
