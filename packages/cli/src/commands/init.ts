import * as p from "@clack/prompts";
import { FEATURE_OPTIONS } from "../prompts/feature-select";
import { validateProjectName } from "../prompts/project-name";
import { TEMPLATE_OPTIONS } from "../prompts/template-select";
import { generateApiTemplate } from "../templates/api";
import { generateBasicTemplate } from "../templates/basic";
import { generateHonoTemplate } from "../templates/hono";
import type { FileSystem } from "../utils";
import { info, joinPath, error as logError, success } from "../utils";

export type Template = "basic" | "hono" | "api";
export type Feature =
	| "env"
	| "d1"
	| "kv"
	| "r2"
	| "cache"
	| "queue"
	| "cron"
	| "auth"
	| "ratelimit"
	| "ai"
	| "ai-gateway"
	| "api"
	| "crypto"
	| "do"
	| "logger";

export const VALID_TEMPLATES: Template[] = ["basic", "hono", "api"];
export const VALID_FEATURES: Feature[] = [
	"env",
	"d1",
	"kv",
	"r2",
	"cache",
	"queue",
	"cron",
	"auth",
	"ratelimit",
	"ai",
	"ai-gateway",
	"api",
	"crypto",
	"do",
	"logger",
];

export interface InitOptions {
	name?: string;
	template?: Template;
	features?: Feature[];
	dir?: string;
}

export interface GeneratedFile {
	path: string;
	content: string;
}

/**
 * Resolve project name from options or directory name.
 */
export function resolveProjectName(options: InitOptions, dir: string): string {
	if (options.name) return options.name;
	const parts = dir.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? "my-worker";
}

/**
 * Build package.json content for the new project.
 */
