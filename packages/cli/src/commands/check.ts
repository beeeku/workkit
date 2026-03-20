import type { FileSystem } from "../utils";

export interface BindingError {
	binding: string;
	message: string;
}

export interface BindingWarning {
	binding: string;
	message: string;
}

export interface CheckResult {
	valid: boolean;
	errors: BindingError[];
	warnings: BindingWarning[];
}

/**
 * Known Cloudflare binding types and their wrangler.toml config keys.
 */
const BINDING_TYPE_MAP: Record<string, string> = {
	D1Database: "d1_databases",
	KVNamespace: "kv_namespaces",
	R2Bucket: "r2_buckets",
	DurableObjectNamespace: "durable_objects",
	Queue: "queues",
	AnalyticsEngineDataset: "analytics_engine_datasets",
	Fetcher: "services",
};

/**
 * Extract binding names and types from TypeScript source.
 * Looks for interface Env { ... } patterns.
 */
export function extractBindingsFromSource(source: string): Map<string, string> {
	const bindings = new Map<string, string>();

	// Match interface Env { ... } block
	const envMatch = source.match(/interface\s+Env\s*\{([^}]*)\}/s);
	if (!envMatch) return bindings;

	const body = envMatch[1]!;
	// Match property declarations like: DB: D1Database
	const propRegex = /(\w+)\s*:\s*(\w+)/g;
	let match: RegExpExecArray | null;
	while ((match = propRegex.exec(body)) !== null) {
		bindings.set(match[1]!, match[2]!);
	}

	return bindings;
}

/**
 * Extract binding names from wrangler.toml content.
 * Looks for binding = "NAME" patterns under known sections.
 */
export function extractBindingsFromWrangler(toml: string): Map<string, string> {
	const bindings = new Map<string, string>();

	// Find all binding = "NAME" entries and their section context
	const lines = toml.split("\n");
	let currentSection = "";

	for (const line of lines) {
		const trimmed = line.trim();

		// Track section headers like [[d1_databases]] or [[kv_namespaces]]
		const sectionMatch = trimmed.match(/^\[\[(\w+)(?:\.\w+)?\]\]$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1]!;
			continue;
		}

		// Track single bracket sections
		const singleSection = trimmed.match(/^\[(\w+)\]$/);
		if (singleSection) {
			currentSection = singleSection[1]!;
			continue;
		}

		// Find binding = "VALUE"
		const bindingMatch = trimmed.match(/^binding\s*=\s*"(\w+)"$/);
		if (bindingMatch) {
			bindings.set(bindingMatch[1]!, currentSection);
		}
	}

	return bindings;
}

/**
 * Validate source bindings against wrangler.toml bindings.
 */
export function validateBindings(
	sourceBindings: Map<string, string>,
	wranglerBindings: Map<string, string>,
): CheckResult {
	const errors: BindingError[] = [];
	const warnings: BindingWarning[] = [];

	// Check each source binding exists in wrangler.toml
	for (const [name, type] of sourceBindings) {
		if (!wranglerBindings.has(name)) {
			errors.push({
				binding: name,
				message: `Binding "${name}" (${type}) defined in source but missing from wrangler.toml`,
			});
			continue;
		}

		// Check type consistency
		const expectedSection = BINDING_TYPE_MAP[type];
		const actualSection = wranglerBindings.get(name);
		if (expectedSection && actualSection && expectedSection !== actualSection) {
			errors.push({
				binding: name,
				message: `Type mismatch: "${name}" is ${type} in source but configured under [${actualSection}] in wrangler.toml (expected [${expectedSection}])`,
			});
		}
	}

	// Check for wrangler bindings not referenced in source
	for (const [name] of wranglerBindings) {
		if (!sourceBindings.has(name)) {
			warnings.push({
				binding: name,
				message: `Binding "${name}" configured in wrangler.toml but not referenced in source Env interface`,
			});
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Execute the check command.
 */
export async function executeCheck(dir: string, fs: FileSystem): Promise<CheckResult> {
	const tomlPath = `${dir}/wrangler.toml`;
	const srcPath = `${dir}/src/index.ts`;

	if (!(await fs.exists(tomlPath))) {
		return {
			valid: false,
			errors: [{ binding: "", message: "wrangler.toml not found" }],
			warnings: [],
		};
	}

	if (!(await fs.exists(srcPath))) {
		return {
			valid: false,
			errors: [{ binding: "", message: "src/index.ts not found" }],
			warnings: [],
		};
	}

	const toml = await fs.readFile(tomlPath);
	const source = await fs.readFile(srcPath);

	const sourceBindings = extractBindingsFromSource(source);
	const wranglerBindings = extractBindingsFromWrangler(toml);

	return validateBindings(sourceBindings, wranglerBindings);
}
