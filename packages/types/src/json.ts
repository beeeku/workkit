// --- JSON primitive types ---

export type JsonPrimitive = string | number | boolean | null

// --- Recursive JSON value ---

export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export interface JsonObject {
	[key: string]: JsonValue
}

export type JsonArray = JsonValue[]

// --- Serializable constraint (for generic parameters) ---

/**
 * Constrains T to be JSON-serializable.
 * Use as a bound: `function store<T extends JsonSerializable<T>>(value: T)`
 * This catches functions, symbols, undefined, BigInt, etc. at compile time.
 */
export type JsonSerializable<T> = T extends JsonPrimitive
	? T
	: T extends readonly (infer U)[]
		? JsonSerializable<U>[]
		: T extends Record<string, unknown>
			? { [K in keyof T]: JsonSerializable<T[K]> }
			: never

// --- JSON parse result (typed alternative to JSON.parse) ---

export type JsonParsed<T> = T extends string ? JsonValue : T extends JsonValue ? T : never

// --- Deep partial (useful for KV patch operations) ---

export type DeepPartial<T> = T extends JsonPrimitive
	? T
	: T extends readonly (infer U)[]
		? readonly DeepPartial<U>[]
		: T extends Record<string, unknown>
			? { [K in keyof T]?: DeepPartial<T[K]> }
			: T

// --- Deep readonly (useful for cached/immutable data) ---

export type DeepReadonly<T> = T extends JsonPrimitive
	? T
	: T extends readonly (infer U)[]
		? readonly DeepReadonly<U>[]
		: T extends Record<string, unknown>
			? { readonly [K in keyof T]: DeepReadonly<T[K]> }
			: T
