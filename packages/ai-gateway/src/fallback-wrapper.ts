import { FallbackExhaustedError } from "./errors";
import type { AiInput, AiOutput, RunOptions } from "./types";

/** Matcher entry accepted by `fallback({ on })`. */
export type FallbackMatcher = number | ((err: unknown) => boolean);

/**
 * A model reference that `gateway.run()` treats as a two-tier failover chain:
 * try `primary` first; if it throws an error matched by any entry in `on`,
 * try `secondary` with the same input and options.
 *
 * Created via `fallback(primary, secondary, { on, onFallback? })`.
 */
export interface FallbackModelRef {
	readonly kind: "fallback";
	readonly primary: string;
	readonly secondary: string;
	readonly on: ReadonlyArray<FallbackMatcher>;
	readonly onFallback?: (err: unknown, attempt: "primary" | "secondary") => void;
}

/**
 * Options for `fallback()`.
 *
 * - `on` — which errors from the primary trigger a fallback to the secondary.
 *   Numeric entries match `err.status` or `err.statusCode` (exact number match
 *   against the HTTP status an error carries; the check is skipped for errors
 *   without either field). Function entries receive the raw error and return
 *   `true` to fall over.
 * - `onFallback` — invoked once per tier boundary with the error that caused
 *   the transition and the attempt tier that *failed* (always `"primary"` for
 *   the primary-to-secondary transition in the two-tier shape).
 */
export interface FallbackOptions {
	on: ReadonlyArray<FallbackMatcher>;
	onFallback?: FallbackModelRef["onFallback"];
}

/**
 * Build a two-tier failover reference usable wherever `gateway.run()` accepts
 * a model. When the primary throws with a matching status code or predicate,
 * the secondary is tried with the same input and options.
 *
 * @example
 * ```ts
 * const model = fallback("claude-sonnet-4-6", "gpt-4o", {
 *   on: [401, 429, 500, 502, 503, 504],
 *   onFallback: (err, attempt) => log.warn("provider failover", { err, attempt }),
 * });
 * const result = await gateway.run(model, { prompt: "…" });
 * // result.via === "primary" | "secondary"
 * ```
 */
export function fallback(
	primary: string,
	secondary: string,
	options: FallbackOptions,
): FallbackModelRef {
	return {
		kind: "fallback",
		primary,
		secondary,
		on: options.on,
		onFallback: options.onFallback,
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isFallbackMatcher(value: unknown): value is FallbackMatcher {
	return typeof value === "number" || typeof value === "function";
}

/**
 * Narrow an unknown value to a `FallbackModelRef`. Validates the discriminant
 * tag AND that `primary`/`secondary` are non-empty strings and `on` is an
 * array of numbers or predicates. Rejecting malformed shapes here avoids
 * confusing runtime failures deeper in `runWithFallback` for JS callers
 * (where TS's structural checks are absent).
 */
export function isFallbackModelRef(value: unknown): value is FallbackModelRef {
	if (typeof value !== "object" || value === null) return false;
	const v = value as {
		kind?: unknown;
		primary?: unknown;
		secondary?: unknown;
		on?: unknown;
	};
	if (v.kind !== "fallback") return false;
	if (!isNonEmptyString(v.primary)) return false;
	if (!isNonEmptyString(v.secondary)) return false;
	if (!Array.isArray(v.on)) return false;
	return v.on.every(isFallbackMatcher);
}

/**
 * Produce a stable, human-readable label for a model reference. Used by
 * wrappers like `withCache` (as part of the cache key) and `withLogging` (as
 * the log label) so a `FallbackModelRef` doesn't stringify to
 * `"[object Object]"`.
 */
export function modelLabel(model: string | FallbackModelRef): string {
	if (typeof model === "string") return model;
	return `fallback:${model.primary}→${model.secondary}`;
}

/**
 * Test whether `err` matches any entry in the `on` list.
 *
 * Numeric entries match when the error (or any error in its `.cause` chain)
 * exposes a matching HTTP status — checked against `err.status`,
 * `err.context?.status` (the field gateway providers attach to their
 * wrapped errors), and `err.statusCode` (the canonical field every
 * `WorkkitError` carries). Walking the cause chain lets a wrapped
 * `ServiceUnavailableError` still trigger a `401` matcher when the
 * underlying provider error was a 401. Function entries are called with
 * the raw error.
 */
export function matchesFallback(err: unknown, matchers: ReadonlyArray<FallbackMatcher>): boolean {
	const statuses = collectStatuses(err);
	for (const matcher of matchers) {
		if (typeof matcher === "number") {
			if (statuses.has(matcher)) return true;
			continue;
		}
		try {
			if (matcher(err)) return true;
		} catch {
			// Predicate threw — treat as non-match rather than masking the
			// original error with the predicate's failure.
		}
	}
	return false;
}

function collectStatuses(err: unknown): Set<number> {
	const out = new Set<number>();
	let current: unknown = err;
	// Cap depth to avoid pathological circular `.cause` graphs.
	for (let depth = 0; depth < 8 && current !== null && typeof current === "object"; depth++) {
		const candidate = current as {
			status?: unknown;
			statusCode?: unknown;
			context?: { status?: unknown };
			cause?: unknown;
		};
		if (typeof candidate.status === "number") out.add(candidate.status);
		if (typeof candidate.statusCode === "number") out.add(candidate.statusCode);
		const ctxStatus = candidate.context?.status;
		if (typeof ctxStatus === "number") out.add(ctxStatus);
		if (candidate.cause === current) break;
		current = candidate.cause;
	}
	return out;
}

/**
 * Internal: run `ref` against a single-model runner, applying the two-tier
 * failover policy. `runOne` is invoked once for the primary and at most once
 * more for the secondary; the same `input` and `options` are passed through
 * to both so observability hooks, timeouts, and response-format preferences
 * apply identically to each tier.
 *
 * Used by `gateway.run()` when it receives a `FallbackModelRef`. Exposed
 * from this module (not `index.ts`) so gateway wrappers — `withRetry`,
 * `withCache`, `withLogging` — can reuse the same dispatch if they ever
 * need to forward fallback refs themselves.
 */
export async function runWithFallback(
	ref: FallbackModelRef,
	input: AiInput,
	options: RunOptions | undefined,
	runOne: (model: string, input: AiInput, options?: RunOptions) => Promise<AiOutput>,
): Promise<AiOutput> {
	let primaryError: unknown;
	try {
		const result = await runOne(ref.primary, input, options);
		return { ...result, via: "primary" };
	} catch (err) {
		if (!matchesFallback(err, ref.on)) throw err;
		primaryError = err;
		// onFallback is an observability hook — swallow throws so a broken
		// logger/metrics emitter never blocks the actual secondary attempt.
		try {
			ref.onFallback?.(err, "primary");
		} catch {
			// ignored intentionally
		}
	}
	try {
		const result = await runOne(ref.secondary, input, options);
		return { ...result, via: "secondary" };
	} catch (secondaryError) {
		throw new FallbackExhaustedError(primaryError, secondaryError);
	}
}

export { FallbackExhaustedError };
