# CLI Interactive Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the workkit CLI into an interactive, shadcn-inspired experience with a template picker, feature multi-select, and a new `workkit add` command — while keeping full backward compatibility with flag-based usage.

**Architecture:** @clack/prompts for terminal UI. Each prompt is independently skippable via flags. Interactive mode activates when flags are missing. New `add` command installs packages into existing projects with optional wrangler.toml configuration.

**Tech Stack:** TypeScript, @clack/prompts, picocolors, bunup

---

## File Structure

```
packages/cli/
├── src/
│   ├── index.ts              — Entry point (modify: add 'add' command routing)
│   ├── commands/
│   │   ├── init.ts           — Modify: add interactive prompts
│   │   └── add.ts            — Create: new add command
│   ├── prompts/
│   │   ├── project-name.ts   — Create: name prompt with validation
│   │   ├── template-select.ts — Create: template picker
│   │   └── feature-select.ts — Create: multi-select feature picker
│   ├── utils.ts              — Existing utilities
│   └── templates.ts          — Existing templates (modify: add descriptions)
├── tests/
│   ├── prompts.test.ts       — Create: prompt logic tests
│   ├── add.test.ts           — Create: add command tests
│   └── init.test.ts          — Existing (modify: add interactive tests)
└── package.json              — Modify: add @clack/prompts dep
```

---

### Task 1: Add @clack/prompts Dependency

**Files:**
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Install @clack/prompts**

Run: `cd /Users/Bikash/.instar/agents/jarvis/workkit && bun add -D @clack/prompts picocolors --filter=workkit`

- [ ] **Step 2: Verify the dep is in devDependencies**

Read `packages/cli/package.json` and confirm `@clack/prompts` is listed.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/package.json bun.lock
git commit -m "chore(cli): add @clack/prompts and picocolors for interactive mode"
```

---

### Task 2: Prompt Modules

**Files:**
- Create: `packages/cli/src/prompts/project-name.ts`
- Create: `packages/cli/src/prompts/template-select.ts`
- Create: `packages/cli/src/prompts/feature-select.ts`
- Create: `packages/cli/tests/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { TEMPLATE_OPTIONS, validateProjectName } from "../src/prompts/project-name";

