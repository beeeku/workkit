import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type AsyncResult,
	Err,
	type InferErr,
	type InferOk,
	Ok,
	type Result,
	isErr,
	isOk,
	unwrap,
} from "../src/result";

describe("Result", () => {
	describe("Ok", () => {
		it("creates a success result", () => {
			const result = Ok(42);
			expect(result.ok).toBe(true);
			expect(result.value).toBe(42);
		});

		it("works with complex values", () => {
			const result = Ok({ name: "test", items: [1, 2, 3] });
			expect(result.ok).toBe(true);
			expect(result.value.name).toBe("test");
		});
	});

	describe("Err", () => {
		it("creates a failure result", () => {
			const result = Err("something broke");
			expect(result.ok).toBe(false);
			expect(result.error).toBe("something broke");
		});

		it("works with Error objects", () => {
			const err = new Error("fail");
			const result = Err(err);
			expect(result.ok).toBe(false);
			expect(result.error).toBe(err);
		});
	});

	describe("isOk / isErr", () => {
		it("correctly identifies Ok", () => {
			expect(isOk(Ok(1))).toBe(true);
			expect(isOk(Err("x"))).toBe(false);
		});

		it("correctly identifies Err", () => {
			expect(isErr(Err("x"))).toBe(true);
			expect(isErr(Ok(1))).toBe(false);
		});
	});

	describe("unwrap", () => {
		it("returns value from Ok", () => {
			expect(unwrap(Ok(42))).toBe(42);
		});

		it("throws on Err with Error", () => {
			expect(() => unwrap(Err(new Error("boom")))).toThrow("boom");
		});

		it("throws on Err with string", () => {
			expect(() => unwrap(Err("boom"))).toThrow("boom");
		});

		it("throws on Err with number (converts to string)", () => {
			expect(() => unwrap(Err(42))).toThrow("42");
		});

		it("throws on Err with null (converts to string)", () => {
			expect(() => unwrap(Err(null))).toThrow("null");
		});

		it("throws on Err with object (converts to string)", () => {
			expect(() => unwrap(Err({ code: "FAIL" }))).toThrow("[object Object]");
		});

		it("returns the correct value type", () => {
			const result: Result<{ name: string }, string> = Ok({ name: "test" });
			const val = unwrap(result);
			expect(val.name).toBe("test");
		});
	});

	describe("type-level tests", () => {
		it("Ok produces Result with never error", () => {
			expectTypeOf(Ok(42)).toMatchTypeOf<Result<number, never>>();
		});

		it("Err produces Result with never value", () => {
			expectTypeOf(Err("boom")).toMatchTypeOf<Result<never, string>>();
		});

		it("narrows with isOk", () => {
			const result: Result<number, string> = Ok(42);
			if (isOk(result)) {
				expectTypeOf(result.value).toBeNumber();
			}
		});

		it("narrows with isErr", () => {
			const result: Result<number, string> = Err("fail");
			if (isErr(result)) {
				expectTypeOf(result.error).toBeString();
			}
		});

		it("InferOk extracts success type", () => {
			expectTypeOf<InferOk<Result<number, string>>>().toBeNumber();
		});

		it("InferErr extracts error type", () => {
			expectTypeOf<InferErr<Result<number, string>>>().toBeString();
		});

		it("AsyncResult is a Promise of Result", () => {
			expectTypeOf<AsyncResult<number>>().toEqualTypeOf<Promise<Result<number, Error>>>();
		});
	});
});
