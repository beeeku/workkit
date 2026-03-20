import { type } from "arktype";
import { describe, expect, it } from "vitest";
import { EnvValidationError } from "../../src/errors";
import { parseEnvSync } from "../../src/parse";
import { d1 } from "../../src/validators/d1";

describe("parseEnvSync with ArkType", () => {
	it("validates string values", () => {
		const schema = { API_KEY: type("string") };
		const env = parseEnvSync({ API_KEY: "sk-123" }, schema);
		expect(env.API_KEY).toBe("sk-123");
	});

	it("rejects invalid values", () => {
		const schema = { API_KEY: type("string") };
		expect(() => parseEnvSync({ API_KEY: 123 }, schema)).toThrow(EnvValidationError);
	});

	it("validates numbers", () => {
		const schema = { PORT: type("number") };
		const env = parseEnvSync({ PORT: 3000 }, schema);
		expect(env.PORT).toBe(3000);
	});

	it("validates booleans", () => {
		const schema = { DEBUG: type("boolean") };
		const env = parseEnvSync({ DEBUG: true }, schema);
		expect(env.DEBUG).toBe(true);
	});

	it("mixes ArkType with workkit binding validators", () => {
		const mockD1 = { prepare: () => {}, batch: async () => [], exec: async () => ({}) };
		const schema = {
			API_KEY: type("string"),
			DB: d1(),
		};
		const env = parseEnvSync({ API_KEY: "test", DB: mockD1 }, schema);
		expect(env.API_KEY).toBe("test");
		expect(env.DB).toBe(mockD1);
	});
});
