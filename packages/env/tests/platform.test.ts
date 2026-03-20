import { describe, expect, it } from "vitest";
import { detectPlatform, resolveEnv } from "../src/platform";

describe("detectPlatform", () => {
	it("detects current runtime", () => {
		// vitest runs under Node even when using bun as package manager
		const platform = detectPlatform();
		expect(["node", "bun"]).toContain(platform);
	});
});

describe("resolveEnv", () => {
	it("returns explicit env when provided", () => {
		const env = { API_KEY: "test" };
		expect(resolveEnv(env)).toBe(env);
	});

	it("returns process.env when no explicit env on node/bun", () => {
		const env = resolveEnv();
		expect(env).toBeDefined();
		// Should be process.env
		expect(typeof env).toBe("object");
	});

	it("prefers explicit env over process.env", () => {
		const explicit = { CUSTOM: "value" };
		const result = resolveEnv(explicit);
		expect(result).toBe(explicit);
		expect(result.CUSTOM).toBe("value");
	});
});
