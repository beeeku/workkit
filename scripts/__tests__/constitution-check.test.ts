/**
 * Smoke test for `scripts/constitution-check.ts`. Runs the script as a
 * subprocess against the live repo and asserts the rule names + exit code.
 *
 * The repo currently carries known violations (pre-dating the constitution
 * rollout); they're documented as accepted technical debt. This test pins
 * the rule-name surface so any new check we add is wired before merging.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { maskCommentsAndTemplates } from "../constitution-check";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCRIPT = resolve(ROOT, "scripts", "constitution-check.ts");

function run(args: string[] = []): { code: number; stderr: string; stdout: string } {
	const result = spawnSync("bun", ["run", SCRIPT, ...args], {
		cwd: ROOT,
		encoding: "utf-8",
	});
	return {
		code: result.status ?? -1,
		stderr: result.stderr ?? "",
		stdout: result.stdout ?? "",
	};
}

describe("constitution-check (smoke)", () => {
	it("exposes --help and exits 0", () => {
		const r = run(["--help"]);
		expect(r.code).toBe(0);
		expect(r.stderr).toContain("Usage: bun run constitution:check");
		expect(r.stderr).toContain("--diff-only");
	});

	it("runs in diff-only mode against HEAD with no changes (exit 0)", () => {
		const r = run(["--diff-only", "--base=HEAD"]);
		// No diff vs HEAD ⇒ no findings.
		expect(r.code).toBe(0);
		expect(r.stderr).toMatch(/0 error\(s\)/);
	});

	it("full-repo run reports findings tagged with the expected rule names", () => {
		const r = run([]);
		// Repo carries pre-existing violations; we pin the rule name surface.
		const allOutput = `${r.stderr}\n${r.stdout}`;
		// At least one of these rules should fire on the live repo.
		const seen = [
			"single-index-export",
			"testing-integration",
			"no-cross-package-imports",
			"no-console-log",
			"standard-schema-only",
			"changeset-required",
			"zero-runtime-overhead",
		].filter((rule) => allOutput.includes(rule));
		expect(seen.length).toBeGreaterThan(0);
		// Summary line is present regardless of count.
		expect(allOutput).toMatch(/constitution-check: \d+ error\(s\), \d+ warning\(s\)/);
	});
});

describe("maskCommentsAndTemplates", () => {
	it("masks // line comments so console.log inside is not flagged", () => {
		const masked = maskCommentsAndTemplates("const x = 1 // console.log(x)\n");
		expect(masked).not.toContain("console.log");
		expect(masked.split("\n").length).toBe(2); // preserves line count
	});

	it("masks /* */ and JSDoc blocks including @example code", () => {
		const src = "/**\n * @example\n * console.log(\"hi\")\n */\nexport {}\n";
		const masked = maskCommentsAndTemplates(src);
		expect(masked).not.toContain("console.log");
		expect(masked).toContain("export {}"); // real code survives
	});

	it("masks template-string contents so emitted imports are not flagged", () => {
		const src = 'const code = `import { foo } from "@workkit/bar"`;\n';
		const masked = maskCommentsAndTemplates(src);
		expect(masked).not.toContain("@workkit/bar");
		expect(masked).toContain("`"); // backticks retained for structure
	});

	it("preserves real string-literal imports", () => {
		const src = 'import { foo } from "@workkit/bar";\n';
		const masked = maskCommentsAndTemplates(src);
		expect(masked).toContain("@workkit/bar");
	});

	it("preserves line numbers across masked regions", () => {
		const src = 'a\n/* line2\nline3 */\nd\n';
		const masked = maskCommentsAndTemplates(src);
		expect(masked.split("\n")).toHaveLength(5);
	});

	it("handles ${} expressions inside template strings", () => {
		const src = "const s = `hello ${name} world`;\n";
		const masked = maskCommentsAndTemplates(src);
		expect(masked).toContain("${name}");
	});
});
