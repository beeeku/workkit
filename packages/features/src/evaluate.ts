import type { FlagContext, FlagDefinition, TargetingRule } from "./types";

/**
 * Evaluate whether a flag is enabled for the given context.
 *
 * Evaluation order:
 * 1. If flag is disabled, return false
 * 2. Check overrides for the userId
 * 3. Check targeting rules (ALL must match)
 * 4. Check percentage rollout using the deterministic hash
 * 5. If enabled with no percentage constraint, return true
 */
export function evaluateFlag(flag: FlagDefinition, context: FlagContext, hash: number): boolean {
	if (!flag.enabled) return false;

	// Check user-level overrides (boolean only — string overrides are for variant selection)
	if (context.userId && flag.overrides) {
		const override = flag.overrides[context.userId];
		if (typeof override === "boolean") {
			return override;
		}
		// String overrides are handled by evaluateVariant, treat as enabled here
		if (typeof override === "string") {
			return true;
		}
	}

	// Check targeting rules — all must match (AND logic)
	if (flag.targeting && flag.targeting.length > 0) {
		const allMatch = flag.targeting.every((rule) => matchesRule(rule, context));
		if (!allMatch) return false;
	}

	// Check percentage rollout
	if (flag.percentage !== undefined) {
		return hash < flag.percentage;
	}

	// Enabled with no percentage constraint
	return true;
}

/**
 * Evaluate which variant a user should see.
 *
 * Maps the hash value into weighted variant buckets.
 * Returns null if no variants are defined.
 */
export function evaluateVariant(
	flag: FlagDefinition,
	context: FlagContext,
	hash: number,
): string | null {
	if (!flag.variants) return null;

	// Check overrides for variant assignment
	if (context.userId && flag.overrides) {
		const override = flag.overrides[context.userId];
		if (typeof override === "string") {
			// Return override only if it matches a defined variant; otherwise return null
			// to surface misconfiguration (typo, removed variant) rather than silently bucketing
			return override in flag.variants ? override : null;
		}
	}

	const entries = Object.entries(flag.variants);
	if (entries.length === 0) return null;

	const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
	if (totalWeight === 0) return null;

	// Scale hash to the total weight range
	const target = (hash / 100) * totalWeight;
	let cumulative = 0;
	for (const [variant, weight] of entries) {
		cumulative += weight;
		if (target < cumulative) return variant;
	}

	// Fallback to last variant (handles floating-point edge case)
	return entries[entries.length - 1][0];
}

/**
 * Check if a single targeting rule matches the given context.
 */
export function matchesRule(rule: TargetingRule, context: FlagContext): boolean {
	const value = context[rule.attribute];
	if (value === undefined) return false;

	switch (rule.operator) {
		case "eq":
			return rule.values.some((v) => v === value);
		case "neq":
			return rule.values.every((v) => v !== value);
		case "in":
			return rule.values.includes(value as string | number);
		case "notIn":
			return !rule.values.includes(value as string | number);
		case "gt":
			return typeof value === "number" && rule.values.some((v) => value > Number(v));
		case "lt":
			return typeof value === "number" && rule.values.some((v) => value < Number(v));
		case "contains":
			return typeof value === "string" && rule.values.some((v) => value.includes(String(v)));
		default:
			return false;
	}
}
