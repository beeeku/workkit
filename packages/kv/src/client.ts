import type { StandardSchemaV1 } from "@standard-schema/spec";
import { assertKVBinding, assertValidTtl, wrapKVError } from "./errors";
import { createKeysIterator, createValueListIterator } from "./iterator";
import { KVSerializationError } from "./kv-errors";
import { combinePrefixes, prefixKey, stripPrefix } from "./prefix";
import { resolveSerializer } from "./serializer";
import type {
	GetOptions,
	KVBatchPutEntry,
	KVEntry,
	KVGetWithMetadataResult,
	KVKeyEntry,
	KVListEntry,
	KVListOptions,
	KVOptions,
	KVOptionsWithSchema,
	KVOptionsWithoutSchema,
	KVPutOptions,
	TypedKV,
} from "./types";
import { validateKey } from "./utils";
import { validateValue } from "./validation";

/**
 * Overload 1: Explicit type parameter, no schema
 */
export function kv<T>(namespace: KVNamespace, options?: KVOptionsWithoutSchema<T>): TypedKV<T>;

/**
 * Overload 2: Type inferred from schema
 */
export function kv<S extends StandardSchemaV1>(
	namespace: KVNamespace,
	options: KVOptionsWithSchema<S>,
): TypedKV<StandardSchemaV1.InferOutput<S>>;

/**
 * Implementation signature
 */
