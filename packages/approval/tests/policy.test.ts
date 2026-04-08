import { describe, expect, it } from "vitest";
import { evaluatePolicies, globMatch, matchesPolicy } from "../src/policy";
import type { ActionDescriptor, PolicyDefinition, PolicyMatcher } from "../src/types";

describe("globMatch", () => {
	it("matches exact strings", () => {
		expect(globMatch("deploy:production", "deploy:production")).toBe(true);
		expect(globMatch("deploy:production", "deploy:staging")).toBe(false);
	});

	it("matches wildcard at end", () => {
		expect(globMatch("deploy:*", "deploy:production")).toBe(true);
		expect(globMatch("deploy:*", "deploy:staging")).toBe(true);
		expect(globMatch("deploy:*", "delete:production")).toBe(false);
	});

	it("matches wildcard in middle", () => {
		expect(globMatch("mcp:*-drop", "mcp:database-drop")).toBe(true);
		expect(globMatch("mcp:*-drop", "mcp:table-drop")).toBe(true);
		expect(globMatch("mcp:*-drop", "mcp:database-create")).toBe(false);
	});

	it("matches single wildcard", () => {
		expect(globMatch("*", "anything")).toBe(true);
	});
});

describe("matchesPolicy", () => {
	const action: ActionDescriptor = {
		name: "deploy:production",
		requestedBy: "alice",
		cost: { amount: 5000, currency: "USD" },
		risk: "high",
		tags: ["production", "deploy", "infrastructure"],
	};

	it("TagMatcher: allOf", () => {
		expect(matchesPolicy(action, { type: "tag", allOf: ["production", "deploy"] })).toBe(true);
		expect(matchesPolicy(action, { type: "tag", allOf: ["production", "staging"] })).toBe(false);
	});

	it("TagMatcher: anyOf", () => {
		expect(matchesPolicy(action, { type: "tag", anyOf: ["staging", "production"] })).toBe(true);
		expect(matchesPolicy(action, { type: "tag", anyOf: ["staging", "development"] })).toBe(false);
	});

	it("TagMatcher: noneOf", () => {
		expect(matchesPolicy(action, { type: "tag", noneOf: ["staging"] })).toBe(true);
		expect(matchesPolicy(action, { type: "tag", noneOf: ["production"] })).toBe(false);
	});

	it("CostMatcher: threshold", () => {
		expect(matchesPolicy(action, { type: "cost", greaterThanOrEqual: 1000 })).toBe(true);
		expect(matchesPolicy(action, { type: "cost", greaterThanOrEqual: 10000 })).toBe(false);
	});

	it("CostMatcher: currency filter", () => {
		expect(matchesPolicy(action, { type: "cost", greaterThanOrEqual: 1000, currency: "USD" })).toBe(
			true,
		);
		expect(matchesPolicy(action, { type: "cost", greaterThanOrEqual: 1000, currency: "EUR" })).toBe(
			false,
		);
	});

	it("CostMatcher: no cost on action", () => {
		const noCost: ActionDescriptor = { name: "test", requestedBy: "alice" };
		expect(matchesPolicy(noCost, { type: "cost", greaterThanOrEqual: 0 })).toBe(false);
	});

	it("RiskMatcher: level comparison", () => {
		expect(matchesPolicy(action, { type: "risk", minLevel: "medium" })).toBe(true);
		expect(matchesPolicy(action, { type: "risk", minLevel: "high" })).toBe(true);
		expect(matchesPolicy(action, { type: "risk", minLevel: "critical" })).toBe(false);
	});

	it("NameMatcher: glob", () => {
		expect(matchesPolicy(action, { type: "name", pattern: "deploy:*" })).toBe(true);
		expect(matchesPolicy(action, { type: "name", pattern: "delete:*" })).toBe(false);
	});

	it("CustomMatcher: predicate", () => {
		expect(matchesPolicy(action, { type: "custom", fn: (a) => a.requestedBy === "alice" })).toBe(
			true,
		);
		expect(matchesPolicy(action, { type: "custom", fn: (a) => a.requestedBy === "bob" })).toBe(
			false,
		);
	});

	it("CompositeMatcher: all", () => {
		expect(
			matchesPolicy(action, {
				type: "all",
				matchers: [
					{ type: "tag", allOf: ["production"] },
					{ type: "risk", minLevel: "high" },
				],
			}),
		).toBe(true);

		expect(
			matchesPolicy(action, {
				type: "all",
				matchers: [
					{ type: "tag", allOf: ["production"] },
					{ type: "risk", minLevel: "critical" },
				],
			}),
		).toBe(false);
	});

	it("CompositeMatcher: any", () => {
		expect(
			matchesPolicy(action, {
				type: "any",
				matchers: [
					{ type: "tag", allOf: ["staging"] },
					{ type: "risk", minLevel: "high" },
				],
			}),
		).toBe(true);
	});
});

