// ─── Core factory ─────────────────────────────────────────────────────
export { kv } from "./client";

// ─── Types ────────────────────────────────────────────────────────────
export type {
	TypedKV,
	WorkkitKV,
	KVOptions,
	KVOptionsWithoutSchema,
	KVOptionsWithSchema,
	KVPutOptions,
	KVListOptions,
	KVEntry,
	KVKeyEntry,
	KVGetWithMetadataResult,
	// Backward compat
	GetOptions,
	PutOptions,
	ListOptions,
	KVListEntry,
	KVListPage,
	KVBatchPutEntry,
	SerializerType,
} from "./types";

// ─── Errors ───────────────────────────────────────────────────────────
export {
	KVError,
	KVNotFoundError,
	KVValidationError,
	KVSerializationError,
} from "./kv-errors";

// Backward compat error utilities
export { wrapKVError, assertKVBinding, assertValidTtl } from "./errors";
export type { KVErrorContext } from "./errors";

// ─── Serialization ────────────────────────────────────────────────────
export type { Serializer } from "./serializer";
export { jsonSerializer, textSerializer, resolveSerializer } from "./serializer";

// ─── Prefix utilities ─────────────────────────────────────────────────
export { prefixKey, stripPrefix, combinePrefixes } from "./prefix";

// Backward compat
export { validateKey } from "./utils";

// ─── Validation ───────────────────────────────────────────────────────
export { validateValue } from "./validation";
