import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function readPkg(relPath: string) {
	const full = path.resolve(ROOT, relPath, "package.json");
	return JSON.parse(readFileSync(full, "utf-8"));
}

function allPublishablePackages(): { name: string; relPath: string }[] {
	const results: { name: string; relPath: string }[] = [];
	for (const base of ["packages", "integrations"]) {
		const baseDir = path.resolve(ROOT, base);
		if (!existsSync(baseDir)) continue;
		for (const dir of readdirSync(baseDir, { withFileTypes: true })) {
			if (!dir.isDirectory()) continue;
			const pkgPath = path.resolve(baseDir, dir.name, "package.json");
			if (!existsSync(pkgPath)) continue;
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			if (pkg.private) continue;
			results.push({ name: pkg.name, relPath: `${base}/${dir.name}` });
		}
	}
	return results;
}

describe("P0 dependency audit", () => {
	describe("unlisted dependencies are declared", () => {
		it("@workkit/astro has @standard-schema/spec in devDependencies", () => {
			const pkg = readPkg("integrations/astro");
			expect(pkg.devDependencies).toHaveProperty("@standard-schema/spec");
		});

		it("@workkit/hono has zod in devDependencies", () => {
			const pkg = readPkg("integrations/hono");
			expect(pkg.devDependencies).toHaveProperty("zod");
		});
	});

	describe("unused runtime dependencies are removed", () => {
		it("@workkit/cache has no @workkit/types or @workkit/errors in dependencies", () => {
			const pkg = readPkg("packages/cache");
			expect(pkg.dependencies ?? {}).not.toHaveProperty("@workkit/types");
			expect(pkg.dependencies ?? {}).not.toHaveProperty("@workkit/errors");
		});

		it("@workkit/crypto has no @workkit/types or @workkit/errors in dependencies", () => {
			const pkg = readPkg("packages/crypto");
			expect(pkg.dependencies ?? {}).not.toHaveProperty("@workkit/types");
			expect(pkg.dependencies ?? {}).not.toHaveProperty("@workkit/errors");
		});
	});

	describe("CLI bundles @workkit/* deps (not runtime)", () => {
		const bundledDeps = ["@workkit/types", "@workkit/errors", "@workkit/env", "@workkit/d1"];

		for (const dep of bundledDeps) {
			it(`workkit CLI does not ship ${dep} as a runtime dependency`, () => {
				const pkg = readPkg("packages/cli");
				expect(pkg.dependencies ?? {}).not.toHaveProperty(dep);
			});
		}
	});

	describe("workspace:* deps are guarded by resolve script", () => {
		it("resolve-workspace-deps.js exists", () => {
			expect(existsSync(path.resolve(ROOT, "scripts/resolve-workspace-deps.js"))).toBe(true);
		});

		it("release script runs resolve before publish and restores after", () => {
			const rootPkg = JSON.parse(readFileSync(path.resolve(ROOT, "package.json"), "utf-8"));
			const release = rootPkg.scripts.release;
			expect(release).toContain("resolve-workspace-deps.js");
			expect(release).toContain("changeset publish");
			expect(release).toContain("--restore");
			// Resolve must come BEFORE publish
			const resolveIdx = release.indexOf("resolve-workspace-deps.js");
			const publishIdx = release.indexOf("changeset publish");
			const restoreIdx = release.lastIndexOf("resolve-workspace-deps.js");
			expect(resolveIdx).toBeLessThan(publishIdx);
			expect(publishIdx).toBeLessThan(restoreIdx);
		});

		it("all workspace:* deps reference packages that exist in the monorepo", () => {
			const packages = allPublishablePackages();
			const knownPackages = new Set(packages.map((p) => readPkg(p.relPath).name));

			for (const { name, relPath } of packages) {
				const pkg = readPkg(relPath);
				const allDeps = {
					...(pkg.dependencies ?? {}),
					...(pkg.peerDependencies ?? {}),
				};
				for (const [dep, version] of Object.entries(allDeps)) {
					if ((version as string).startsWith("workspace:")) {
						expect(
							knownPackages.has(dep),
							`${name} has ${dep}: "${version}" but ${dep} is not a package in this monorepo. The resolve script won't be able to replace this with a real version.`,
						).toBe(true);
					}
				}
			}
		});

		it("no non-@workkit workspace:* deps exist (external packages can't use workspace:*)", () => {
			const packages = allPublishablePackages();
			for (const { name, relPath } of packages) {
				const pkg = readPkg(relPath);
				const allDeps = {
					...(pkg.dependencies ?? {}),
					...(pkg.peerDependencies ?? {}),
				};
				for (const [dep, version] of Object.entries(allDeps)) {
					if ((version as string).startsWith("workspace:") && !dep.startsWith("@workkit/")) {
						expect.unreachable(
							`${name} has non-workkit workspace dep: ${dep}: "${version}". Only @workkit/* packages can use workspace:* protocol.`,
						);
					}
				}
			}
		});
	});

	describe("@standard-schema/spec in remix", () => {
		const pkg = readPkg("integrations/remix");

		it("is in peerDependencies", () => {
			expect(pkg.peerDependencies).toHaveProperty("@standard-schema/spec");
		});

		it("is not in runtime dependencies", () => {
			expect(pkg.dependencies ?? {}).not.toHaveProperty("@standard-schema/spec");
		});
	});
});
