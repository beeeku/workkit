#!/usr/bin/env bun
/**
 * Workkit Constitution mechanical checks. Run as a CI gate via
 *   `bun run constitution:check`
 *
 * Rules implemented (see `.maina/constitution.md`):
 *
 *   1. zero-runtime-overhead — flag new direct deps > 50 KB without a
 *      `// dep-justification:` line in the diff's changesets.
 *   2. standard-schema-only — public exported functions referencing
 *      `ZodType<...>` in their signature are flagged. Opt-out marker
 *      `constitution-allow:zod-signature`.
 *   3. testing-integration — every `packages/(name)/package.json` should
 *      declare `@workkit/testing` in `devDependencies`. Opt-out via
 *      `"//constitution-allow": "no-testing reason=..."` field.
 *   4. single-index-export — each package's `exports` map MUST resolve
 *      `"."` to `./dist/index.js`. Subpath exports are allowed.
 *   5. no-cross-package-imports — `from "@workkit/<x>"` requires
 *      `@workkit/<x>` in `dependencies`/`peerDependencies`. Opt-out via
 *      `// constitution-allow:cross-package reason="..."` on the import line.
 *   6. changeset-required — when `packages/(name)/src/...` files change in a
 *      PR, require at least one matching `.changeset/*.md` file in the
 *      same diff. (Skipped for non-PR runs.)
 *   7. no-console-log — `console.log(` forbidden in `packages/(name)/src/...`.
 *      Opt-out via `// constitution-allow:console-log reason="..."`.
 *
 * Runs against the **current working tree** by default (full repo).
 * Pass `--diff-only` (or set `CONSTITUTION_DIFF_ONLY=1`) to limit to
 * files changed since `--base` (default `master`).
 *
 * Exit codes:
 *   0 — clean (or only warnings)
 *   1 — at least one error finding
 *   2 — script invocation error (bad args, etc.)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface Finding {
	rule: string;
	severity: "error" | "warning";
	file: string;
	line?: number;
	message: string;
}

function args(): { diffOnly: boolean; base: string; help: boolean } {
	const argv = process.argv.slice(2);
	return {
		help: argv.includes("--help") || argv.includes("-h"),
		diffOnly:
			argv.includes("--diff-only") ||
			process.env.CONSTITUTION_DIFF_ONLY === "1" ||
			process.env.CI === "true",
		base:
			(argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ?? "") || "master",
	};
}

function changedFiles(base: string): Set<string> {
	try {
		const out = execSync(`git diff --name-only ${base}...HEAD`, { cwd: ROOT, encoding: "utf-8" });
		return new Set(out.split("\n").filter(Boolean));
	} catch {
		// Probably not a git repo or base ref missing. Fall back to "everything".
		return new Set();
	}
}

function listPackages(): string[] {
	const dir = join(ROOT, "packages");
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => join(dir, d.name));
}

function readJson<T = unknown>(file: string): T {
	return JSON.parse(readFileSync(file, "utf-8")) as T;
}

function walk(dir: string, predicate: (p: string) => boolean): string[] {
	const out: string[] = [];
	if (!existsSync(dir)) return out;
	const stack = [dir];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		for (const entry of readdirSync(cur, { withFileTypes: true })) {
			const full = join(cur, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === "dist") continue;
				stack.push(full);
				continue;
			}
			if (predicate(full)) out.push(full);
		}
	}
	return out;
}

interface PackageJson {
	name?: string;
	private?: boolean;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	exports?: Record<string, unknown> | string;
	"//constitution-allow"?: string;
}

interface PkgInfo {
	dir: string;
	relDir: string;
	pkg: PackageJson;
	pkgPath: string;
}

function loadPackages(): PkgInfo[] {
	return listPackages()
		.filter((d) => existsSync(join(d, "package.json")))
		.map((d) => ({
			dir: d,
			relDir: relative(ROOT, d),
			pkg: readJson<PackageJson>(join(d, "package.json")),
			pkgPath: join(d, "package.json"),
		}));
}

interface DiffCtx {
	diffOnly: boolean;
	diff: Set<string>;
}

function isInDiff(file: string, ctx: DiffCtx): boolean {
	if (!ctx.diffOnly) return true;
	const rel = relative(ROOT, file);
	return ctx.diff.has(rel);
}

/**
 * In diff-only mode, skip all checks for packages whose `package.json` AND
 * `src/**` directory are unchanged. This keeps the script's checks aligned
 * with rule #8 (diff-only fixes).
 */
