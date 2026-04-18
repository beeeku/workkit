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
