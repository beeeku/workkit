// --- Brand infrastructure ---

declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]: B }

// --- Branded string types ---

/** A KV namespace key */
export type KVKey = Brand<string, 'KVKey'>

/** A D1 row identifier */
export type D1RowId = Brand<string, 'D1RowId'>

/** An R2 object key */
export type R2ObjectKey = Brand<string, 'R2ObjectKey'>

/** A Durable Object ID (hex string) */
export type DurableObjectId = Brand<string, 'DurableObjectId'>

/** A Queue message ID */
export type QueueMessageId = Brand<string, 'QueueMessageId'>

// --- Brand constructors (zero-cost cast functions) ---

export function kvKey(key: string): KVKey {
	return key as KVKey
}

export function d1RowId(id: string): D1RowId {
	return id as D1RowId
}

export function r2ObjectKey(key: string): R2ObjectKey {
	return key as R2ObjectKey
}

export function durableObjectId(id: string): DurableObjectId {
	return id as DurableObjectId
}

export function queueMessageId(id: string): QueueMessageId {
	return id as QueueMessageId
}

// --- Generic brand utility (for user-defined brands) ---

export type Branded<T, B extends string> = Brand<T, B>

export function brand<T, B extends string>(value: T): Branded<T, B> {
	return value as Branded<T, B>
}
