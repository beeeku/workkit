// --- Async helpers ---

/** A value that may or may not be wrapped in a Promise */
export type MaybePromise<T> = T | Promise<T>;

// --- Object helpers ---

/** Flatten an intersection into a single object type (improves IDE display) */
export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

/** Make specific keys required */
export type RequireKeys<T, K extends keyof T> = Prettify<Omit<T, K> & Required<Pick<T, K>>>;

/** Make specific keys optional */
export type OptionalKeys<T, K extends keyof T> = Prettify<Omit<T, K> & Partial<Pick<T, K>>>;

/** Extract keys whose values extend a given type */
export type KeysMatching<T, V> = {
	[K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

// --- String helpers ---

/** Enforce a string starts with a given prefix */
export type StringWithPrefix<P extends string> = `${P}${string}`;

/** KV key with prefix — e.g., StringWithPrefix<'user:'> */
export type PrefixedKey<P extends string> = StringWithPrefix<P>;

// --- Tuple helpers ---

/** A non-empty array */
export type NonEmptyArray<T> = [T, ...T[]];

// --- Exhaustive check ---

/** Use in switch default to get compile error if a case is missed */
export function assertNever(value: never): never {
	throw new Error(`Unexpected value: ${value}`);
}

// --- Record helpers ---

/** Like Record but with better inference */
export type Dict<T> = Record<string, T>;

/** A readonly dictionary */
export type ReadonlyDict<T> = Readonly<Record<string, T>>;
