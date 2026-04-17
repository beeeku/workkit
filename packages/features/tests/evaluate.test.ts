import { describe, expect, it } from "vitest";
import { evaluateFlag, evaluateVariant, matchesRule } from "../src/evaluate";
import type { FlagContext, FlagDefinition, TargetingRule } from "../src/types";

describe("evaluateFlag", () => {
	it("returns false when flag is disabled", () => {
		const flag: FlagDefinition = { key: "test", enabled: false };
		expect(evaluateFlag(flag, {}, 50)).toBe(false);
	});

	it("returns true when flag is enabled with no constraints", () => {
		const flag: FlagDefinition = { key: "test", enabled: true };
		expect(evaluateFlag(flag, {}, 50)).toBe(true);
	});

	it("respects percentage rollout — hash below percentage", () => {
		const flag: FlagDefinition = { key: "test", enabled: true, percentage: 50 };
		expect(evaluateFlag(flag, {}, 25)).toBe(true);
	});

	it("respects percentage rollout — hash at or above percentage", () => {
		const flag: FlagDefinition = { key: "test", enabled: true, percentage: 50 };
		expect(evaluateFlag(flag, {}, 50)).toBe(false);
		expect(evaluateFlag(flag, {}, 75)).toBe(false);
	});

	it("returns true for 100% rollout", () => {
		const flag: FlagDefinition = { key: "test", enabled: true, percentage: 100 };
		expect(evaluateFlag(flag, {}, 99)).toBe(true);
	});

	it("returns false for 0% rollout", () => {
		const flag: FlagDefinition = { key: "test", enabled: true, percentage: 0 };
		expect(evaluateFlag(flag, {}, 0)).toBe(false);
	});

	it("checks overrides before anything else", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			percentage: 0,
			overrides: { "user-1": true },
		};
		expect(evaluateFlag(flag, { userId: "user-1" }, 99)).toBe(true);
	});

	it("override can force disable", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			overrides: { "user-1": false },
		};
		expect(evaluateFlag(flag, { userId: "user-1" }, 0)).toBe(false);
	});

	it("applies targeting rules — all must match", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			targeting: [
				{ attribute: "plan", operator: "eq", values: ["pro"] },
				{ attribute: "country", operator: "eq", values: ["US"] },
			],
		};
		const matchCtx: FlagContext = { userId: "u1", plan: "pro", country: "US" };
		const missCtx: FlagContext = { userId: "u1", plan: "pro", country: "UK" };
		expect(evaluateFlag(flag, matchCtx, 50)).toBe(true);
		expect(evaluateFlag(flag, missCtx, 50)).toBe(false);
	});

	it("targeting rules combine with percentage", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			percentage: 50,
			targeting: [{ attribute: "plan", operator: "eq", values: ["pro"] }],
		};
		const ctx: FlagContext = { userId: "u1", plan: "pro" };
		expect(evaluateFlag(flag, ctx, 25)).toBe(true);
		expect(evaluateFlag(flag, ctx, 75)).toBe(false);
	});

	it("targeting miss short-circuits before percentage check", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			percentage: 100,
			targeting: [{ attribute: "plan", operator: "eq", values: ["pro"] }],
		};
		const ctx: FlagContext = { userId: "u1", plan: "free" };
		expect(evaluateFlag(flag, ctx, 0)).toBe(false);
	});
});

describe("evaluateVariant", () => {
	it("returns null when no variants defined", () => {
		const flag: FlagDefinition = { key: "test", enabled: true };
		expect(evaluateVariant(flag, {}, 50)).toBeNull();
	});

	it("returns null for empty variants", () => {
		const flag: FlagDefinition = { key: "test", enabled: true, variants: {} };
		expect(evaluateVariant(flag, {}, 50)).toBeNull();
	});

	it("maps hash to correct variant based on weights", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			variants: { control: 50, treatment: 50 },
		};
		// hash 0-49 should map to control, 50-99 to treatment
		expect(evaluateVariant(flag, {}, 25)).toBe("control");
		expect(evaluateVariant(flag, {}, 75)).toBe("treatment");
	});

	it("handles uneven weights", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			variants: { a: 10, b: 80, c: 10 },
		};
		// hash 0 maps to 0% of total weight (100), a covers 0-10
		expect(evaluateVariant(flag, {}, 5)).toBe("a");
		// hash 50 maps to 50% of total weight → 50, b covers 10-90
		expect(evaluateVariant(flag, {}, 50)).toBe("b");
		// hash 95 maps to 95% of total weight → 95, c covers 90-100
		expect(evaluateVariant(flag, {}, 95)).toBe("c");
	});

	it("respects variant override", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			variants: { control: 50, treatment: 50 },
			overrides: { "user-1": "treatment" },
		};
		// Even though hash would map to control, override wins
		expect(evaluateVariant(flag, { userId: "user-1" }, 0)).toBe("treatment");
	});

	it("ignores override that is not a valid variant", () => {
		const flag: FlagDefinition = {
			key: "test",
			enabled: true,
			variants: { control: 50, treatment: 50 },
			overrides: { "user-1": "nonexistent" },
		};
		// Should fall through to hash-based assignment
		expect(evaluateVariant(flag, { userId: "user-1" }, 25)).toBe("control");
	});
});