export function kv<T = unknown>(namespace: KVNamespace, options?: KVOptions<T>): TypedKV<T> {
	assertKVBinding(namespace);

	const prefix = options?.prefix ?? "";
	const serializer = resolveSerializer<T>(options?.serializer);
	const schema = options?.schema;
	const defaultTtl = options?.defaultTtl;
	const cacheTtl = options?.cacheTtl ?? options?.defaultCacheTtl;
	const validateOnWrite = options?.validateOnWrite ?? false;

	const client: TypedKV<T> = {
		async get(key: string, opts?: GetOptions): Promise<T | null> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			const effectiveCacheTtl = opts?.cacheTtl ?? cacheTtl;

			try {
				const raw = await namespace.get(fullKey, {
					type: "text" as any,
					cacheTtl: effectiveCacheTtl === false ? undefined : effectiveCacheTtl,
				});
				if (raw === null) return null;

				let value: T;
				try {
					value = serializer.deserialize(raw as string);
				} catch (err) {
					throw new KVSerializationError("deserialize", key, err);
				}

				if (schema) {
					value = await validateValue(schema, value, key);
				}

				return value;
			} catch (err) {
				if (
					err instanceof KVSerializationError ||
					err?.constructor?.name === "KVValidationError" ||
					(err as any)?.code === "WORKKIT_VALIDATION"
				) {
					throw err;
				}
				wrapKVError(err, { key: fullKey, prefix, operation: "get" });
			}
		},

		async getWithMetadata<M = unknown>(
			key: string,
			opts?: GetOptions,
		): Promise<KVGetWithMetadataResult<T, M>> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			const effectiveCacheTtl = opts?.cacheTtl ?? cacheTtl;

			try {
				const result = await namespace.getWithMetadata(fullKey, {
					type: "text" as any,
					cacheTtl: effectiveCacheTtl === false ? undefined : effectiveCacheTtl,
				});

				if (result.value === null) {
					return {
						value: null,
						metadata: (result.metadata as M) ?? null,
						cacheStatus: (result as any).cacheStatus ?? null,
					};
				}

				let value: T;
				try {
					value = serializer.deserialize(result.value as string);
				} catch (err) {
					throw new KVSerializationError("deserialize", key, err);
				}

				if (schema) {
					value = await validateValue(schema, value, key);
				}

				return {
					value,
					metadata: (result.metadata as M) ?? null,
					cacheStatus: (result as any).cacheStatus ?? null,
				};
			} catch (err) {
				if (
					err instanceof KVSerializationError ||
					err?.constructor?.name === "KVValidationError" ||
					(err as any)?.code === "WORKKIT_VALIDATION"
				) {
					throw err;
				}
				wrapKVError(err, {
					key: fullKey,
					prefix,
					operation: "getWithMetadata",
				});
			}
		},

		async put(key: string, value: T, putOptions?: KVPutOptions): Promise<void> {
			validateKey(key);

			if (validateOnWrite && schema) {
				await validateValue(schema, value, key);
			}

			const fullKey = prefixKey(prefix, key);

			let serialized: string | ArrayBuffer | ReadableStream;
			try {
				serialized = serializer.serialize(value);
			} catch (err) {
				throw new KVSerializationError("serialize", key, err);
			}

			const kvOpts: KVNamespacePutOptions = {};
			if (putOptions?.expiration) {
				kvOpts.expiration = putOptions.expiration;
			} else {
				const ttl = putOptions?.ttl ?? defaultTtl;
				if (ttl !== undefined) {
					assertValidTtl(ttl);
					kvOpts.expirationTtl = ttl;
				}
			}
			if (putOptions?.metadata !== undefined) {
				kvOpts.metadata = putOptions.metadata as any;
			}

			try {
				await namespace.put(fullKey, serialized as any, kvOpts);
			} catch (err) {
				wrapKVError(err, { key: fullKey, prefix, operation: "put" });
			}
		},

		async delete(key: string): Promise<void> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			try {
				await namespace.delete(fullKey);
			} catch (err) {
				wrapKVError(err, { key: fullKey, prefix, operation: "delete" });
			}
		},

		async exists(key: string): Promise<boolean> {
			validateKey(key);
			const fullKey = prefixKey(prefix, key);
			const result = await namespace.getWithMetadata(fullKey, "text");
			return result.value !== null;
		},

		list(listOptions?: KVListOptions): AsyncIterable<KVEntry<T>> {
			const listPrefix = combinePrefixes(prefix || undefined, listOptions?.prefix);
			const iterator = createValueListIterator<T>(namespace, {
				prefix: listPrefix,
				limit: listOptions?.limit,
				serializer,
				schema,
			});

			// Wrap to strip prefix from yielded keys
			return {
				[Symbol.asyncIterator]: () => {
					const inner = iterator[Symbol.asyncIterator]();
					return {
						async next() {
							const result = await inner.next();
							if (result.done) return result;
							const strippedKey = stripPrefix(prefix || undefined, result.value.key);
							return {
								done: false as const,
								value: {
									...result.value,
									key: strippedKey,
									// Backward compat: old KVListEntry used 'name'
									name: strippedKey,
								} as KVEntry<T>,
							};
						},
					};
				},
			} as AsyncIterable<KVEntry<T>>;
		},

		keys(listOptions?: KVListOptions): AsyncIterable<KVKeyEntry> {
			const listPrefix = combinePrefixes(prefix || undefined, listOptions?.prefix);
			const iterator = createKeysIterator(namespace, {
				prefix: listPrefix,
				limit: listOptions?.limit,
			});

			return {
				[Symbol.asyncIterator]: () => {
					const inner = iterator[Symbol.asyncIterator]();
					return {
						async next() {
							const result = await inner.next();
							if (result.done) return result;
							return {
								done: false as const,
								value: {
									...result.value,
									key: stripPrefix(prefix || undefined, result.value.key),
								},
							};
						},
					};
				},
			} as AsyncIterable<KVKeyEntry>;
		},

		async getMany(keys: string[], _opts?: GetOptions): Promise<Map<string, T | null>> {
			const results = new Map<string, T | null>();
			if (keys.length === 0) return results;
			const entries = await Promise.all(
				keys.map(async (key) => {
					const value = await client.get(key);
					return [key, value] as const;
				}),
			);
			for (const [key, value] of entries) {
				results.set(key, value);
			}
			return results;
		},

		async deleteMany(keys: string[]): Promise<void> {
			if (keys.length === 0) return;
			await Promise.all(keys.map((key) => client.delete(key)));
		},

		// ── Backward compat methods ──────────────────────────────────

		async has(key: string): Promise<boolean> {
			return client.exists(key);
		},

		async putMany(entries: KVBatchPutEntry<T>[], opts?: KVPutOptions): Promise<void> {
			if (entries.length === 0) return;
			await Promise.all(
				entries.map((entry) => {
					const mergedOpts = { ...opts, ...entry.options };
					return client.put(entry.key, entry.value, mergedOpts);
				}),
			);
		},

		async listKeys(opts?: KVListOptions): Promise<KVListEntry[]> {
			const entries: KVListEntry[] = [];
			const fullPrefix = (prefix || "") + (opts?.prefix ?? "");
			let cursor: string | undefined = opts?.cursor;
			const limit = opts?.limit ?? 1000;

			do {
				const page = await namespace.list<unknown>({
					prefix: fullPrefix || undefined,
					limit,
					cursor,
				});

				for (const key of page.keys) {
					entries.push({
						name: prefix ? key.name.slice(prefix.length) : key.name,
						expiration: key.expiration,
						metadata: key.metadata as any,
					});
				}

				if (page.list_complete) break;
				cursor = page.cursor;
			} while (cursor);

			return entries;
		},

		get raw() {
			return namespace;
		},
	};

	return client;
}
