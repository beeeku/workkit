import { describe, expect, it } from "vitest";
import {
	executeCheck,
	extractBindingsFromSource,
	extractBindingsFromWrangler,
	validateBindings,
} from "../src/commands/check";
import { createMockFs } from "./helpers";

describe("check command", () => {
	describe("extractBindingsFromSource", () => {
		it("extracts bindings from Env interface", () => {
			const source = `
        interface Env {
          DB: D1Database
          KV: KVNamespace
          BUCKET: R2Bucket
        }
      `;
			const bindings = extractBindingsFromSource(source);
			expect(bindings.size).toBe(3);
			expect(bindings.get("DB")).toBe("D1Database");
			expect(bindings.get("KV")).toBe("KVNamespace");
			expect(bindings.get("BUCKET")).toBe("R2Bucket");
		});

		it("returns empty map when no Env interface", () => {
			const source = "const x = 1;";
			expect(extractBindingsFromSource(source).size).toBe(0);
		});

		it("handles empty Env interface", () => {
			const source = "interface Env {}";
			expect(extractBindingsFromSource(source).size).toBe(0);
		});

		it("handles single binding", () => {
			const source = "interface Env { DB: D1Database }";
			const bindings = extractBindingsFromSource(source);
			expect(bindings.size).toBe(1);
			expect(bindings.get("DB")).toBe("D1Database");
		});
	});

	describe("extractBindingsFromWrangler", () => {
		it("extracts bindings from sections", () => {
			const toml = `
[[d1_databases]]
binding = "DB"
database_name = "my-db"

[[kv_namespaces]]
binding = "KV"
id = "abc123"
`;
			const bindings = extractBindingsFromWrangler(toml);
			expect(bindings.size).toBe(2);
			expect(bindings.get("DB")).toBe("d1_databases");
			expect(bindings.get("KV")).toBe("kv_namespaces");
		});

		it("returns empty map for empty toml", () => {
			expect(extractBindingsFromWrangler("").size).toBe(0);
		});

		it("handles multiple bindings in same section type", () => {
			const toml = `
[[kv_namespaces]]
binding = "KV1"
id = "abc"

[[kv_namespaces]]
binding = "KV2"
id = "def"
`;
			const bindings = extractBindingsFromWrangler(toml);
			expect(bindings.size).toBe(2);
			expect(bindings.get("KV1")).toBe("kv_namespaces");
			expect(bindings.get("KV2")).toBe("kv_namespaces");
		});
	});

	describe("validateBindings", () => {
		it("returns valid when all bindings match", () => {
			const source = new Map([["DB", "D1Database"]]);
			const wrangler = new Map([["DB", "d1_databases"]]);
			const result = validateBindings(source, wrangler);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it("reports error for missing binding in wrangler", () => {
			const source = new Map([["DB", "D1Database"]]);
			const wrangler = new Map<string, string>();
			const result = validateBindings(source, wrangler);
			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]!.binding).toBe("DB");
		});

		it("reports warning for unused wrangler binding", () => {
			const source = new Map<string, string>();
			const wrangler = new Map([["DB", "d1_databases"]]);
			const result = validateBindings(source, wrangler);
			expect(result.valid).toBe(true);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]!.binding).toBe("DB");
		});

		it("reports type mismatch error", () => {
			const source = new Map([["DB", "D1Database"]]);
			const wrangler = new Map([["DB", "kv_namespaces"]]);
			const result = validateBindings(source, wrangler);
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain("Type mismatch");
		});

		it("handles empty inputs", () => {
			const result = validateBindings(new Map(), new Map());
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.warnings).toHaveLength(0);
		});
	});

	describe("executeCheck", () => {
		it("returns error when wrangler.toml is missing", async () => {
			const fs = createMockFs({ "/app/src/index.ts": "interface Env {}" });
			const result = await executeCheck("/app", fs);
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain("wrangler.toml not found");
		});

		it("returns error when src/index.ts is missing", async () => {
			const fs = createMockFs({ "/app/wrangler.toml": 'name = "test"' });
			const result = await executeCheck("/app", fs);
			expect(result.valid).toBe(false);
			expect(result.errors[0]!.message).toContain("src/index.ts not found");
		});

		it("validates matching bindings", async () => {
			const fs = createMockFs({
				"/app/wrangler.toml": `
[[d1_databases]]
binding = "DB"
database_name = "test"
`,
				"/app/src/index.ts": "interface Env { DB: D1Database }",
			});
			const result = await executeCheck("/app", fs);
			expect(result.valid).toBe(true);
		});
	});
});