describe("evaluatePolicies", () => {
	const action: ActionDescriptor = {
		name: "deploy:production",
		requestedBy: "alice",
		tags: ["production"],
		risk: "high",
	};

	it("returns null when no policies match", () => {
		const policies = new Map<string, PolicyDefinition>([
			[
				"staging-only",
				{
					match: { type: "tag", allOf: ["staging"] },
					approvers: ["bob"],
					requiredApprovals: 1,
					timeout: "1h",
				},
			],
		]);
		expect(evaluatePolicies(action, policies, [])).toBeNull();
	});

	it("returns resolved policy when one matches", () => {
		const policies = new Map<string, PolicyDefinition>([
			[
				"prod-deploy",
				{
					match: { type: "tag", allOf: ["production"] },
					approvers: ["bob", "carol"],
					requiredApprovals: 1,
					timeout: "1h",
				},
			],
		]);
		const result = evaluatePolicies(action, policies, []);
		expect(result).not.toBeNull();
		expect(result!.name).toBe("prod-deploy");
		expect(result!.approvers).toEqual(["bob", "carol"]);
		expect(result!.requiredApprovals).toBe(1);
	});

	it("merges multiple matching policies (most restrictive wins)", () => {
		const policies = new Map<string, PolicyDefinition>([
			[
				"policy-a",
				{
					match: { type: "tag", allOf: ["production"] },
					approvers: ["bob"],
					requiredApprovals: 1,
					timeout: "2h",
					priority: 10,
				},
			],
			[
				"policy-b",
				{
					match: { type: "risk", minLevel: "high" },
					approvers: ["carol"],
					requiredApprovals: 2,
					timeout: "30m",
					priority: 20,
				},
			],
		]);
		const result = evaluatePolicies(action, policies, []);
		expect(result).not.toBeNull();
		// Most restrictive: highest requiredApprovals
		expect(result!.requiredApprovals).toBe(2);
		// Shortest timeout
		expect(result!.timeout).toBeLessThanOrEqual(30 * 60 * 1000);
		// Union of approvers
		expect(result!.approvers).toContain("bob");
		expect(result!.approvers).toContain("carol");
	});

	it("respects priority ordering", () => {
		const policies = new Map<string, PolicyDefinition>([
			[
				"low-priority",
				{
					match: { type: "name", pattern: "*" },
					approvers: ["admin"],
					requiredApprovals: 1,
					timeout: "4h",
					priority: 999,
				},
			],
			[
				"high-priority",
				{
					match: { type: "tag", allOf: ["production"] },
					approvers: ["cto"],
					requiredApprovals: 2,
					timeout: "1h",
					priority: 1,
				},
			],
		]);
		const result = evaluatePolicies(action, policies, []);
		expect(result!.name).toBe("high-priority");
	});

	it("applies defaults for missing optional fields", () => {
		const policies = new Map<string, PolicyDefinition>([
			[
				"minimal",
				{
					match: { type: "name", pattern: "deploy:*" },
					approvers: ["bob"],
				},
			],
		]);
		const result = evaluatePolicies(action, policies, []);
		expect(result!.requiredApprovals).toBe(1);
		expect(result!.segregateRequester).toBe(true);
		expect(result!.timeout).toBeGreaterThan(0);
	});
});
