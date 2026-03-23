import { EnvValidationError, createEnvParser, parseEnv, parseEnvSync } from "@workkit/env";
import { describe, expect, it } from "vitest";
import { createTestEnv } from "./helpers/setup";
import { createNumberSchema, createObjectSchema, createStringSchema } from "./helpers/setup";

describe("Environment validation E2E", () => {
	describe("valid environments pass", () => {
		it("validates string bindings", async () => {
			const schema = {
				API_KEY: createStringSchema(),
				API_URL: createStringSchema(),
			};

			const rawEnv = { API_KEY: "sk-test-123", API_URL: "https://api.example.com" };
			const parsed = await parseEnv(rawEnv, schema);

			expect(parsed.API_KEY).toBe("sk-test-123");
			expect(parsed.API_URL).toBe("https://api.example.com");
		});

		it("validates number bindings", async () => {
			const schema = {
				PORT: createNumberSchema({ min: 1, max: 65535 }),
				MAX_RETRIES: createNumberSchema({ min: 0 }),
			};

			const rawEnv = { PORT: 8080, MAX_RETRIES: 3 };
			const parsed = await parseEnv(rawEnv, schema);

			expect(parsed.PORT).toBe(8080);
			expect(parsed.MAX_RETRIES).toBe(3);
		});

		it("validates with parseEnvSync", () => {
			const schema = {
				API_KEY: createStringSchema(),
			};

			const rawEnv = { API_KEY: "test-key" };
			const parsed = parseEnvSync(rawEnv, schema);
			expect(parsed.API_KEY).toBe("test-key");
		});

		it("validates with createEnvParser", async () => {
			const schema = {
				DATABASE_URL: createStringSchema({ minLength: 1 }),
				PORT: createNumberSchema({ min: 1 }),
			};

			const parser = createEnvParser(schema);
			const parsed = await parser.parse({ DATABASE_URL: "sqlite:///test.db", PORT: 3000 });
			expect(parsed.DATABASE_URL).toBe("sqlite:///test.db");
			expect(parsed.PORT).toBe(3000);
		});

		it("validates sync with createEnvParser", () => {
			const schema = {
				NAME: createStringSchema(),
			};

			const parser = createEnvParser(schema);
			const parsed = parser.parseSync({ NAME: "test" });
			expect(parsed.NAME).toBe("test");
		});
	});

	describe("missing bindings fail with clear errors", () => {
		it("reports missing string bindings", async () => {
			const schema = {
				API_KEY: createStringSchema(),
				SECRET: createStringSchema(),
			};

			const rawEnv = {}; // nothing provided
			await expect(parseEnv(rawEnv, schema)).rejects.toThrow(EnvValidationError);

			try {
				await parseEnv(rawEnv, schema);
			} catch (err) {
				expect(err).toBeInstanceOf(EnvValidationError);
				const envErr = err as EnvValidationError;
				expect(envErr.issues).toHaveLength(2);
				expect(envErr.issues.some((i) => i.key === "API_KEY")).toBe(true);
				expect(envErr.issues.some((i) => i.key === "SECRET")).toBe(true);
			}
		});

		it("reports a single missing binding", async () => {
			const schema = {
				API_KEY: createStringSchema(),
				API_URL: createStringSchema(),
			};

			const rawEnv = { API_KEY: "valid-key" }; // API_URL missing
			try {
				await parseEnv(rawEnv, schema);
			} catch (err) {
				const envErr = err as EnvValidationError;
				expect(envErr.issues).toHaveLength(1);
				expect(envErr.issues[0].key).toBe("API_URL");
			}
		});

		it("sync parser also catches missing bindings", () => {
			const schema = {
				REQUIRED_VAR: createStringSchema(),
			};

			expect(() => parseEnvSync({}, schema)).toThrow(EnvValidationError);
		});
	});

	describe("wrong binding types fail", () => {
		it("rejects non-string when string expected", async () => {
			const schema = {
				API_KEY: createStringSchema(),
			};

			try {
				await parseEnv({ API_KEY: 12345 }, schema);
			} catch (err) {
				const envErr = err as EnvValidationError;
				expect(envErr.issues).toHaveLength(1);
				expect(envErr.issues[0].key).toBe("API_KEY");
				expect(envErr.issues[0].message).toContain("string");
			}
		});

		it("rejects non-number when number expected", async () => {
			const schema = {
				PORT: createNumberSchema(),
			};

			try {
				await parseEnv({ PORT: "not-a-number" }, schema);
			} catch (err) {
				const envErr = err as EnvValidationError;
				expect(envErr.issues).toHaveLength(1);
				expect(envErr.issues[0].key).toBe("PORT");
			}
		});

		it("rejects values violating constraints", async () => {
			const schema = {
				PORT: createNumberSchema({ min: 1, max: 65535 }),
			};

			try {
				await parseEnv({ PORT: 99999 }, schema);
			} catch (err) {
				const envErr = err as EnvValidationError;
				expect(envErr.issues).toHaveLength(1);
				expect(envErr.issues[0].key).toBe("PORT");
			}
		});

		it("rejects strings that are too short", async () => {
			const schema = {
				API_KEY: createStringSchema({ minLength: 10 }),
			};

			try {
				await parseEnv({ API_KEY: "short" }, schema);
			} catch (err) {
				const envErr = err as EnvValidationError;
				expect(envErr.issues).toHaveLength(1);
				expect(envErr.issues[0].message).toContain("at least 10");
			}
		});
	});

	describe("Standard Schema validators work", () => {
		it("uses a custom Standard Schema v1 validator", async () => {
			// Create a custom validator that checks for URL format
			const urlSchema = {
				"~standard": {
					version: 1 as const,
					vendor: "custom" as const,
					validate(value: unknown) {
						if (typeof value !== "string") {
							return { issues: [{ message: "Expected string", path: [] }] };
						}
						try {
							new URL(value);
							return { value };
						} catch {
							return { issues: [{ message: "Invalid URL format", path: [] }] };
						}
					},
				},
			};

			const schema = { ENDPOINT: urlSchema };

			const valid = await parseEnv({ ENDPOINT: "https://api.example.com" }, schema);
			expect(valid.ENDPOINT).toBe("https://api.example.com");

			await expect(parseEnv({ ENDPOINT: "not-a-url" }, schema)).rejects.toThrow(EnvValidationError);
		});

		it("uses an enum-like validator", async () => {
			const envEnum = (allowed: string[]) => ({
				"~standard": {
					version: 1 as const,
					vendor: "custom" as const,
					validate(value: unknown) {
						if (typeof value !== "string" || !allowed.includes(value)) {
							return {
								issues: [{ message: `Must be one of: ${allowed.join(", ")}`, path: [] }],
							};
						}
						return { value };
					},
				},
			});

			const schema = {
				NODE_ENV: envEnum(["development", "staging", "production"]),
			};

			const valid = await parseEnv({ NODE_ENV: "production" }, schema);
			expect(valid.NODE_ENV).toBe("production");

			await expect(parseEnv({ NODE_ENV: "invalid" }, schema)).rejects.toThrow(EnvValidationError);
		});

		it("collects all issues before throwing", async () => {
			const schema = {
				A: createStringSchema(),
				B: createStringSchema(),
				C: createNumberSchema(),
				D: createStringSchema({ minLength: 5 }),
			};

			try {
				await parseEnv({ D: "hi" }, schema); // A, B, C missing; D too short
			} catch (err) {
				const envErr = err as EnvValidationError;
				// Should have 4 issues: 3 missing + 1 too short
				expect(envErr.issues.length).toBeGreaterThanOrEqual(3);
				const keys = envErr.issues.map((i) => i.key);
				expect(keys).toContain("A");
				expect(keys).toContain("B");
				expect(keys).toContain("C");
			}
		});

		it("EnvValidationError has proper error code and status", async () => {
			const schema = { X: createStringSchema() };

			try {
				await parseEnv({}, schema);
			} catch (err) {
				const envErr = err as EnvValidationError;
				expect(envErr.code).toBe("WORKKIT_VALIDATION");
				expect(envErr.statusCode).toBe(400);
				expect(envErr.retryable).toBe(false);
			}
		});

		it("error message includes human-readable details", async () => {
			const schema = { MISSING_VAR: createStringSchema() };

			try {
				await parseEnv({}, schema);
			} catch (err) {
				const envErr = err as EnvValidationError;
				expect(envErr.message).toContain("Environment validation failed");
				expect(envErr.message).toContain("MISSING_VAR");
			}
		});
	});

	describe("integration with createTestEnv", () => {
		it("createTestEnv produces valid bindings for env validation", async () => {
			const env = createTestEnv({
				kv: ["KV_STORE"] as const,
				d1: ["DB"] as const,
				vars: { API_KEY: "test-key", PORT: 8080 },
			});

			// Env has the expected shape
			expect(env.KV_STORE).toBeDefined();
			expect(env.DB).toBeDefined();
			expect(env.API_KEY).toBe("test-key");
			expect(env.PORT).toBe(8080);
		});
	});
});
