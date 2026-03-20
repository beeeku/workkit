/**
 * Shared CLI utilities — colors, logging, file operations, arg parsing.
 * No external dependencies.
 */

// ── ANSI Colors ──────────────────────────────────────────────────────────────

const isColorSupported =
	typeof process !== "undefined" &&
	process.env.NO_COLOR === undefined &&
	process.env.TERM !== "dumb";

function wrap(code: number, resetCode: number): (s: string) => string {
	if (!isColorSupported) return (s: string) => s;
	return (s: string) => `\x1b[${code}m${s}\x1b[${resetCode}m`;
}

export const bold: (s: string) => string = wrap(1, 22);
export const dim: (s: string) => string = wrap(2, 22);
const red: (s: string) => string = wrap(31, 39);
const green: (s: string) => string = wrap(32, 39);
const yellow: (s: string) => string = wrap(33, 39);
const blue: (s: string) => string = wrap(34, 39);
export const cyan: (s: string) => string = wrap(36, 39);

// ── Logging ──────────────────────────────────────────────────────────────────

export function log(msg: string): void {
	console.log(msg);
}

export function success(msg: string): void {
	console.log(`${green("✓")} ${msg}`);
}

export function warn(msg: string): void {
	console.log(`${yellow("⚠")} ${msg}`);
}

export function error(msg: string): void {
	console.error(`${red("✗")} ${msg}`);
}

export function info(msg: string): void {
	console.log(`${blue("ℹ")} ${msg}`);
}

// ── Arg Parsing ──────────────────────────────────────────────────────────────

export interface ParsedArgs {
	/** Positional arguments (non-flag values) */
	positionals: string[];
	/** Named flags: --name=value or --name value */
	flags: Record<string, string | boolean>;
}

/**
 * Parse raw argv into positionals and flags.
 * Supports: --flag, --flag=value, --flag value, --no-flag
 */
export function parseArgs(argv: string[]): ParsedArgs {
	const positionals: string[] = [];
	const flags: Record<string, string | boolean> = {};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i]!;

		if (arg === "--") {
			// Everything after -- is positional
			positionals.push(...argv.slice(i + 1));
			break;
		}

		if (arg.startsWith("--")) {
			const rest = arg.slice(2);

			// --no-flag
			if (rest.startsWith("no-")) {
				flags[rest.slice(3)] = false;
				i++;
				continue;
			}

			// --flag=value
			const eqIdx = rest.indexOf("=");
			if (eqIdx !== -1) {
				flags[rest.slice(0, eqIdx)] = rest.slice(eqIdx + 1);
				i++;
				continue;
			}

			// --flag value or --flag (boolean)
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				flags[rest] = next;
				i += 2;
				continue;
			}

			flags[rest] = true;
			i++;
			continue;
		}

		if (arg.startsWith("-") && arg.length === 2) {
			// Short flag: -f value or -f (boolean)
			const key = arg.slice(1);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				flags[key] = next;
				i += 2;
				continue;
			}
			flags[key] = true;
			i++;
			continue;
		}

		positionals.push(arg);
		i++;
	}

	return { positionals, flags };
}

// ── File System Helpers ──────────────────────────────────────────────────────

export interface FileSystem {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	readDir(path: string): Promise<string[]>;
	readJson<T = unknown>(path: string): Promise<T>;
}

/**
 * Default file system using Node.js fs/promises.
 */
export function createNodeFs(): FileSystem {
	return {
		async readFile(path: string): Promise<string> {
			const { readFile } = await import("node:fs/promises");
			return readFile(path, "utf-8");
		},
		async writeFile(path: string, content: string): Promise<void> {
			const { writeFile, mkdir } = await import("node:fs/promises");
			const { dirname } = await import("node:path");
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, "utf-8");
		},
		async mkdir(path: string): Promise<void> {
			const { mkdir } = await import("node:fs/promises");
			await mkdir(path, { recursive: true });
		},
		async exists(path: string): Promise<boolean> {
			const { access } = await import("node:fs/promises");
			try {
				await access(path);
				return true;
			} catch {
				return false;
			}
		},
		async readDir(path: string): Promise<string[]> {
			const { readdir } = await import("node:fs/promises");
			return readdir(path);
		},
		async readJson<T = unknown>(path: string): Promise<T> {
			const { readFile } = await import("node:fs/promises");
			const content = await readFile(path, "utf-8");
			return JSON.parse(content) as T;
		},
	};
}

// ── Path Helpers ─────────────────────────────────────────────────────────────

export function joinPath(...parts: string[]): string {
	return parts.join("/").replace(/\/+/g, "/");
}

// ── Version ──────────────────────────────────────────────────────────────────

export const VERSION = "0.0.1";
