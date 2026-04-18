import * as p from "@clack/prompts";
import { FEATURE_OPTIONS } from "../prompts/feature-select";

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
		console.log("All specified packages are already installed."); // constitution-allow:console-log reason="CLI stdout emission"
		return { added: [] };
	}

	return { added: newPackages };
}
