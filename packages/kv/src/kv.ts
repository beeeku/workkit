import { batchDelete, batchGet, batchPut } from "./batch";
import { assertKVBinding, assertValidTtl, wrapKVError } from "./errors";
import { createListIterator } from "./list";
import { type Serializer, getSerializer } from "./serialization";
import type {
	GetOptions,
	KVBatchPutEntry,
	KVGetWithMetadataResult,
	KVListEntry,
	KVOptions,
	ListOptions,
	PutOptions,
	WorkkitKV,
} from "./types";
import { prefixKey, stripPrefix, validateKey } from "./utils";

/**
 * Create a typed KV client from a Cloudflare KV namespace binding.
 *
 * Wraps the raw KV API with automatic serialization, key prefixing,
 * batch operations, and ergonomic error handling.
 *
 * @param binding - The KVNamespace binding from the worker env.
 * @param options - Optional config: prefix, defaultTtl, cacheTtl, serializer.
 * @returns A WorkkitKV instance with get/put/delete/list and batch methods.
 *
 * @example
 * ```ts
 * const cache = kv<User>(env.USERS_KV, { prefix: 'user:', defaultTtl: 3600 })
 * await cache.put('alice', { name: 'Alice', role: 'admin' })
 * const user = await cache.get('alice') // User | null
 * ```
 */
export function kv<T>(binding: KVNamespace, options?: KVOptions): WorkkitKV<T> {
	assertKVBinding(binding);

	const prefix = options?.prefix ?? "";
	const defaultTtl = options?.defaultTtl;
	const defaultCacheTtl = options?.defaultCacheTtl;
	const serializer: Serializer<T> = getSerializer<T>(options?.serializer ?? "json");

	return {
		async get(key: string, opts?: GetOptions): Promise<T | null> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			const cacheTtl = opts?.cacheTtl ?? defaultCacheTtl;
			try {
				return (await binding.get(fullKey, {
					type: serializer.kvType as any,
					cacheTtl: cacheTtl === false ? undefined : cacheTtl,
				})) as T | null;
			} catch (err) {
				wrapKVError(err, { key: fullKey, prefix, operation: "get" });
			}
		},

		async getWithMetadata<M = unknown>(
			key: string,
			opts?: GetOptions,
		): Promise<KVGetWithMetadataResult<T, M>> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			const cacheTtl = opts?.cacheTtl ?? defaultCacheTtl;
			try {
				const result = await binding.getWithMetadata(fullKey, {
					type: serializer.kvType as any,
					cacheTtl: cacheTtl === false ? undefined : cacheTtl,
				});
				return {
					value: result.value as T | null,
					metadata: (result.metadata as M) ?? null,
					cacheStatus: (result as any).cacheStatus ?? null,
				};
			} catch (err) {
				wrapKVError(err, { key: fullKey, prefix, operation: "getWithMetadata" });
			}
		},

		async put(key: string, value: T, opts?: PutOptions): Promise<void> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			const serialized = serializer.serialize(value);

			const kvOptions: KVNamespacePutOptions = {};
			if (opts?.expiration) {
				kvOptions.expiration = opts.expiration;
			} else {
				const ttl = opts?.ttl ?? defaultTtl;
				if (ttl !== undefined) {
					assertValidTtl(ttl);
					kvOptions.expirationTtl = ttl;
				}
			}
			if (opts?.metadata) {
				kvOptions.metadata = opts.metadata;
			}

			try {
				await binding.put(fullKey, serialized as any, kvOptions);
			} catch (err) {
				wrapKVError(err, { key: fullKey, prefix, operation: "put" });
			}
		},

		async delete(key: string): Promise<void> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			try {
				await binding.delete(fullKey);
			} catch (err) {
				wrapKVError(err, { key: fullKey, prefix, operation: "delete" });
			}
		},

		async getMany(keys: string[], opts?: GetOptions): Promise<Map<string, T>> {
			if (keys.length === 0) return new Map();
			const fullKeys = keys.map((k) => prefixKey(prefix, k));
			try {
				const results = await batchGet<T>(binding, fullKeys, serializer.kvType);
				// Strip prefixes from result keys
				const stripped = new Map<string, T>();
				for (const [k, v] of results) {
					stripped.set(stripPrefix(prefix, k), v);
				}
				return stripped;
			} catch (err) {
				wrapKVError(err, { prefix, operation: "getMany" });
			}
		},

		async putMany(entries: KVBatchPutEntry<T>[], opts?: PutOptions): Promise<void> {
			if (entries.length === 0) return;
			const mapped = entries.map((entry) => {
				const mergedOpts = { ...opts, ...entry.options };
				const ttl = mergedOpts.ttl ?? defaultTtl;
				if (ttl !== undefined) assertValidTtl(ttl);

				const kvOpts: KVNamespacePutOptions = {};
				if (mergedOpts.expiration) {
					kvOpts.expiration = mergedOpts.expiration;
				} else if (ttl !== undefined) {
					kvOpts.expirationTtl = ttl;
				}
				if (mergedOpts.metadata) kvOpts.metadata = mergedOpts.metadata;

				return {
					key: prefixKey(prefix, entry.key),
					value: serializer.serialize(entry.value),
					options: kvOpts,
				};
			});
			try {
				await batchPut(binding, mapped);
			} catch (err) {
				wrapKVError(err, { prefix, operation: "putMany" });
			}
		},

		async deleteMany(keys: string[]): Promise<void> {
			if (keys.length === 0) return;
			const fullKeys = keys.map((k) => prefixKey(prefix, k));
			try {
				await batchDelete(binding, fullKeys);
			} catch (err) {
				wrapKVError(err, { prefix, operation: "deleteMany" });
			}
		},

		list<M = unknown>(opts?: ListOptions): AsyncIterable<KVListEntry<M>> {
			const fullPrefix = prefix + (opts?.prefix ?? "");
			return createListIterator<M>(binding, fullPrefix, prefix, opts);
		},

		async listKeys(opts?: ListOptions): Promise<KVListEntry[]> {
			const entries: KVListEntry[] = [];
			for await (const entry of this.list(opts)) {
				entries.push(entry);
			}
			return entries;
		},

		async has(key: string): Promise<boolean> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			const page = await binding.list({ prefix: fullKey, limit: 1 });
			return page.keys.some((k: any) => k.name === fullKey);
		},

		raw: binding,
	};
}
