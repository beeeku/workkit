/**
 * Model allowlist — a tiny helper for validating `?model=` query-param
 * overrides (or any other untrusted model string) against a curated
 * per-provider list.
 *
 * Typical use: a dev/staging endpoint lets engineers flip models via a query
 * param; you still want to keep traffic on contracted models only.
 *
 * @example
 * ```ts
 * import { createModelAllowlist } from "@workkit/ai-gateway/allowlist";
 *
 * const allow = createModelAllowlist({
 *   anthropic: ["claude-opus-4-7", "claude-sonnet-4-6"],
 *   openai:    ["gpt-4o", "gpt-4o-mini"],
 *   groq:      [{ prefix: "llama-3.1-" }],
 * });
 *
 * if (!allow.isAllowed("anthropic", requested)) {
 *   return new Response("model not in allowlist", { status: 400 });
 * }
 * ```
 */

/** A prefix-match rule: `model.startsWith(prefix)`. */
export interface ModelRule {
	prefix: string;
}

/** Either an exact-match string or a prefix rule. */
export type ModelMatcher = string | ModelRule;

/** Per-provider allowlist map: provider key → list of matchers. */
export type AllowlistConfig = Record<string, readonly ModelMatcher[]>;

/** Pre-compiled allowlist with an `isAllowed` predicate. */
export interface ModelAllowlist {
	/** Return `true` when `model` matches any matcher configured for `provider`. */
	isAllowed(provider: string, model: string): boolean;
}

function matches(matcher: ModelMatcher, model: string): boolean {
	if (typeof matcher === "string") return matcher === model;
	return model.startsWith(matcher.prefix);
}

/**
 * Compile an {@link AllowlistConfig} into a {@link ModelAllowlist}.
 *
 * Semantics:
 * - Exact string matcher — strict equality with the model.
 * - `{ prefix }` matcher — `model.startsWith(prefix)`.
 * - Unknown provider — returns `false`.
 * - Empty matcher array — returns `false`.
 */
export function createModelAllowlist(config: AllowlistConfig): ModelAllowlist {
	return {
		isAllowed(provider, model) {
			const matchers = config[provider];
			if (!matchers || matchers.length === 0) return false;
			for (const m of matchers) {
				if (matches(m, model)) return true;
			}
			return false;
		},
	};
}

/**
 * Functional form of {@link createModelAllowlist}. Useful for one-off checks
 * where you don't want to hold onto a compiled instance.
 *
 * Semantically identical to `createModelAllowlist(config).isAllowed(provider, model)`.
 */
export function isAllowedModel(
	config: AllowlistConfig,
	provider: string,
	model: string,
): boolean {
	return createModelAllowlist(config).isAllowed(provider, model);
}
