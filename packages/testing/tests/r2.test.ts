import { beforeEach, describe, expect, it } from "vitest";
import { createMockR2 } from "../src/r2";

describe("createMockR2", () => {
	let bucket: ReturnType<typeof createMockR2>;

	beforeEach(() => {
		bucket = createMockR2();
	});

	describe("put", () => {
		it("stores a string value", async () => {
			const obj = await bucket.put("key", "hello");
			expect(obj.key).toBe("key");
			expect(obj.size).toBe(5);
		});

		it("stores an ArrayBuffer", async () => {
			const buf = new TextEncoder().encode("hello").buffer;
			const obj = await bucket.put("key", buf);
			expect(obj.size).toBe(5);
		});

		it("stores with custom metadata", async () => {
			const obj = await bucket.put("key", "val", { customMetadata: { tag: "test" } });
			expect(obj.customMetadata).toEqual({ tag: "test" });
		});

		it("stores with httpMetadata", async () => {
			const obj = await bucket.put("key", "val", { httpMetadata: { contentType: "text/plain" } });
			expect(obj.httpMetadata).toEqual({ contentType: "text/plain" });
		});

		it("overwrites existing values", async () => {
			await bucket.put("key", "first");
			await bucket.put("key", "second");
			const obj = await bucket.get("key");
			expect(obj).not.toBeNull();
			const text = await obj!.text();
			expect(text).toBe("second");
		});
	});

	describe("get", () => {
		it("returns null for missing keys", async () => {
			expect(await bucket.get("missing")).toBeNull();
		});

		it("returns an R2ObjectBody with text()", async () => {
			await bucket.put("key", "hello world");
			const obj = await bucket.get("key");
			expect(obj).not.toBeNull();
			expect(await obj!.text()).toBe("hello world");
		});

		it("returns an R2ObjectBody with arrayBuffer()", async () => {
			await bucket.put("key", "abc");
			const obj = await bucket.get("key");
			const buf = await obj!.arrayBuffer();
			expect(new TextDecoder().decode(buf)).toBe("abc");
		});

		it("returns an R2ObjectBody with json()", async () => {
			await bucket.put("key", JSON.stringify({ x: 1 }));
			const obj = await bucket.get("key");
			expect(await obj!.json()).toEqual({ x: 1 });
		});

		it("returns an R2ObjectBody with blob()", async () => {
			await bucket.put("key", "data");
			const obj = await bucket.get("key");
			const blob = await obj!.blob();
			expect(blob.size).toBe(4);
		});

		it("includes metadata in response", async () => {
			await bucket.put("key", "val", { customMetadata: { a: "b" } });
			const obj = await bucket.get("key");
			expect(obj!.customMetadata).toEqual({ a: "b" });
		});

		it("includes key and size", async () => {
			await bucket.put("mykey", "content");
			const obj = await bucket.get("mykey");
			expect(obj!.key).toBe("mykey");
			expect(obj!.size).toBe(7);
		});
	});

	describe("head", () => {
		it("returns null for missing keys", async () => {
			expect(await bucket.head("missing")).toBeNull();
		});

		it("returns metadata without body", async () => {
			await bucket.put("key", "hello", { customMetadata: { v: "1" } });
			const obj = await bucket.head("key");
			expect(obj).not.toBeNull();
			expect(obj!.key).toBe("key");
			expect(obj!.size).toBe(5);
			expect(obj!.customMetadata).toEqual({ v: "1" });
		});
	});

	describe("delete", () => {
		it("deletes a single key", async () => {
			await bucket.put("key", "val");
			await bucket.delete("key");
			expect(await bucket.get("key")).toBeNull();
		});

		it("deletes multiple keys", async () => {
			await bucket.put("a", "1");
			await bucket.put("b", "2");
			await bucket.delete(["a", "b"]);
			expect(await bucket.get("a")).toBeNull();
			expect(await bucket.get("b")).toBeNull();
		});

		it("is a no-op for missing keys", async () => {
			await expect(bucket.delete("missing")).resolves.toBeUndefined();
		});
	});

	describe("list", () => {
		beforeEach(async () => {
			await bucket.put("photos/2023/a.jpg", "a");
			await bucket.put("photos/2023/b.jpg", "b");
			await bucket.put("photos/2024/c.jpg", "c");
			await bucket.put("docs/readme.md", "d");
		});

		it("lists all objects", async () => {
			const result = await bucket.list();
			expect(result.objects).toHaveLength(4);
			expect(result.truncated).toBe(false);
		});

		it("filters by prefix", async () => {
			const result = await bucket.list({ prefix: "photos/2023/" });
			expect(result.objects).toHaveLength(2);
		});

		it("limits results", async () => {
			const result = await bucket.list({ limit: 2 });
			expect(result.objects).toHaveLength(2);
			expect(result.truncated).toBe(true);
			expect(result.cursor).toBeDefined();
		});

		it("paginates with cursor", async () => {
			const page1 = await bucket.list({ limit: 2 });
			const page2 = await bucket.list({ limit: 2, cursor: page1.cursor });
			expect(page2.objects).toHaveLength(2);
			expect(page2.truncated).toBe(false);
		});

		it("supports delimiter for directory-like listing", async () => {
			const result = await bucket.list({ delimiter: "/" });
			expect(result.delimitedPrefixes).toContain("photos/");
			expect(result.delimitedPrefixes).toContain("docs/");
		});

		it("supports prefix + delimiter", async () => {
			const result = await bucket.list({ prefix: "photos/", delimiter: "/" });
			expect(result.delimitedPrefixes).toContain("photos/2023/");
			expect(result.delimitedPrefixes).toContain("photos/2024/");
			expect(result.objects).toHaveLength(0);
		});

		it("returns objects sorted alphabetically", async () => {
			const result = await bucket.list();
			const keys = result.objects.map((o: any) => o.key);
			expect(keys).toEqual([...keys].sort());
		});
	});

	describe("multipart upload stubs", () => {
		it("createMultipartUpload returns an upload object", async () => {
			const upload = await bucket.createMultipartUpload("big-file");
			expect(upload.key).toBe("big-file");
			expect(upload.uploadId).toBeDefined();
		});

		it("resumeMultipartUpload returns an upload object", () => {
			const upload = bucket.resumeMultipartUpload("big-file", "upload-123");
			expect(upload.key).toBe("big-file");
			expect(upload.uploadId).toBe("upload-123");
		});
	});
});
