import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { EnvValidationError } from "../src/errors";
import { createEnvParser, parseEnv, parseEnvSync } from "../src/parse";

// Helper: create a simple sync Standard Schema validator
function stringSchema(): StandardSchemaV1<string, string> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result<string> {
				if (typeof value !== "string") {
					return { issues: [{ message: "Expected a string" }] };
				}
				return { value };
			},
		},
	};
}

function numberSchema(): StandardSchemaV1<number, number> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result<number> {
				if (typeof value !== "number") {
					return { issues: [{ message: "Expected a number" }] };
				}
				return { value };
			},
		},
	};
}

function defaultSchema<T>(defaultValue: T): StandardSchemaV1<T | undefined, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): StandardSchemaV1.Result<T> {
				if (value === undefined) return { value: defaultValue };
				return { value: value as T };
			},
		},
	};
}

function asyncSchema(): StandardSchemaV1<string, string> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate(value): Promise<StandardSchemaV1.Result<string>> {
				return Promise.resolve(
					typeof value === "string"
						? { value }
						: { issues: [{ message: "Expected a string (async)" }] },
				);
			},
		},
	};
}

describe("parseEnvSync", () => {
	it("validates and returns typed env with all valid values", () => {
		const schema = {
			API_KEY: stringSchema(),
			PORT: numberSchema(),
		};
		const result = parseEnvSync({ API_KEY: "sk-123", PORT: 3000 }, schema);
		expect(result.API_KEY).toBe("sk-123");
		expect(result.PORT).toBe(3000);
	});

	it("applies default values from validators", () => {
		const schema = {
			RATE_LIMIT: defaultSchema(100),
		};
		const result = parseEnvSync({}, schema);
		expect(result.RATE_LIMIT).toBe(100);
	});

	it("passes through raw values when validation succeeds", () => {
		const obj = { foo: "bar" };
		const schema = {
			DATA: {
				"~standard": {
					version: 1 as const,
					vendor: "test",
					validate: (v: unknown) => ({ value: v }),
				},
			} as StandardSchemaV1,
		};
		const result = parseEnvSync({ DATA: obj }, schema);
		expect(result.DATA).toBe(obj);
	});

	it("throws EnvValidationError when required key is missing", () => {
		const schema = { API_KEY: stringSchema() };
		expect(() => parseEnvSync({}, schema)).toThrow(EnvValidationError);
	});

	it("throws EnvValidationError when value fails validation", () => {
		const schema = { PORT: numberSchema() };
		expect(() => parseEnvSync({ PORT: "not-a-number" }, schema)).toThrow(EnvValidationError);
	});

	it("collects ALL issues before throwing (not fail-fast)", () => {
		const schema = {
			A: stringSchema(),
			B: numberSchema(),
			C: stringSchema(),
		};
		try {
			parseEnvSync({}, schema);
			expect.unreachable("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EnvValidationError);
			const envErr = err as EnvValidationError;
			expect(envErr.issues).toHaveLength(3);
			expect(envErr.issues.map((i) => i.key)).toEqual(["A", "B", "C"]);
		}
	});

	it("includes key name and received value in each issue", () => {
		const schema = { PORT: numberSchema() };
		try {
			parseEnvSync({ PORT: "abc" }, schema);
			expect.unreachable("Should have thrown");
		} catch (err) {
			const envErr = err as EnvValidationError;
			expect(envErr.issues[0].key).toBe("PORT");
			expect(envErr.issues[0].received).toBe("abc");
		}
	});

	it("handles empty schema (returns empty object)", () => {
		const result = parseEnvSync({ FOO: "bar" }, {});
		expect(result).toEqual({});
	});

	it("ignores extra keys in rawEnv not in schema", () => {
		const schema = { API_KEY: stringSchema() };
		const result = parseEnvSync({ API_KEY: "test", EXTRA: "ignored" }, schema);
		expect(result).toEqual({ API_KEY: "test" });
		expect("EXTRA" in result).toBe(false);
	});

	it("handles undefined values for optional validators", () => {
		const schema = { OPT: defaultSchema("fallback") };
		const result = parseEnvSync({}, schema);
		expect(result.OPT).toBe("fallback");
	});

	it("throws immediately if a validator returns a Promise", () => {
		const schema = { ASYNC_VAL: asyncSchema() };
		expect(() => parseEnvSync({ ASYNC_VAL: "test" }, schema)).toThrow(
			/Use parseEnv\(\) \(async\) instead of parseEnvSync/,
		);
	});
});

describe("parseEnv (async)", () => {
	it("resolves all validators in parallel", async () => {
		const schema = {
			A: stringSchema(),
			B: numberSchema(),
		};
		const result = await parseEnv({ A: "hello", B: 42 }, schema);
		expect(result.A).toBe("hello");
		expect(result.B).toBe(42);
	});

	it("handles mix of sync and async validators", async () => {
		const schema = {
			SYNC_VAL: stringSchema(),
			ASYNC_VAL: asyncSchema(),
		};
		const result = await parseEnv({ SYNC_VAL: "a", ASYNC_VAL: "b" }, schema);
		expect(result.SYNC_VAL).toBe("a");
		expect(result.ASYNC_VAL).toBe("b");
	});

	it("throws EnvValidationError with all issues from parallel validation", async () => {
		const schema = {
			A: stringSchema(),
			B: numberSchema(),
		};
		await expect(parseEnv({}, schema)).rejects.toThrow(EnvValidationError);
		try {
			await parseEnv({}, schema);
		} catch (err) {
			const envErr = err as EnvValidationError;
			expect(envErr.issues).toHaveLength(2);
		}
	});

	it("handles async validator failures", async () => {
		const schema = { VAL: asyncSchema() };
		await expect(parseEnv({ VAL: 123 }, schema)).rejects.toThrow(EnvValidationError);
	});
});

describe("createEnvParser", () => {
	it("returns parse and parseSync bound to schema", () => {
		const schema = { API_KEY: stringSchema() };
		const parser = createEnvParser(schema);
		expect(typeof parser.parse).toBe("function");
		expect(typeof parser.parseSync).toBe("function");
		expect(parser.schema).toBe(schema);
	});

	it("reuses schema across multiple calls", () => {
		const schema = { API_KEY: stringSchema() };
		const parser = createEnvParser(schema);
		const r1 = parser.parseSync({ API_KEY: "a" });
		const r2 = parser.parseSync({ API_KEY: "b" });
		expect(r1.API_KEY).toBe("a");
		expect(r2.API_KEY).toBe("b");
	});

	it("async parse works", async () => {
		const schema = { API_KEY: stringSchema() };
		const parser = createEnvParser(schema);
		const result = await parser.parse({ API_KEY: "test" });
		expect(result.API_KEY).toBe("test");
	});
});
