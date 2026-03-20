import {
	BindingNotFoundError,
	ConfigError,
	InternalError,
	NotFoundError,
	ServiceUnavailableError,
	TimeoutError,
	ValidationError,
} from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { assertR2Binding, validateR2Key, wrapR2Error } from "../src/errors";

describe("assertR2Binding()", () => {
	it("passes for valid R2Bucket-like object", () => {
		const mock = {
			get: () => {},
			put: () => {},
			delete: () => {},
			list: () => {},
			head: () => {},
		};
		expect(() => assertR2Binding(mock)).not.toThrow();
	});

	it("throws BindingNotFoundError for null", () => {
		expect(() => assertR2Binding(null)).toThrow(BindingNotFoundError);
	});

	it("throws BindingNotFoundError for undefined", () => {
		expect(() => assertR2Binding(undefined)).toThrow(BindingNotFoundError);
	});

	it("throws BindingNotFoundError for number", () => {
		expect(() => assertR2Binding(42)).toThrow(BindingNotFoundError);
	});

	it("throws BindingNotFoundError for string", () => {
		expect(() => assertR2Binding("bucket")).toThrow(BindingNotFoundError);
	});

	it("throws ConfigError for object missing head()", () => {
		expect(() =>
			assertR2Binding({
				get: () => {},
				put: () => {},
				delete: () => {},
				list: () => {},
			}),
		).toThrow(ConfigError);
	});

	it("throws ConfigError for object missing get()", () => {
		expect(() =>
			assertR2Binding({
				put: () => {},
				delete: () => {},
				list: () => {},
				head: () => {},
			}),
		).toThrow(ConfigError);
	});

	it("throws ConfigError for empty object", () => {
		expect(() => assertR2Binding({})).toThrow(ConfigError);
	});
});

describe("validateR2Key()", () => {
	it("passes for valid key", () => {
		expect(() => validateR2Key("file.txt")).not.toThrow();
	});

	it("passes for key with slashes", () => {
		expect(() => validateR2Key("path/to/file.txt")).not.toThrow();
	});

	it("passes for key with special characters", () => {
		expect(() => validateR2Key("path/file (1).txt")).not.toThrow();
	});

	it("passes for key exactly 1024 bytes", () => {
		expect(() => validateR2Key("a".repeat(1024))).not.toThrow();
	});

	it("throws ValidationError for empty key", () => {
		expect(() => validateR2Key("")).toThrow(ValidationError);
	});

	it("throws ValidationError for key > 1024 bytes", () => {
		expect(() => validateR2Key("a".repeat(1025))).toThrow(ValidationError);
	});

	it("ValidationError for empty key has correct code", () => {
		try {
			validateR2Key("");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as ValidationError).issues[0].code).toBe("WORKKIT_R2_EMPTY_KEY");
		}
	});

	it("ValidationError for long key has correct code", () => {
		try {
			validateR2Key("a".repeat(1025));
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as ValidationError).issues[0].code).toBe("WORKKIT_R2_KEY_TOO_LONG");
		}
	});

	it("counts multi-byte characters correctly", () => {
		// Each emoji is 4 bytes in UTF-8
		const key = "🎉".repeat(256); // 1024 bytes exactly
		expect(() => validateR2Key(key)).not.toThrow();

		const tooLong = "🎉".repeat(257); // 1028 bytes
		expect(() => validateR2Key(tooLong)).toThrow(ValidationError);
	});
});

describe("wrapR2Error()", () => {
	it("wraps timeout errors", () => {
		expect(() =>
			wrapR2Error(new Error("request timed out"), { operation: "get", key: "k" }),
		).toThrow(TimeoutError);
	});

	it("wraps timeout keyword", () => {
		expect(() =>
			wrapR2Error(new Error("timeout exceeded"), { operation: "get", key: "k" }),
		).toThrow(TimeoutError);
	});

	it("wraps 503 as ServiceUnavailableError", () => {
		expect(() => wrapR2Error(new Error("503 service unavailable"), { operation: "put" })).toThrow(
			ServiceUnavailableError,
		);
	});

	it("wraps service unavailable message", () => {
		expect(() => wrapR2Error(new Error("service is unavailable"), { operation: "list" })).toThrow(
			ServiceUnavailableError,
		);
	});

	it("wraps not found as NotFoundError", () => {
		expect(() =>
			wrapR2Error(new Error("object not found"), { operation: "get", key: "missing" }),
		).toThrow(NotFoundError);
	});

	it("wraps 404 as NotFoundError", () => {
		expect(() => wrapR2Error(new Error("404"), { operation: "get", key: "missing" })).toThrow(
			NotFoundError,
		);
	});

	it("wraps unknown errors as InternalError", () => {
		expect(() =>
			wrapR2Error(new Error("something weird happened"), { operation: "delete" }),
		).toThrow(InternalError);
	});

	it("wraps non-Error values", () => {
		expect(() => wrapR2Error("string error", { operation: "put" })).toThrow(InternalError);
	});

	it("preserves context in wrapped error", () => {
		try {
			wrapR2Error(new Error("oops"), { operation: "get", key: "test-key" });
		} catch (err) {
			expect((err as any).context).toEqual({ operation: "get", key: "test-key" });
		}
	});

	it("preserves cause in wrapped error", () => {
		const original = new Error("original");
		try {
			wrapR2Error(original, { operation: "put" });
		} catch (err) {
			expect((err as any).cause).toBe(original);
		}
	});
});
