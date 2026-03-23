import { describe, expect, it } from "vitest";
import {
	KVError,
	KVNotFoundError,
	KVSerializationError,
	KVValidationError,
} from "../src/kv-errors";

describe("KVError", () => {
	it("creates a base KV error with message", () => {
		const err = new KVError("something went wrong");
		expect(err.message).toBe("something went wrong");
		expect(err).toBeInstanceOf(Error);
	});
});

describe("KVNotFoundError", () => {
	it("creates error with key context", () => {
		const err = new KVNotFoundError("user:123");
		expect(err.message).toContain("user:123");
		expect(err.kvKey).toBe("user:123");
		expect(err.code).toBe("WORKKIT_NOT_FOUND");
		expect(err.statusCode).toBe(404);
		expect(err.retryable).toBe(false);
	});
});

describe("KVValidationError", () => {
	it("creates error with key and validation message", () => {
		const err = new KVValidationError("user:123", "invalid email");
		expect(err.message).toContain("user:123");
		expect(err.message).toContain("invalid email");
		expect(err.kvKey).toBe("user:123");
		expect(err.validationMessage).toBe("invalid email");
	});

	it("includes issues in error", () => {
		const issues = [{ path: ["email"], message: "invalid email" }];
		const err = new KVValidationError("user:123", "invalid email", issues);
		expect(err).toBeInstanceOf(Error);
	});
});

describe("KVSerializationError", () => {
	it("creates error for deserialization failure", () => {
		const cause = new SyntaxError("Unexpected token");
		const err = new KVSerializationError("deserialize", "user:123", cause);
		expect(err.message).toContain("deserialize");
		expect(err.message).toContain("user:123");
	});

	it("creates error for serialization failure", () => {
		const err = new KVSerializationError("serialize", "data:key");
		expect(err.message).toContain("serialize");
		expect(err.message).toContain("data:key");
	});
});