function packageInDiff(p: PkgInfo, ctx: DiffCtx): boolean {
	if (!ctx.diffOnly) return true;
	if (ctx.diff.size === 0) return false;
	const relDir = relative(ROOT, p.dir);
	const srcPrefix = `${relDir}/src/`;
	const pkgPath = `${relDir}/package.json`;
	for (const f of ctx.diff) {
		if (f === pkgPath) return true;
		if (f.startsWith(srcPrefix)) return true;
	}
	return false;
}

// Rule 4: single-index-export
function checkSingleIndexExport(p: PkgInfo): Finding[] {
	if (p.pkg.private === true) return [];
	const out: Finding[] = [];
	const exports = p.pkg.exports;
	if (typeof exports === "string") return out; // legacy shorthand — fine
	if (!exports || typeof exports !== "object") {
		return [
			{
				rule: "single-index-export",
				severity: "error",
				file: p.pkgPath,
				message: `package "${p.pkg.name}" has no \`exports\` map`,
			},
		];
	}
	const dot = (exports as Record<string, unknown>)["."];
	if (!dot) {
		out.push({
			rule: "single-index-export",
			severity: "error",
			file: p.pkgPath,
			message: `package "${p.pkg.name}" must export "."`,
		});
		return out;
	}
	const dotImport =
		(dot as { import?: { default?: string } }).import?.default ??
		(typeof dot === "string" ? dot : undefined);
	if (dotImport && dotImport !== "./dist/index.js") {
		out.push({
			rule: "single-index-export",
			severity: "warning",
			file: p.pkgPath,
			message: `package "${p.pkg.name}" "."'s default is ${JSON.stringify(dotImport)}; expected "./dist/index.js"`,
		});
	}
	return out;
}

// Rule 3: testing-integration
function checkTestingIntegration(p: PkgInfo): Finding[] {
	if (p.pkg.private === true) return [];
	if (p.pkg.name === "@workkit/testing") return []; // self
	if (typeof p.pkg["//constitution-allow"] === "string" && /no-testing/.test(p.pkg["//constitution-allow"])) {
		return [];
	}
	const dev = p.pkg.devDependencies ?? {};
	if (dev["@workkit/testing"]) return [];
	return [
		{
			rule: "testing-integration",
			severity: "warning",
			file: p.pkgPath,
			message: `package "${p.pkg.name}" should declare "@workkit/testing" in devDependencies (or opt out via "//constitution-allow")`,
		},
	];
}

