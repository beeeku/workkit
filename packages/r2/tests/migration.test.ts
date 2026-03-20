import { ValidationError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { fromS3Key, toS3Key } from "../src/migration";

describe("fromS3Key()", () => {
	it("extracts key from simple S3 URI", () => {
		expect(fromS3Key("s3://my-bucket/file.txt")).toBe("file.txt");
	});

	it("extracts key from nested S3 URI", () => {
		expect(fromS3Key("s3://my-bucket/path/to/file.txt")).toBe("path/to/file.txt");
	});

	it("handles deeply nested paths", () => {
		expect(fromS3Key("s3://bucket/a/b/c/d/e.txt")).toBe("a/b/c/d/e.txt");
	});

	it("preserves special characters in key", () => {
		expect(fromS3Key("s3://bucket/path/file name (1).txt")).toBe("path/file name (1).txt");
	});

	it("handles bucket names with dots", () => {
		expect(fromS3Key("s3://my.bucket.name/key.txt")).toBe("key.txt");
	});

	it("handles bucket names with hyphens", () => {
		expect(fromS3Key("s3://my-bucket-name/key.txt")).toBe("key.txt");
	});

	it("throws ValidationError for missing s3:// prefix", () => {
		expect(() => fromS3Key("http://bucket/key")).toThrow(ValidationError);
	});

	it("throws ValidationError for just s3://", () => {
		expect(() => fromS3Key("s3://")).toThrow(ValidationError);
	});

	it("throws ValidationError for bucket only (no key)", () => {
		expect(() => fromS3Key("s3://bucket/")).toThrow(ValidationError);
	});

	it("throws ValidationError for bucket without slash", () => {
		expect(() => fromS3Key("s3://bucket")).toThrow(ValidationError);
	});
});

describe("toS3Key()", () => {
	it("creates S3 URI from key and bucket", () => {
		expect(toS3Key("file.txt", "my-bucket")).toBe("s3://my-bucket/file.txt");
	});

	it("creates S3 URI from nested key", () => {
		expect(toS3Key("path/to/file.txt", "my-bucket")).toBe("s3://my-bucket/path/to/file.txt");
	});

	it("strips leading slash from key", () => {
		expect(toS3Key("/path/to/file.txt", "my-bucket")).toBe("s3://my-bucket/path/to/file.txt");
	});

	it("handles bucket names with dots", () => {
		expect(toS3Key("key.txt", "my.bucket")).toBe("s3://my.bucket/key.txt");
	});

	it("preserves special characters", () => {
		expect(toS3Key("path/file (1).txt", "bucket")).toBe("s3://bucket/path/file (1).txt");
	});

	it("throws ValidationError for empty key", () => {
		expect(() => toS3Key("", "bucket")).toThrow(ValidationError);
	});

	it("throws ValidationError for empty bucket", () => {
		expect(() => toS3Key("key.txt", "")).toThrow(ValidationError);
	});
});

describe("roundtrip conversion", () => {
	it("fromS3Key -> toS3Key preserves the URI", () => {
		const uri = "s3://my-bucket/path/to/file.txt";
		const key = fromS3Key(uri);
		const result = toS3Key(key, "my-bucket");
		expect(result).toBe(uri);
	});

	it("toS3Key -> fromS3Key preserves the key", () => {
		const key = "path/to/file.txt";
		const uri = toS3Key(key, "my-bucket");
		const result = fromS3Key(uri);
		expect(result).toBe(key);
	});

	it("handles single-level key roundtrip", () => {
		const key = "file.txt";
		expect(fromS3Key(toS3Key(key, "b"))).toBe(key);
	});

	it("handles deep path roundtrip", () => {
		const key = "a/b/c/d/e/f/g.txt";
		expect(fromS3Key(toS3Key(key, "b"))).toBe(key);
	});
});