describe("prompt utilities", () => {
	describe("validateProjectName", () => {
		it("accepts valid npm package names", () => {
			expect(validateProjectName("my-app")).toBeUndefined();
			expect(validateProjectName("my_app")).toBeUndefined();
			expect(validateProjectName("app123")).toBeUndefined();
		});

		it("rejects empty names", () => {
			expect(validateProjectName("")).toBe("Project name is required");
		});

		it("rejects names with spaces", () => {
			expect(validateProjectName("my app")).toBe("Project name cannot contain spaces");
		});

		it("rejects names starting with dot or underscore", () => {
			expect(validateProjectName(".hidden")).toBe("Project name cannot start with . or _");
			expect(validateProjectName("_private")).toBe("Project name cannot start with . or _");
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun vitest run tests/prompts.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement project-name.ts**

```ts
/**
 * Validate a project name for npm compatibility.
 * Returns an error message string if invalid, undefined if valid.
 */
export function validateProjectName(name: string): string | undefined {
	if (!name || name.trim().length === 0) return "Project name is required";
	if (name.includes(" ")) return "Project name cannot contain spaces";
	if (name.startsWith(".") || name.startsWith("_")) return "Project name cannot start with . or _";
	return undefined;
}
```

- [ ] **Step 4: Implement template-select.ts**

```ts
export interface TemplateOption {
	value: string;
	label: string;
	hint: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
	{ value: "basic", label: "Basic", hint: "Minimal fetch handler — start from scratch" },
	{ value: "hono", label: "Hono", hint: "Hono framework with typed routes (recommended)" },
	{ value: "api", label: "API", hint: "Structured API with router, handlers, and OpenAPI" },
];
```

- [ ] **Step 5: Implement feature-select.ts**

```ts
export interface FeatureOption {
	value: string;
	label: string;
	hint: string;
}

export const FEATURE_OPTIONS: FeatureOption[] = [
	{ value: "env", label: "@workkit/env", hint: "Type-safe environment validation" },
	{ value: "kv", label: "@workkit/kv", hint: "Typed KV with serialization" },
	{ value: "d1", label: "@workkit/d1", hint: "Typed D1 with query builder" },
	{ value: "r2", label: "@workkit/r2", hint: "R2 storage with streaming" },
	{ value: "cache", label: "@workkit/cache", hint: "SWR and cache patterns" },
	{ value: "queue", label: "@workkit/queue", hint: "Typed queue producer/consumer" },
	{ value: "cron", label: "@workkit/cron", hint: "Declarative cron handlers" },
	{ value: "auth", label: "@workkit/auth", hint: "JWT and session management" },
	{ value: "ratelimit", label: "@workkit/ratelimit", hint: "KV-backed rate limiting" },
	{ value: "ai", label: "@workkit/ai", hint: "Workers AI with streaming" },
];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/cli && bun vitest run tests/prompts.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/prompts/ packages/cli/tests/prompts.test.ts
git commit -m "feat(cli): add prompt modules for interactive init"
```

---

### Task 3: Interactive Init Command

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Read the existing init.ts to understand current structure**

Read: `packages/cli/src/commands/init.ts`

- [ ] **Step 2: Modify init.ts to add interactive prompts**

The init command should:
1. Check if `--name`, `--template`, `--features` flags are provided
2. For any missing flag, show the interactive prompt
3. If `CI=true` env var is set, use defaults instead of prompting
4. Proceed with the existing scaffolding logic using collected values

Add an `interactiveInit` function that wraps `@clack/prompts`:

```ts
import * as p from "@clack/prompts";
import { TEMPLATE_OPTIONS } from "../prompts/template-select";
import { FEATURE_OPTIONS } from "../prompts/feature-select";
import { validateProjectName } from "../prompts/project-name";

async function interactiveInit(flags: Record<string, unknown>): Promise<{
	name: string;
	template: string;
	features: string[];
	dir: string;
}> {
	p.intro("workkit — Create a new Cloudflare Workers project");

	const name =
		(flags.name as string) ??
		(await p.text({
			message: "What's your project name?",
			placeholder: "my-worker",
			validate: validateProjectName,
		}));

	if (p.isCancel(name)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	const template =
		(flags.template as string) ??
		(await p.select({
			message: "Which template?",
			options: TEMPLATE_OPTIONS,
		}));

	if (p.isCancel(template)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	const features =
		(flags.features as string)?.split(",") ??
		(await p.multiselect({
			message: "Which packages do you want?",
			options: FEATURE_OPTIONS,
			required: false,
		}));

	if (p.isCancel(features)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	const dir = (flags.dir as string) ?? `./${name}`;

	p.outro(`Creating ${name} with ${template} template`);

	return {
		name: name as string,
		template: template as string,
		features: features as string[],
		dir,
	};
}
```

Modify the existing `executeInit` to call `interactiveInit` when flags are incomplete, then pass values to the existing scaffolding logic.

- [ ] **Step 3: Update index.ts to handle the interactive flow**

The init command case should pass flags through to init, which handles interactive vs flag-based internally.

- [ ] **Step 4: Build and test manually**

Run: `cd /Users/Bikash/.instar/agents/jarvis/workkit && bun run build --filter=workkit`
Then: `node packages/cli/dist/index.js init --template hono --features env --name test-project --dir /tmp/test-cli`
Expected: Works same as before (no prompts when all flags provided)

- [ ] **Step 5: Run existing init tests**

Run: `cd packages/cli && bun vitest run tests/init.test.ts`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): add interactive mode to init command with @clack/prompts"
```

---

### Task 4: Add Command

**Files:**
- Create: `packages/cli/src/commands/add.ts`
- Create: `packages/cli/tests/add.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
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
			expect(resolvePackageNames(["kv", "@workkit/d1"])).toEqual([
				"@workkit/kv",
				"@workkit/d1",
			]);
		});
	});

	describe("detectInstalledPackages", () => {
		it("returns empty set when no workkit packages", () => {
			const pkg = { dependencies: { hono: "^4.0.0" } };
			expect(detectInstalledPackages(pkg)).toEqual(new Set());
		});

		it("detects installed @workkit packages", () => {
			const pkg = {
				dependencies: { "@workkit/kv": "^0.1.0", "@workkit/d1": "^0.1.0", hono: "^4.0.0" },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun vitest run tests/add.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement add.ts**

```ts
import * as p from "@clack/prompts";
import { FEATURE_OPTIONS } from "../prompts/feature-select";

const WORKKIT_PACKAGES = [
	"types", "errors", "env", "kv", "d1", "r2", "cache", "queue",
	"do", "cron", "ratelimit", "crypto", "ai", "ai-gateway", "api",
	"auth", "testing", "logger", "hono", "astro", "remix",
];

/**
 * Resolve short package names (e.g., "kv") to full names ("@workkit/kv").
 */
export function resolvePackageNames(names: string[]): string[] {
	return names.map((name) => {
		if (name.startsWith("@workkit/")) return name;
		return `@workkit/${name}`;
	});
}

/**
 * Detect which @workkit packages are already installed in a project.
 */
export function detectInstalledPackages(
	pkg: Record<string, Record<string, string> | undefined>,
): Set<string> {
	const installed = new Set<string>();
	const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
	for (const name of Object.keys(allDeps)) {
		if (name.startsWith("@workkit/")) {
			installed.add(name);
		}
	}
	return installed;
}

export interface AddOptions {
	packages?: string[];
	cwd: string;
}

/**
 * Add workkit packages to an existing project.
 *
 * Interactive when no packages specified, direct when packages are provided.
 */
export async function executeAdd(
	options: AddOptions,
	fs: { readFileSync: (path: string, encoding: string) => string },
): Promise<{ added: string[] }> {
	let pkgJson: Record<string, unknown>;
	try {
		pkgJson = JSON.parse(fs.readFileSync(`${options.cwd}/package.json`, "utf-8"));
	} catch {
		throw new Error("No package.json found. Run this from a project directory.");
	}

	const installed = detectInstalledPackages(pkgJson as Record<string, Record<string, string>>);

	let toAdd: string[];

	if (options.packages && options.packages.length > 0) {
		toAdd = resolvePackageNames(options.packages);
	} else {
		// Interactive mode
		p.intro("workkit add — Add packages to your project");

		const available = FEATURE_OPTIONS.filter((f) => !installed.has(`@workkit/${f.value}`));

		if (available.length === 0) {
			p.outro("All packages are already installed!");
			return { added: [] };
		}

		const selected = await p.multiselect({
			message: "Which packages do you want to add?",
			options: available,
			required: true,
		});

		if (p.isCancel(selected)) {
			p.cancel("Cancelled.");
			process.exit(0);
		}

		toAdd = resolvePackageNames(selected as string[]);
	}

	// Filter out already installed
	const newPackages = toAdd.filter((pkg) => !installed.has(pkg));

	if (newPackages.length === 0) {
		console.log("All specified packages are already installed.");
		return { added: [] };
	}

	return { added: newPackages };
}
```

- [ ] **Step 4: Add 'add' command to index.ts router**

In the switch statement in `packages/cli/src/index.ts`, add:

```ts
case "add": {
	const { executeAdd } = await import("./commands/add");
	const packages = positionals.slice(1);
	const result = await executeAdd({ packages, cwd }, fs);
	if (result.added.length > 0) {
		success(`Added: ${result.added.join(", ")}`);
		log("\nRun: bun install");
	}
	break;
}
```

Also add "add" to the HELP text and the COMMANDS section.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/cli && bun vitest run tests/add.test.ts`
Expected: PASS

- [ ] **Step 6: Run all CLI tests**

Run: `cd packages/cli && bun vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add 'workkit add' command for installing packages into existing projects"
```

---

### Task 5: Build, Lint, and Final Validation

**Files:**
- Various (lint fixes)

- [ ] **Step 1: Build the full monorepo**

Run: `bun run build`
Expected: All packages build including updated CLI

- [ ] **Step 2: Run all tests**

Run: `bun run test`
Expected: All pass

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Clean

- [ ] **Step 4: Run lint and format**

Run: `bun run lint:fix && bun run format && bun run lint`
Expected: Clean

- [ ] **Step 5: Run e2e tests**

Run: `bun run test:e2e`
Expected: All pass

- [ ] **Step 6: Test CLI end-to-end with flags (backward compat)**

Run: `node packages/cli/dist/index.js init --template hono --features env,d1 --name test-compat --dir /tmp/test-compat`
Expected: Creates project without any prompts

- [ ] **Step 7: Test CLI add command**

Run: `cd /tmp/test-compat && node /Users/Bikash/.instar/agents/jarvis/workkit/packages/cli/dist/index.js add kv auth`
Expected: Reports packages to add

- [ ] **Step 8: Commit and push**

```bash
git add -A
git commit -m "feat(cli): finalize interactive CLI with lint and validation"
git push origin master
```
