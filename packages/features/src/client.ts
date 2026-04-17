import { evaluateFlag, evaluateVariant } from "./evaluate";
import { deterministicHash } from "./hash";
import type { FlagClient, FlagContext, FlagDefinition, FlagOptions } from "./types";

interface CacheEntry {
	definition: FlagDefinition;
	timestamp: number;
}

/**
 * Create a feature flag client backed by Cloudflare KV.
 *
 * Reads flag definitions from KV as JSON, with an in-memory cache layer
 * to minimize KV reads. Supports percentage rollouts, targeting rules,
 * variant assignment, and per-user overrides.
 *
 * @example
 * ```ts
 * const flags = createFlags(env.FLAGS_KV, { prefix: "flags:", cacheTtl: 60 });
 * const enabled = await flags.isEnabled("dark-mode", { userId: "user-123" });
 * ```
 */
export function createFlags(kv: KVNamespace, options?: FlagOptions): FlagClient {
	const prefix = options?.prefix ?? "flags:";
	const cacheTtl = (options?.cacheTtl ?? 60) * 1000; // convert to ms
	const cache = new Map<string, CacheEntry>();

	function kvKey(key: string): string {
		return `${prefix}${key}`;
	}

	function isCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
		if (!entry) return false;
		return Date.now() - entry.timestamp < cacheTtl;
	}

	async function getFlag(key: string): Promise<FlagDefinition | null> {
		const cached = cache.get(key);
		if (isCacheValid(cached)) {
			return cached.definition;
		}

		const raw = await kv.get(kvKey(key), "json");
		if (!raw) return null;

		const definition = raw as FlagDefinition;
		cache.set(key, { definition, timestamp: Date.now() });
		return definition;
	}

	function getHash(flagKey: string, context: FlagContext): number {
		const input = `${flagKey}:${context.userId ?? "anonymous"}`;
		return deterministicHash(input);
	}

	return {
		async isEnabled(key: string, context: FlagContext = {}): Promise<boolean> {
			const flag = await getFlag(key);
			if (!flag) return false;
			const hash = getHash(key, context);
			return evaluateFlag(flag, context, hash);
		},

		async getVariant(key: string, context: FlagContext = {}): Promise<string | null> {
			const flag = await getFlag(key);
			if (!flag || !flag.enabled) return null;
			const hash = getHash(key, context);
			return evaluateVariant(flag, context, hash);
		},

		async getAllFlags(context: FlagContext = {}): Promise<Map<string, boolean>> {
			const result = new Map<string, boolean>();
			const flags = await listAllFlags();
			for (const flag of flags) {
				const hash = getHash(flag.key, context);
				result.set(flag.key, evaluateFlag(flag, context, hash));
			}
			return result;
		},

		async setFlag(key: string, definition: FlagDefinition): Promise<void> {
			await kv.put(kvKey(key), JSON.stringify(definition));
			cache.set(key, { definition, timestamp: Date.now() });
		},

		async deleteFlag(key: string): Promise<void> {
			await kv.delete(kvKey(key));
			cache.delete(key);
		},

		async listFlags(): Promise<FlagDefinition[]> {
			return listAllFlags();
		},
	};

	async function listAllFlags(): Promise<FlagDefinition[]> {
		const definitions: FlagDefinition[] = [];
		let cursor: string | undefined;
		let done = false;

		while (!done) {
			const list = await kv.list({ prefix, cursor });
			const flagPromises = list.keys.map(async (key) => {
				const flagKey = key.name.slice(prefix.length);
				return getFlag(flagKey);
			});
			const flags = await Promise.all(flagPromises);
			for (const flag of flags) {
				if (flag) definitions.push(flag);
			}
			if (list.list_complete || !list.cursor) {
				done = true;
			} else {
				cursor = list.cursor;
			}
		}

		return definitions;
	}
}
