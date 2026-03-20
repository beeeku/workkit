import { describe, expect, it } from "vitest";
import {
	VALID_FEATURES,
	VALID_TEMPLATES,
	buildPackageJson,
	buildTsconfig,
	buildVitestConfig,
	buildWranglerToml,
	executeInit,
	generateProjectFiles,
	parseFeatures,
	resolveProjectName,
} from "../src/commands/init";
import { createMockFs } from "./helpers";

describe("init command", () => {
	describe("resolveProjectName", () => {
		it("uses options.name when provided", () => {
			expect(resolveProjectName({ name: "my-api" }, "/some/dir")).toBe("my-api");
		});

		it("falls back to directory name", () => {
			expect(resolveProjectName({}, "/home/user/my-worker")).toBe("my-worker");
		});

		it("handles root directory", () => {
			expect(resolveProjectName({}, "/")).toBe("my-worker");
		});
	});

	describe("buildPackageJson", () => {
		it("includes project name", () => {
			const pkg = JSON.parse(buildPackageJson("test-worker", []));
			expect(pkg.name).toBe("test-worker");
		});

		it("always includes @workkit/types and @workkit/errors", () => {
			const pkg = JSON.parse(buildPackageJson("test", []));
			expect(pkg.dependencies["@workkit/types"]).toBe("latest");
			expect(pkg.dependencies["@workkit/errors"]).toBe("latest");
		});

		it("adds feature packages as dependencies", () => {
			const pkg = JSON.parse(buildPackageJson("test", ["env", "d1"]));
			expect(pkg.dependencies["@workkit/env"]).toBe("latest");
			expect(pkg.dependencies["@workkit/d1"]).toBe("latest");
		});

		it("includes standard dev dependencies", () => {
			const pkg = JSON.parse(buildPackageJson("test", []));
			expect(pkg.devDependencies.wrangler).toBeDefined();
			expect(pkg.devDependencies.typescript).toBeDefined();
			expect(pkg.devDependencies.vitest).toBeDefined();
		});

		it("includes standard scripts", () => {
			const pkg = JSON.parse(buildPackageJson("test", []));
			expect(pkg.scripts.dev).toBe("wrangler dev");
			expect(pkg.scripts.deploy).toBe("wrangler deploy");
			expect(pkg.scripts.test).toBe("vitest run");
		});

		it("sets type to module", () => {
			const pkg = JSON.parse(buildPackageJson("test", []));
			expect(pkg.type).toBe("module");
		});
	});

	describe("buildWranglerToml", () => {
		it("includes project name and main", () => {
			const toml = buildWranglerToml("my-worker", []);
			expect(toml).toContain('name = "my-worker"');
			expect(toml).toContain('main = "src/index.ts"');
		});

		it("includes compatibility_date", () => {
			const toml = buildWranglerToml("test", []);
			expect(toml).toMatch(/compatibility_date = "\d{4}-\d{2}-\d{2}"/);
		});

		it("adds d1 bindings when feature included", () => {
			const toml = buildWranglerToml("test", ["d1"]);
			expect(toml).toContain("[[d1_databases]]");
			expect(toml).toContain('binding = "DB"');
		});

		it("adds kv bindings when feature included", () => {
			const toml = buildWranglerToml("test", ["kv"]);
			expect(toml).toContain("[[kv_namespaces]]");
			expect(toml).toContain('binding = "KV"');
		});

		it("adds r2 bindings when feature included", () => {
			const toml = buildWranglerToml("test", ["r2"]);
			expect(toml).toContain("[[r2_buckets]]");
			expect(toml).toContain('binding = "BUCKET"');
		});

		it("adds queue bindings when feature included", () => {
			const toml = buildWranglerToml("test", ["queue"]);
			expect(toml).toContain("[[queues.producers]]");
			expect(toml).toContain('binding = "QUEUE"');
		});

		it("skips optional sections when not included", () => {
			const toml = buildWranglerToml("test", []);
			expect(toml).not.toContain("[[d1_databases]]");
			expect(toml).not.toContain("[[kv_namespaces]]");
		});
	});

	describe("buildTsconfig", () => {
		it("produces valid JSON", () => {
			const config = JSON.parse(buildTsconfig());
			expect(config.compilerOptions.strict).toBe(true);
			expect(config.compilerOptions.target).toBe("ES2022");
		});

		it("includes workers types", () => {
			const config = JSON.parse(buildTsconfig());
			expect(config.compilerOptions.types).toContain("@cloudflare/workers-types");
		});
	});

	describe("buildVitestConfig", () => {
		it("returns valid config string", () => {
			const config = buildVitestConfig();
			expect(config).toContain("defineConfig");
			expect(config).toContain("tests/**/*.test.ts");
		});
	});

	describe("generateProjectFiles", () => {
		it("generates basic template files", () => {
			const files = generateProjectFiles("test", "basic", ["env"]);
			const paths = files.map((f) => f.path);
			expect(paths).toContain("package.json");
			expect(paths).toContain("wrangler.toml");
			expect(paths).toContain("tsconfig.json");
			expect(paths).toContain("vitest.config.ts");
			expect(paths).toContain("src/index.ts");
		});

		it("generates hono template files", () => {
			const files = generateProjectFiles("test", "hono", ["env"]);
			const indexFile = files.find((f) => f.path === "src/index.ts");
			expect(indexFile?.content).toContain("Hono");
		});

		it("generates api template files", () => {
			const files = generateProjectFiles("test", "api", ["env"]);
			const paths = files.map((f) => f.path);
			expect(paths).toContain("src/router.ts");
			expect(paths).toContain("src/handlers.ts");
		});
	});

	describe("parseFeatures", () => {
		it("parses comma-separated features", () => {
			expect(parseFeatures("env,d1,kv")).toEqual(["env", "d1", "kv"]);
		});

		it("trims whitespace", () => {
			expect(parseFeatures(" env , d1 ")).toEqual(["env", "d1"]);
		});

		it("filters out invalid features", () => {
			expect(parseFeatures("env,invalid")).toEqual(["env"]);
		});

		it("handles single feature", () => {
			expect(parseFeatures("env")).toEqual(["env"]);
		});

		it("handles empty string", () => {
			expect(parseFeatures("")).toEqual([]);
		});
	});

	describe("executeInit", () => {
		it("writes all project files", async () => {
			const fs = createMockFs();
			const files = await executeInit(
				{ name: "test-project", template: "basic", features: ["env"], dir: "/tmp/test" },
				fs,
			);
			expect(files.length).toBeGreaterThanOrEqual(5);
			expect(fs.files.has("/tmp/test/package.json")).toBe(true);
			expect(fs.files.has("/tmp/test/wrangler.toml")).toBe(true);
		});

		it("throws for invalid template", async () => {
			const fs = createMockFs();
			await expect(
				executeInit({ template: "invalid" as any, dir: "/tmp/test" }, fs),
			).rejects.toThrow("Unknown template");
		});

		it("defaults to basic template and env feature", async () => {
			const fs = createMockFs();
			const files = await executeInit({ dir: "/tmp/test" }, fs);
			const indexFile = files.find((f) => f.path === "src/index.ts");
			expect(indexFile?.content).toContain("workkit");
		});
	});

	describe("constants", () => {
		it("VALID_TEMPLATES contains expected templates", () => {
			expect(VALID_TEMPLATES).toContain("basic");
			expect(VALID_TEMPLATES).toContain("hono");
			expect(VALID_TEMPLATES).toContain("api");
		});

		it("VALID_FEATURES contains expected features", () => {
			expect(VALID_FEATURES).toContain("env");
			expect(VALID_FEATURES).toContain("d1");
			expect(VALID_FEATURES).toContain("kv");
			expect(VALID_FEATURES).toContain("r2");
		});
	});
});