export function buildPackageJson(name: string, features: Feature[]): string {
	const deps: Record<string, string> = {};
	const devDeps: Record<string, string> = {
		wrangler: "^3.0.0",
		typescript: "^5.7.0",
		vitest: "^3.0.0",
		"@cloudflare/workers-types": "^4.20250310.0",
	};

	// Always include types and errors
	deps["@workkit/types"] = "latest";
	deps["@workkit/errors"] = "latest";

	for (const feature of features) {
		deps[`@workkit/${feature}`] = "latest";
	}

	const pkg = {
		name,
		version: "0.0.0",
		private: true,
		type: "module",
		scripts: {
			dev: "wrangler dev",
			deploy: "wrangler deploy",
			test: "vitest run",
			typecheck: "tsc --noEmit",
		},
		dependencies: deps,
		devDependencies: devDeps,
	};

	return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * Build wrangler.toml content.
 */
export function buildWranglerToml(name: string, features: Feature[]): string {
	const lines = [
		`name = "${name}"`,
		`main = "src/index.ts"`,
		`compatibility_date = "${new Date().toISOString().split("T")[0]}"`,
		"",
	];

	if (features.includes("d1")) {
		lines.push(
			`# Create with: wrangler d1 create ${name}-db`,
			"[[d1_databases]]",
			`binding = "DB"`,
			`database_name = "${name}-db"`,
			`database_id = "TODO"  # Replace with actual ID from wrangler d1 create`,
			"",
		);
	}

	if (features.includes("kv")) {
		lines.push(
			"# Create with: wrangler kv namespace create KV",
			"[[kv_namespaces]]",
			`binding = "KV"`,
			`id = "TODO"  # Replace with actual ID from wrangler kv namespace create`,
			"",
		);
	}

	if (features.includes("r2")) {
		lines.push("[[r2_buckets]]", `binding = "BUCKET"`, `bucket_name = "${name}-bucket"`, "");
	}

	if (features.includes("queue")) {
		lines.push("[[queues.producers]]", `queue = "${name}-queue"`, `binding = "QUEUE"`, "");
	}

	return lines.join("\n");
}

/**
 * Build tsconfig.json content.
 */
export function buildTsconfig(): string {
	const config = {
		compilerOptions: {
			target: "ES2022",
			module: "ESNext",
			moduleResolution: "bundler",
			strict: true,
			esModuleInterop: true,
			skipLibCheck: true,
			forceConsistentCasingInFileNames: true,
			resolveJsonModule: true,
			isolatedModules: true,
			noUncheckedIndexedAccess: true,
			types: ["@cloudflare/workers-types"],
			lib: ["ES2022"],
		},
		include: ["src/**/*.ts"],
		exclude: ["node_modules", "dist"],
	};
	return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Build vitest.config.ts content.
 */
export function buildVitestConfig(): string {
	return `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
`;
}

/**
 * Generate all project files based on template and features.
 */
export function generateProjectFiles(
	name: string,
	template: Template,
	features: Feature[],
): GeneratedFile[] {
	const files: GeneratedFile[] = [
		{ path: "package.json", content: buildPackageJson(name, features) },
		{ path: "wrangler.toml", content: buildWranglerToml(name, features) },
		{ path: "tsconfig.json", content: buildTsconfig() },
		{ path: "vitest.config.ts", content: buildVitestConfig() },
	];

	// Generate template-specific source files
	let templateFiles: GeneratedFile[];
	switch (template) {
		case "hono":
			templateFiles = generateHonoTemplate(name, features);
			break;
		case "api":
			templateFiles = generateApiTemplate(name, features);
			break;
		default:
			templateFiles = generateBasicTemplate(name, features);
			break;
	}

	files.push(...templateFiles);
	return files;
}

/**
 * Parse features from a comma-separated string.
 */
export function parseFeatures(input: string): Feature[] {
	const raw = input.split(",").map((s) => s.trim().toLowerCase());
	const valid: Feature[] = [];
	const invalid: string[] = [];

	for (const f of raw) {
		if (VALID_FEATURES.includes(f as Feature)) {
			valid.push(f as Feature);
		} else if (f !== "") {
			invalid.push(f);
		}
	}

	if (invalid.length > 0) {
		logError(`Unknown features: ${invalid.join(", ")}. Valid: ${VALID_FEATURES.join(", ")}`);
	}

	return valid;
}

/**
 * Check if all required flags are provided for non-interactive mode.
 */
function hasAllFlags(flags: Record<string, unknown>): boolean {
	return !!(flags.template || flags.t) && !!(flags.features || flags.f);
}

/**
 * Run interactive prompts for any missing init options.
 * Skips prompts for values already provided via flags.
 */
async function interactiveInit(flags: Record<string, unknown>): Promise<{
	name: string;
	template: string;
	features: string[];
	dir: string;
}> {
	p.intro("workkit — Create a new Cloudflare Workers project");

	const name =
		(flags.name as string) ??
		(flags.n as string) ??
		((await p.text({
			message: "What's your project name?",
			placeholder: "my-worker",
			validate: validateProjectName,
		})) as string);

	if (p.isCancel(name)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	const template =
		(flags.template as string) ??
		(flags.t as string) ??
		((await p.select({
			message: "Which template?",
			options: TEMPLATE_OPTIONS,
		})) as string);

	if (p.isCancel(template)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}

	const featuresRaw = (flags.features as string) ?? (flags.f as string);
	const features = featuresRaw
		? featuresRaw.split(",")
		: ((await p.multiselect({
				message: "Which packages do you want?",
				options: FEATURE_OPTIONS,
				required: false,
			})) as string[]);

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

/**
 * Execute the init command: write project files to disk.
 * Supports both flag-based (backward compat) and interactive modes.
 */
export async function executeInit(
	options: InitOptions,
	fs: FileSystem,
	flags?: Record<string, unknown>,
): Promise<GeneratedFile[]> {
	// If flags are provided and incomplete, run interactive mode
	if (flags && !hasAllFlags(flags)) {
		const interactive = await interactiveInit(flags);
		options = {
			name: interactive.name,
			template: interactive.template as Template,
			features: parseFeatures(interactive.features.join(",")),
			dir: interactive.dir,
		};
	}

	const dir = options.dir ?? process.cwd();
	const name = resolveProjectName(options, dir);
	const template = options.template ?? "basic";
	const features = options.features ?? ["env"];

	if (!VALID_TEMPLATES.includes(template)) {
		throw new Error(`Unknown template "${template}". Valid: ${VALID_TEMPLATES.join(", ")}`);
	}

	const files = generateProjectFiles(name, template, features);

	for (const file of files) {
		const fullPath = joinPath(dir, file.path);
		await fs.writeFile(fullPath, file.content);
		success(`Created ${file.path}`);
	}

	info(`Project "${name}" initialized with template "${template}"`);
	return files;
}
