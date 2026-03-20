import { createMockD1 } from "./d1";
import { createMockDO } from "./do";
import { createMockKV } from "./kv";
import { createMockQueue } from "./queue";
import { createMockR2 } from "./r2";

interface TestEnvConfig {
	kv?: string[];
	d1?: string[];
	r2?: string[];
	queue?: string[];
	do?: string[];
	vars?: Record<string, string | number | boolean>;
}

/** Maps binding names from each config category to their mock types. */
type EnvBindings<T extends TestEnvConfig> = {
	[K in T["kv"] extends readonly string[] ? T["kv"][number] : never]: KVNamespace;
} & { [K in T["d1"] extends readonly string[] ? T["d1"][number] : never]: D1Database } & {
	[K in T["r2"] extends readonly string[] ? T["r2"][number] : never]: R2Bucket;
} & { [K in T["queue"] extends readonly string[] ? T["queue"][number] : never]: Queue } & {
	[K in T["do"] extends readonly string[] ? T["do"][number] : never]: DurableObjectStorage;
} & { [K in keyof T["vars"] & string]: T["vars"] extends Record<string, infer V> ? V : never };

/**
 * One-call environment factory for Cloudflare Workers tests.
 * Creates named mocks for each binding type and returns a typed env object.
 *
 * @param config - Binding names for each category (kv, d1, r2, queue, do) plus plain vars.
 * @returns An object mapping each binding name to its mock instance.
 *
 * @example
 * ```ts
 * const env = createTestEnv({
 *   kv: ['CACHE'] as const,
 *   d1: ['DB'] as const,
 *   vars: { API_URL: 'http://localhost' },
 * })
 * // env.CACHE is KVNamespace, env.DB is D1Database, env.API_URL is string
 * ```
 */
export function createTestEnv<T extends TestEnvConfig>(config: T): EnvBindings<T> {
	const env: Record<string, any> = {};

	if (config.kv) {
		for (const name of config.kv) {
			env[name] = createMockKV();
		}
	}

	if (config.d1) {
		for (const name of config.d1) {
			env[name] = createMockD1();
		}
	}

	if (config.r2) {
		for (const name of config.r2) {
			env[name] = createMockR2();
		}
	}

	if (config.queue) {
		for (const name of config.queue) {
			env[name] = createMockQueue();
		}
	}

	if (config.do) {
		for (const name of config.do) {
			env[name] = createMockDO();
		}
	}

	if (config.vars) {
		for (const [key, value] of Object.entries(config.vars)) {
			env[key] = value;
		}
	}

	return env as EnvBindings<T>;
}
