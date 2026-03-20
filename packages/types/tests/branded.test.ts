import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type Branded,
	type D1RowId,
	type DurableObjectId,
	type KVKey,
	type QueueMessageId,
	type R2ObjectKey,
	brand,
	d1RowId,
	durableObjectId,
	kvKey,
	queueMessageId,
	r2ObjectKey,
} from "../src/branded";

describe("branded", () => {
	describe("constructors return input unchanged", () => {
		it("kvKey", () => {
			expect(kvKey("user:123")).toBe("user:123");
		});

		it("d1RowId", () => {
			expect(d1RowId("abc")).toBe("abc");
		});

		it("r2ObjectKey", () => {
			expect(r2ObjectKey("images/photo.png")).toBe("images/photo.png");
		});

		it("durableObjectId", () => {
			expect(durableObjectId("deadbeef")).toBe("deadbeef");
		});

		it("queueMessageId", () => {
			expect(queueMessageId("msg-1")).toBe("msg-1");
		});

		it("generic brand", () => {
			expect(brand<string, "UserId">("u-123")).toBe("u-123");
		});
	});

	describe("type-level tests", () => {
		it("branded types are not assignable to each other", () => {
			const key = kvKey("user:123");
			const rowId = d1RowId("abc");

			expectTypeOf(key).not.toMatchTypeOf<D1RowId>();
			expectTypeOf(rowId).not.toMatchTypeOf<KVKey>();
		});

		it("plain string is not assignable to branded type", () => {
			expectTypeOf("raw-string" as string).not.toMatchTypeOf<KVKey>();
			expectTypeOf("raw-string" as string).not.toMatchTypeOf<D1RowId>();
		});

		it("each constructor returns the correct branded type", () => {
			expectTypeOf(kvKey("x")).toMatchTypeOf<KVKey>();
			expectTypeOf(d1RowId("x")).toMatchTypeOf<D1RowId>();
			expectTypeOf(r2ObjectKey("x")).toMatchTypeOf<R2ObjectKey>();
			expectTypeOf(durableObjectId("x")).toMatchTypeOf<DurableObjectId>();
			expectTypeOf(queueMessageId("x")).toMatchTypeOf<QueueMessageId>();
		});

		it("generic Branded type works for custom brands", () => {
			type UserId = Branded<string, "UserId">;
			const userId = brand<string, "UserId">("u-123");
			expectTypeOf(userId).toMatchTypeOf<UserId>();
			expectTypeOf(userId).not.toMatchTypeOf<KVKey>();
		});
	});
});
