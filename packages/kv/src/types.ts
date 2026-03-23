import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Serializer } from "./serializer";

// ─── Serializer type shorthand ────────────────────────────────────────

export type SerializerType = "json" | "text" | "arrayBuffer" | "stream";

// ─── KV Options ───────────────────────────────────────────────────────

export interface KVOptions<T = unknown> {
	/** Key prefix — automatically prepended to all keys */
	prefix?: string;

	/** Standard Schema validator for values on read */
	schema?: StandardSchemaV1<unknown, T>;

	/** Serialization format (default: 'json') */
	serializer?: "json" | "text" | Serializer<T>;

	/** Default TTL in seconds for all put operations */
	defaultTtl?: number;

	/** Default cacheTtl for get operations (CF edge cache) */
	cacheTtl?: number;

	/** @deprecated Use cacheTtl instead */
	defaultCacheTtl?: number;

	/** Whether to validate values on write too (default: false, read-only validation) */
	validateOnWrite?: boolean;
}

/** KV options without a schema (explicit generic type parameter) */
export type KVOptionsWithoutSchema<T = unknown> = Omit<KVOptions<T>, "schema">;

/** KV options with a schema (type inferred from schema) */
export interface KVOptionsWithSchema<S extends StandardSchemaV1> {
	prefix?: string;
	schema: S;
	serializer?: "json" | "text" | Serializer<StandardSchemaV1.InferOutput<S>>;
	defaultTtl?: number;
	cacheTtl?: number;
	defaultCacheTtl?: number;
	validateOnWrite?: boolean;
}

// ─── Operation Options ────────────────────────────────────────────────

export interface GetOptions {
	/** Edge cache TTL in seconds. Set to false or 0 to bypass. */
	cacheTtl?: number | false;
}

export interface KVPutOptions {
	/** TTL in seconds */
	ttl?: number;
	/** Absolute expiration timestamp (seconds since epoch) */
	expiration?: number;
	/** Arbitrary metadata (must be JSON-serializable, max 1024 bytes) */
	metadata?: unknown;
}

/** @deprecated Use KVPutOptions instead */
export type PutOptions = KVPutOptions;

export interface KVListOptions {
	/** Maximum number of keys to return per page (max 1000, default 1000) */
	limit?: number;
	/** Only return keys starting with this prefix (added after the client prefix) */
	prefix?: string;
	/** Cursor for manual pagination */
	cursor?: string;
}

/** @deprecated Use KVListOptions instead */
export type ListOptions = KVListOptions;

// ─── Result Types ─────────────────────────────────────────────────────

export interface KVGetWithMetadataResult<T, M = unknown> {
	value: T | null;
	metadata: M | null;
	cacheStatus?: string | null;
}

export interface KVEntry<T> {
	/** The key (with client prefix stripped) */
	key: string;
	/** The value (null if key exists but value couldn't be deserialized) */
	value: T | null;
	/** Expiration timestamp if set */
	expiration?: number;
	/** Metadata if present */
	metadata?: unknown;
}

export interface KVKeyEntry {
	key: string;
	expiration?: number;
	metadata?: unknown;
}

/** @deprecated Use KVKeyEntry with key field instead */
export interface KVListEntry<M = unknown> {
	/** Key name WITHOUT the namespace prefix. */
	name: string;
	/** Expiration timestamp, if set. */
	expiration?: number;
	/** Metadata attached to this key, if any. */
	metadata?: M;
}

/** @deprecated */
export interface KVListPage<M = unknown> {
	entries: KVListEntry<M>[];
	listComplete: boolean;
	cursor?: string;
}

/** @deprecated Use KVPutOptions instead */
export interface KVBatchPutEntry<T> {
	key: string;
	value: T;
	options?: KVPutOptions;
}

// ─── TypedKV Interface ────────────────────────────────────────────────

export interface TypedKV<T> {
	get(key: string, options?: GetOptions): Promise<T | null>;
	getWithMetadata<M = unknown>(
		key: string,
		options?: GetOptions,
	): Promise<KVGetWithMetadataResult<T, M>>;
	put(key: string, value: T, options?: KVPutOptions): Promise<void>;
	delete(key: string): Promise<void>;
	exists(key: string): Promise<boolean>;
	list(options?: KVListOptions): AsyncIterable<KVEntry<T>>;
	keys(options?: KVListOptions): AsyncIterable<KVKeyEntry>;
	getMany(keys: string[], options?: GetOptions): Promise<Map<string, T | null>>;
	deleteMany(keys: string[]): Promise<void>;
	readonly raw: KVNamespace;

	// Backward compat aliases
	/** @deprecated Use exists() instead */
	has(key: string): Promise<boolean>;
	/** @deprecated Use deleteMany and putMany with KVPutOptions */
	putMany(entries: KVBatchPutEntry<T>[], options?: KVPutOptions): Promise<void>;
	/** @deprecated Use list() with KVEntry instead */
	listKeys(options?: KVListOptions): Promise<KVListEntry[]>;
}

/** @deprecated Use TypedKV instead */
export type WorkkitKV<T> = TypedKV<T>;
