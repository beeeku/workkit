import { BindingNotFoundError, ValidationError } from "@workkit/errors";
import { beforeEach, describe, expect, it } from "vitest";
import { multipartUpload } from "../src/multipart";
import { createMockR2 } from "./helpers/mock-r2";

describe("multipartUpload()", () => {
	let mock: ReturnType<typeof createMockR2>;

	beforeEach(() => {
		mock = createMockR2();
	});

	it("creates a multipart upload session", async () => {
		const session = await multipartUpload(mock, "large-file.zip");
		expect(session).toBeDefined();
		expect(session.uploadId).toBeDefined();
		expect(typeof session.uploadPart).toBe("function");
		expect(typeof session.complete).toBe("function");
		expect(typeof session.abort).toBe("function");
	});

	it("uploads parts and completes", async () => {
		const session = await multipartUpload(mock, "large-file.zip");

		const part1 = await session.uploadPart(1, "part-1-data");
		expect(part1.partNumber).toBe(1);
		expect(part1.etag).toBeDefined();

		const part2 = await session.uploadPart(2, "part-2-data");
		expect(part2.partNumber).toBe(2);

		const result = await session.complete();
		expect(result.key).toBe("large-file.zip");
		expect(result.size).toBeGreaterThan(0);
	});

	it("assembles parts in order", async () => {
		const session = await multipartUpload(mock, "assembled.txt");
		await session.uploadPart(1, "Hello, ");
		await session.uploadPart(2, "World!");
		await session.complete();

		// Verify assembled content
		const obj = await mock.get("assembled.txt");
		const text = await obj!.text();
		expect(text).toBe("Hello, World!");
	});

	it("supports out-of-order part uploads", async () => {
		const session = await multipartUpload(mock, "ooo.txt");
		await session.uploadPart(3, "C");
		await session.uploadPart(1, "A");
		await session.uploadPart(2, "B");
		await session.complete();

		const obj = await mock.get("ooo.txt");
		const text = await obj!.text();
		expect(text).toBe("ABC");
	});

	it("stores object in bucket after completion", async () => {
		const session = await multipartUpload(mock, "result.txt");
		await session.uploadPart(1, "content");
		await session.complete();

		expect(mock._store.has("result.txt")).toBe(true);
	});

	it("preserves httpMetadata on completion", async () => {
		const session = await multipartUpload(mock, "file.txt", {
			httpMetadata: { contentType: "text/plain" },
		});
		await session.uploadPart(1, "data");
		const result = await session.complete();
		expect(result.httpMetadata?.contentType).toBe("text/plain");
	});

	it("preserves customMetadata on completion", async () => {
		const session = await multipartUpload(mock, "file.txt", {
			customMetadata: { author: "test" },
		});
		await session.uploadPart(1, "data");
		const result = await session.complete();
		expect(result.customMetadata).toEqual({ author: "test" });
	});

	it("abort() discards uploaded parts", async () => {
		const session = await multipartUpload(mock, "aborted.txt");
		await session.uploadPart(1, "data");
		await session.abort();

		// Object should not exist in bucket
		expect(mock._store.has("aborted.txt")).toBe(false);
	});

	// Validation errors

	it("throws BindingNotFoundError for null bucket", async () => {
		await expect(multipartUpload(null as any, "file.txt")).rejects.toThrow(BindingNotFoundError);
	});

	it("throws ValidationError for empty key", async () => {
		await expect(multipartUpload(mock, "")).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for part size below 5MB", async () => {
		await expect(multipartUpload(mock, "file.txt", { partSize: 1024 })).rejects.toThrow(
			ValidationError,
		);
	});

	it("throws ValidationError for part number < 1", async () => {
		const session = await multipartUpload(mock, "file.txt");
		await expect(session.uploadPart(0, "data")).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for part number > 10000", async () => {
		const session = await multipartUpload(mock, "file.txt");
		await expect(session.uploadPart(10001, "data")).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError when completing with no parts", async () => {
		const session = await multipartUpload(mock, "file.txt");
		await expect(session.complete()).rejects.toThrow(ValidationError);
	});

	it("returns unique upload IDs per session", async () => {
		const session1 = await multipartUpload(mock, "file1.txt");
		const session2 = await multipartUpload(mock, "file2.txt");
		expect(session1.uploadId).not.toBe(session2.uploadId);
	});

	it("supports ArrayBuffer parts", async () => {
		const session = await multipartUpload(mock, "binary.bin");
		const buffer = new TextEncoder().encode("binary-data").buffer;
		const part = await session.uploadPart(1, buffer);
		expect(part.partNumber).toBe(1);
		await session.complete();

		const obj = await mock.get("binary.bin");
		const text = await obj!.text();
		expect(text).toBe("binary-data");
	});
});
