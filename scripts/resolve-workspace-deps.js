#!/usr/bin/env node

/**
 * Resolves workspace:* dependencies to actual package versions before publishing.
 *
 * Bun uses workspace:* protocol for monorepo dependencies, but npm can't resolve
 * this protocol. Changesets should handle this but doesn't for Bun workspaces.
 *
 * Usage: node scripts/resolve-workspace-deps.js
 * Restore: node scripts/resolve-workspace-deps.js --restore
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BACKUP_SUFFIX = ".workspace-backup";

function findDirs(base) {
	if (!existsSync(base)) return [];
	return readdirSync(base, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => join(base, d.name))
		.filter((d) => existsSync(join(d, "package.json")));
}

const packageDirs = [...findDirs(join(ROOT, "packages")), ...findDirs(join(ROOT, "integrations"))];

function buildVersionMap() {
	const versions = new Map();
	for (const dir of packageDirs) {
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
		versions.set(pkg.name, pkg.version);
	}
	return versions;
}

function resolveWorkspaceDeps(deps, versions) {
	if (!deps) return [deps, false];
	let changed = false;
	const resolved = { ...deps };
	for (const [name, version] of Object.entries(resolved)) {
		if (version === "workspace:*" || version.startsWith("workspace:")) {
			const actualVersion = versions.get(name);
			if (actualVersion) {
				resolved[name] = `^${actualVersion}`;
				changed = true;
			} else {
				console.warn(`  ⚠ ${name}: workspace:* but package not found in monorepo`);
			}
		}
	}
	return [resolved, changed];
}

const restore = process.argv.includes("--restore");

if (restore) {
	console.log("Restoring workspace:* dependencies...\n");
	for (const dir of packageDirs) {
		const backupPath = join(dir, `package.json${BACKUP_SUFFIX}`);
		const pkgPath = join(dir, "package.json");
		if (existsSync(backupPath)) {
			writeFileSync(pkgPath, readFileSync(backupPath, "utf-8"));
			unlinkSync(backupPath);
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			console.log(`  ✓ Restored ${pkg.name}`);
		}
	}
	console.log("\nDone.");
} else {
	console.log("Resolving workspace:* dependencies...\n");
	const versions = buildVersionMap();

	let totalFixed = 0;
	for (const dir of packageDirs) {
		const pkgPath = join(dir, "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

		const [resolvedDeps, depsChanged] = resolveWorkspaceDeps(pkg.dependencies, versions);
		const [resolvedPeerDeps, peerChanged] = resolveWorkspaceDeps(
			pkg.peerDependencies,
			versions,
		);

		if (depsChanged || peerChanged) {
			writeFileSync(join(dir, `package.json${BACKUP_SUFFIX}`), readFileSync(pkgPath, "utf-8"));

			if (depsChanged) pkg.dependencies = resolvedDeps;
			if (peerChanged) pkg.peerDependencies = resolvedPeerDeps;

			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

			const depNames = [
				...(depsChanged
					? Object.keys(resolvedDeps).filter((k) => k.startsWith("@workkit/"))
					: []),
				...(peerChanged
					? Object.keys(resolvedPeerDeps).filter((k) => k.startsWith("@workkit/"))
					: []),
			];
			console.log(`  ✓ ${pkg.name}: ${depNames.join(", ")}`);
			totalFixed++;
		}
	}

	console.log(`\n${totalFixed} packages updated. Run --restore after publishing to undo.`);
}