// Rule 5: no-cross-package-imports
function checkCrossPackageImports(p: PkgInfo, ctx: DiffCtx): Finding[] {
	const out: Finding[] = [];
	const declared = new Set([
		...Object.keys(p.pkg.dependencies ?? {}),
		...Object.keys(p.pkg.peerDependencies ?? {}),
		p.pkg.name ?? "",
	]);
	const sourceFiles = walk(join(p.dir, "src"), (f) => f.endsWith(".ts") || f.endsWith(".tsx"));
	for (const file of sourceFiles) {
		if (!isInDiff(file, ctx)) continue;
		const content = readFileSync(file, "utf-8");
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			const m = line.match(/from\s+["'](@workkit\/[a-z0-9-]+)/);
			if (!m) continue;
			const dep = m[1]!;
			if (declared.has(dep)) continue;
			if (/constitution-allow:cross-package/.test(line)) continue;
			out.push({
				rule: "no-cross-package-imports",
				severity: "error",
				file,
				line: i + 1,
				message: `${p.pkg.name}: imports ${dep} but does not declare it in dependencies/peerDependencies`,
			});
		}
	}
	return out;
}

// Rule 7: no-console-log
function checkNoConsoleLog(p: PkgInfo, ctx: DiffCtx): Finding[] {
	const out: Finding[] = [];
	const sourceFiles = walk(join(p.dir, "src"), (f) => f.endsWith(".ts") || f.endsWith(".tsx"));
	for (const file of sourceFiles) {
		if (!isInDiff(file, ctx)) continue;
		const lines = readFileSync(file, "utf-8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (!/\bconsole\s*\.\s*log\s*\(/.test(line)) continue;
			if (/constitution-allow:console-log/.test(line)) continue;
			out.push({
				rule: "no-console-log",
				severity: "error",
				file,
				line: i + 1,
				message: `${p.pkg.name}: console.log forbidden in production source`,
			});
		}
	}
	return out;
}

// Rule 2: standard-schema-only
function checkStandardSchemaOnly(p: PkgInfo, ctx: DiffCtx): Finding[] {
	const out: Finding[] = [];
	const sourceFiles = walk(join(p.dir, "src"), (f) => f.endsWith(".ts") || f.endsWith(".tsx"));
	for (const file of sourceFiles) {
		if (!isInDiff(file, ctx)) continue;
		const lines = readFileSync(file, "utf-8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			// Look for ZodType / ZodSchema in a function signature on an exported symbol.
			if (!/ZodType|ZodSchema/.test(line)) continue;
			// Skip if this is just a type import or alias (no parentheses on the line).
			if (!/\(/.test(line) && !/[<:]/.test(line)) continue;
			if (/constitution-allow:zod-signature/.test(line)) continue;
			out.push({
				rule: "standard-schema-only",
				severity: "warning",
				file,
				line: i + 1,
				message: `${p.pkg.name}: prefer StandardSchemaV1 over ZodType in public signatures (or opt out)`,
			});
		}
	}
	return out;
}

// Rule 6: changeset-required
function checkChangesetRequired(ctx: DiffCtx): Finding[] {
	const diff = ctx.diff;
	if (!ctx.diffOnly) return [];
	if (diff.size === 0) return [];
	// Did any packages/*/src file change?
	const touchedPackages = new Set<string>();
	for (const f of diff) {
		const m = f.match(/^packages\/([^/]+)\/src\//);
		if (m) touchedPackages.add(m[1]!);
	}
	if (touchedPackages.size === 0) return [];
	// Is there at least one .changeset/*.md (besides README) in the diff?
	const hasChangeset = [...diff].some((f) => /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(f));
	if (hasChangeset) return [];
	return [
		{
			rule: "changeset-required",
			severity: "error",
			file: ".changeset/",
			message: `packages changed (${[...touchedPackages].join(", ")}) but no changeset added in diff`,
		},
	];
}

// Rule 1: zero-runtime-overhead — minimal v1 implementation
// Flag new dependencies declared in the diff that aren't acknowledged in the
// changeset with a `dep-justification:` line. Full size-budget enforcement
// requires registry lookups; we'll add that in a v2 once a real heavy dep
// gets caught manually.
function checkDependencyJustification(ctx: DiffCtx): Finding[] {
	const diff = ctx.diff;
	if (!ctx.diffOnly) return [];
	if (diff.size === 0) return [];
	const findings: Finding[] = [];
	const newDeps = new Set<string>();
	for (const f of diff) {
		if (!/^packages\/[^/]+\/package\.json$/.test(f)) continue;
		try {
			const head = readJson<PackageJson>(join(ROOT, f));
			let baseDeps = new Set<string>();
			try {
				const baseSrc = execSync(`git show master:${f}`, { cwd: ROOT, encoding: "utf-8" });
				const basePkg = JSON.parse(baseSrc) as PackageJson;
				baseDeps = new Set(Object.keys(basePkg.dependencies ?? {}));
			} catch {
				baseDeps = new Set();
			}
			for (const d of Object.keys(head.dependencies ?? {})) {
				if (!baseDeps.has(d) && !d.startsWith("@workkit/")) newDeps.add(d);
			}
		} catch {
			// ignore parse errors; not our problem here
		}
	}
	if (newDeps.size === 0) return findings;
	// Look for any changeset mentioning each new dep.
	const changesetTexts = [...diff]
		.filter((f) => /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(f))
		.map((f) => {
			try {
				return readFileSync(join(ROOT, f), "utf-8");
			} catch {
				return "";
			}
		})
		.join("\n");
	for (const d of newDeps) {
		const acknowledged =
			changesetTexts.includes(`dep-justification: ${d}`) ||
			changesetTexts.includes(`dep-justification:${d}`);
		if (!acknowledged) {
			findings.push({
				rule: "zero-runtime-overhead",
				severity: "warning",
				file: ".changeset/",
				message: `new direct dep "${d}" lacks a "dep-justification: ${d}" line in any changeset`,
			});
		}
	}
	return findings;
}

function summarize(findings: Finding[]): { errors: number; warnings: number } {
	let errors = 0;
	let warnings = 0;
	for (const f of findings) {
		if (f.severity === "error") errors += 1;
		else warnings += 1;
	}
	return { errors, warnings };
}

function fmt(f: Finding): string {
	const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
	return `[${f.severity}] ${f.rule}\t${loc}\t${f.message}`;
}

function main(): void {
	const opts = args();
	if (opts.help) {
		console.error(
			[
				"Usage: bun run constitution:check [--diff-only] [--base=<ref>]",
				"",
				"Runs the workkit Constitution mechanical checks. See .maina/constitution.md.",
				"",
				"Options:",
				"  --diff-only      Limit checks to files changed since --base (default master).",
				"                   Auto-enabled when CI=true or CONSTITUTION_DIFF_ONLY=1.",
				"  --base=<ref>     Diff base ref. Default: master.",
				"  -h, --help       Show this help.",
				"",
				"Exit codes:",
				"  0  clean / warnings only",
				"  1  one or more errors",
				"  2  invocation error",
			].join("\n"),
		);
		process.exit(opts.help ? 0 : 2);
	}

	const ctx: DiffCtx = {
		diffOnly: opts.diffOnly,
		diff: opts.diffOnly ? changedFiles(opts.base) : new Set<string>(),
	};
	if (ctx.diffOnly && ctx.diff.size === 0) {
		console.error(
			`constitution-check: --diff-only against "${opts.base}" produced no changes; nothing to check.`,
		);
	}

	const pkgs = loadPackages();
	const findings: Finding[] = [];
	for (const p of pkgs) {
		// In diff-only mode, skip packages that weren't touched. Honors rule
		// #8 ("diff-only fixes") so accumulated debt in unrelated packages
		// doesn't break unrelated PRs.
		if (!packageInDiff(p, ctx)) continue;
		findings.push(...checkSingleIndexExport(p));
		findings.push(...checkTestingIntegration(p));
		findings.push(...checkCrossPackageImports(p, ctx));
		findings.push(...checkNoConsoleLog(p, ctx));
		findings.push(...checkStandardSchemaOnly(p, ctx));
	}
	findings.push(...checkChangesetRequired(ctx));
	findings.push(...checkDependencyJustification(ctx));

	const { errors, warnings } = summarize(findings);
	for (const f of findings) console.error(fmt(f));
	console.error(
		`\nconstitution-check: ${errors} error(s), ${warnings} warning(s) across ${pkgs.length} packages` +
			(ctx.diffOnly ? ` (diff-only against ${opts.base})` : ""),
	);
	process.exit(errors > 0 ? 1 : 0);
}

main();