describe("matchesRule", () => {
	const ctx: FlagContext = {
		userId: "user-1",
		plan: "pro",
		country: "US",
		age: 25,
		email: "test@example.com",
	};

	it("eq — matches when value equals", () => {
		const rule: TargetingRule = { attribute: "plan", operator: "eq", values: ["pro"] };
		expect(matchesRule(rule, ctx)).toBe(true);
	});

	it("eq — fails when value differs", () => {
		const rule: TargetingRule = { attribute: "plan", operator: "eq", values: ["free"] };
		expect(matchesRule(rule, ctx)).toBe(false);
	});

	it("neq — matches when value differs", () => {
		const rule: TargetingRule = { attribute: "plan", operator: "neq", values: ["free"] };
		expect(matchesRule(rule, ctx)).toBe(true);
	});

	it("neq — fails when value equals", () => {
		const rule: TargetingRule = { attribute: "plan", operator: "neq", values: ["pro"] };
		expect(matchesRule(rule, ctx)).toBe(false);
	});

	it("in — matches when value is in the list", () => {
		const rule: TargetingRule = {
			attribute: "country",
			operator: "in",
			values: ["US", "CA", "UK"],
		};
		expect(matchesRule(rule, ctx)).toBe(true);
	});

	it("in — fails when value is not in the list", () => {
		const rule: TargetingRule = {
			attribute: "country",
			operator: "in",
			values: ["CA", "UK"],
		};
		expect(matchesRule(rule, ctx)).toBe(false);
	});

	it("notIn — matches when value is not in the list", () => {
		const rule: TargetingRule = {
			attribute: "country",
			operator: "notIn",
			values: ["CA", "UK"],
		};
		expect(matchesRule(rule, ctx)).toBe(true);
	});

	it("notIn — fails when value is in the list", () => {
		const rule: TargetingRule = {
			attribute: "country",
			operator: "notIn",
			values: ["US", "UK"],
		};
		expect(matchesRule(rule, ctx)).toBe(false);
	});

	it("gt — matches when value is greater", () => {
		const rule: TargetingRule = { attribute: "age", operator: "gt", values: [18] };
		expect(matchesRule(rule, ctx)).toBe(true);
	});

	it("gt — fails when value is not greater", () => {
		const rule: TargetingRule = { attribute: "age", operator: "gt", values: [30] };
		expect(matchesRule(rule, ctx)).toBe(false);
	});

	it("lt — matches when value is less", () => {
		const rule: TargetingRule = { attribute: "age", operator: "lt", values: [30] };
		expect(matchesRule(rule, ctx)).toBe(true);
	});

	it("lt — fails when value is not less", () => {
		const rule: TargetingRule = { attribute: "age", operator: "lt", values: [18] };
		expect(matchesRule(rule, ctx)).toBe(false);
	});

	it("contains — matches when string contains value", () => {
		const rule: TargetingRule = {
			attribute: "email",
			operator: "contains",
			values: ["@example.com"],
		};
		expect(matchesRule(rule, ctx)).toBe(true);
	});

	it("contains — fails when string does not contain value", () => {
		const rule: TargetingRule = {
			attribute: "email",
			operator: "contains",
			values: ["@other.com"],
		};
		expect(matchesRule(rule, ctx)).toBe(false);
	});

	it("returns false for undefined attribute", () => {
		const rule: TargetingRule = {
			attribute: "nonexistent",
			operator: "eq",
			values: ["anything"],
		};
		expect(matchesRule(rule, ctx)).toBe(false);
	});
});
