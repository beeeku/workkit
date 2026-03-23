import { describe, expect, it } from "vitest";
import { detectInstalledPackages, resolvePackageNames } from "../src/commands/add";

describe("add command", () => {
	describe("resolvePackageNames", () => {
		it("resolves short names to full package names", () => {
			expect(resolvePackageNames(["kv", "d1"])).toEqual(["@workkit/kv", "@workkit/d1"]);
		});

		it("passes through full package names", () => {
			expect(resolvePackageNames(["@workkit/kv"])).toEqual(["@workkit/kv"]);
		});

		it("handles mixed short and full names", () => {
			expect(resolvePackageNames(["kv", "@workkit/d1"])).toEqual(["@workkit/kv", "@workkit/d1"]);
		});
	});

	describe("detectInstalledPackages", () => {
		it("returns empty set when no workkit packages", () => {
			const pkg = { dependencies: { hono: "^4.0.0" } };
			expect(detectInstalledPackages(pkg)).toEqual(new Set());
		});

		it("detects installed @workkit packages", () => {
			const pkg = {
				dependencies: {
					"@workkit/kv": "^0.1.0",
					"@workkit/d1": "^0.1.0",
					hono: "^4.0.0",
				},
			};
			expect(detectInstalledPackages(pkg)).toEqual(new Set(["@workkit/kv", "@workkit/d1"]));
		});

		it("checks both dependencies and devDependencies", () => {
			const pkg = {
				dependencies: { "@workkit/kv": "^0.1.0" },
				devDependencies: { "@workkit/testing": "^0.1.0" },
			};
			const result = detectInstalledPackages(pkg);
			expect(result.has("@workkit/kv")).toBe(true);
			expect(result.has("@workkit/testing")).toBe(true);
		});
	});
});
