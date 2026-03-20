// --- Core Result type ---

export type Result<T, E = Error> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E }

// --- Constructors (runtime, but tiny — these ship as JS) ---

export function Ok<T>(value: T): Result<T, never> {
	return { ok: true, value }
}

export function Err<E>(error: E): Result<never, E> {
	return { ok: false, error }
}

// --- Type guards ---

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
	return result.ok === true
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
	return result.ok === false
}

// --- Unwrap (throws if Err — escape hatch) ---

export function unwrap<T, E>(result: Result<T, E>): T {
	if (result.ok) return result.value
	throw result.error instanceof Error ? result.error : new Error(String(result.error))
}

// --- Infer helpers ---

export type InferOk<R> = R extends Result<infer T, any> ? T : never
export type InferErr<R> = R extends Result<any, infer E> ? E : never

// --- Async Result ---

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>
