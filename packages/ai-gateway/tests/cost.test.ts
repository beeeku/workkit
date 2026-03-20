import { ConfigError } from "@workkit/errors";
import { beforeEach, describe, expect, it } from "vitest";
import { createCostTracker } from "../src/cost";
import type { CostTracker } from "../src/types";

describe("createCostTracker()", () => {
	it("throws ConfigError with empty pricing", () => {
		expect(() => createCostTracker({ pricing: {} })).toThrow(ConfigError);
	});

	it("throws ConfigError for negative input price", () => {
		expect(() =>
			createCostTracker({ pricing: { "gpt-4": { input: -0.01, output: 0.06 } } }),
		).toThrow(ConfigError);
	});

	it("throws ConfigError for negative output price", () => {
		expect(() =>
			createCostTracker({ pricing: { "gpt-4": { input: 0.03, output: -0.01 } } }),
		).toThrow(ConfigError);
	});

	it("creates a cost tracker with valid config", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		expect(tracker).toBeDefined();
		expect(typeof tracker.record).toBe("function");
		expect(typeof tracker.getTotal).toBe("function");
		expect(typeof tracker.checkBudget).toBe("function");
		expect(typeof tracker.reset).toBe("function");
	});

	it("accepts zero pricing (free models)", () => {
		const tracker = createCostTracker({
			pricing: { "@cf/meta/llama-3.1-8b-instruct": { input: 0, output: 0 } },
		});
		expect(tracker).toBeDefined();
	});
});

describe("record()", () => {
	let tracker: CostTracker;

	beforeEach(() => {
		tracker = createCostTracker({
			pricing: {
				"gpt-4": { input: 0.03, output: 0.06 },
				"gpt-3.5-turbo": { input: 0.001, output: 0.002 },
			},
		});
	});

	it("records usage for a known model", () => {
		tracker.record("gpt-4", { inputTokens: 1000, outputTokens: 500 });
		const total = tracker.getTotal();
		expect(total.byModel["gpt-4"]).toBeDefined();
		expect(total.byModel["gpt-4"].inputTokens).toBe(1000);
		expect(total.byModel["gpt-4"].outputTokens).toBe(500);
		expect(total.byModel["gpt-4"].requests).toBe(1);
	});

	it("accumulates multiple records for same model", () => {
		tracker.record("gpt-4", { inputTokens: 500, outputTokens: 200 });
		tracker.record("gpt-4", { inputTokens: 300, outputTokens: 100 });
		const total = tracker.getTotal();
		expect(total.byModel["gpt-4"].inputTokens).toBe(800);
		expect(total.byModel["gpt-4"].outputTokens).toBe(300);
		expect(total.byModel["gpt-4"].requests).toBe(2);
	});

	it("records usage for unknown model (no pricing)", () => {
		tracker.record("unknown-model", { inputTokens: 1000, outputTokens: 500 });
		const total = tracker.getTotal();
		expect(total.byModel["unknown-model"]).toBeDefined();
		expect(total.byModel["unknown-model"].totalCost).toBe(0);
	});

	it("throws ConfigError for negative input tokens", () => {
		expect(() => tracker.record("gpt-4", { inputTokens: -100, outputTokens: 200 })).toThrow(
			ConfigError,
		);
	});

	it("throws ConfigError for negative output tokens", () => {
		expect(() => tracker.record("gpt-4", { inputTokens: 100, outputTokens: -200 })).toThrow(
			ConfigError,
		);
	});

	it("handles zero token usage", () => {
		tracker.record("gpt-4", { inputTokens: 0, outputTokens: 0 });
		const total = tracker.getTotal();
		expect(total.byModel["gpt-4"].totalCost).toBe(0);
		expect(total.byModel["gpt-4"].requests).toBe(1);
	});
});

describe("getTotal()", () => {
	it("returns zero when no usage recorded", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		const total = tracker.getTotal();
		expect(total.totalCost).toBe(0);
		expect(Object.keys(total.byModel)).toHaveLength(0);
	});

	it("calculates cost correctly per 1K tokens", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 1000, outputTokens: 1000 });
		const total = tracker.getTotal();
		expect(total.byModel["gpt-4"].inputCost).toBeCloseTo(0.03);
		expect(total.byModel["gpt-4"].outputCost).toBeCloseTo(0.06);
		expect(total.byModel["gpt-4"].totalCost).toBeCloseTo(0.09);
		expect(total.totalCost).toBeCloseTo(0.09);
	});

	it("calculates cost for fractional 1K tokens", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 500, outputTokens: 200 });
		const total = tracker.getTotal();
		// 500/1000 * 0.03 = 0.015
		expect(total.byModel["gpt-4"].inputCost).toBeCloseTo(0.015);
		// 200/1000 * 0.06 = 0.012
		expect(total.byModel["gpt-4"].outputCost).toBeCloseTo(0.012);
		expect(total.byModel["gpt-4"].totalCost).toBeCloseTo(0.027);
		expect(total.totalCost).toBeCloseTo(0.027);
	});

	it("sums costs across multiple models", () => {
		const tracker = createCostTracker({
			pricing: {
				"gpt-4": { input: 0.03, output: 0.06 },
				"gpt-3.5-turbo": { input: 0.001, output: 0.002 },
			},
		});
		tracker.record("gpt-4", { inputTokens: 1000, outputTokens: 1000 });
		tracker.record("gpt-3.5-turbo", { inputTokens: 1000, outputTokens: 1000 });
		const total = tracker.getTotal();
		// gpt-4: 0.03 + 0.06 = 0.09
		// gpt-3.5: 0.001 + 0.002 = 0.003
		expect(total.totalCost).toBeCloseTo(0.093);
	});

	it("handles free models (zero pricing)", () => {
		const tracker = createCostTracker({
			pricing: { "@cf/meta/llama-3.1-8b-instruct": { input: 0, output: 0 } },
		});
		tracker.record("@cf/meta/llama-3.1-8b-instruct", { inputTokens: 5000, outputTokens: 2000 });
		const total = tracker.getTotal();
		expect(total.totalCost).toBe(0);
		expect(total.byModel["@cf/meta/llama-3.1-8b-instruct"].requests).toBe(1);
	});
});

describe("checkBudget()", () => {
	it("returns full budget when no usage", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		const budget = tracker.checkBudget(1.0);
		expect(budget.remaining).toBeCloseTo(1.0);
		expect(budget.exceeded).toBe(false);
		expect(budget.totalSpent).toBe(0);
	});

	it("subtracts spent from budget", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 500, outputTokens: 200 });
		const budget = tracker.checkBudget(1.0);
		expect(budget.totalSpent).toBeCloseTo(0.027);
		expect(budget.remaining).toBeCloseTo(0.973);
		expect(budget.exceeded).toBe(false);
	});

	it("reports exceeded when over budget", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 10000, outputTokens: 10000 });
		// 0.3 + 0.6 = 0.9
		const budget = tracker.checkBudget(0.5);
		expect(budget.exceeded).toBe(true);
		expect(budget.remaining).toBe(0);
		expect(budget.totalSpent).toBeCloseTo(0.9);
	});

	it("remaining never goes negative", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 100000, outputTokens: 100000 });
		const budget = tracker.checkBudget(0.01);
		expect(budget.remaining).toBe(0);
		expect(budget.exceeded).toBe(true);
	});

	it("throws ConfigError for negative budget", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		expect(() => tracker.checkBudget(-1)).toThrow(ConfigError);
	});

	it("handles zero budget", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		const budget = tracker.checkBudget(0);
		expect(budget.remaining).toBe(0);
		expect(budget.exceeded).toBe(false);
	});

	it("zero budget exceeded after any usage", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 1, outputTokens: 1 });
		const budget = tracker.checkBudget(0);
		expect(budget.exceeded).toBe(true);
	});
});

describe("reset()", () => {
	it("clears all tracked usage", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 1000, outputTokens: 500 });
		expect(tracker.getTotal().totalCost).toBeGreaterThan(0);

		tracker.reset();
		expect(tracker.getTotal().totalCost).toBe(0);
		expect(Object.keys(tracker.getTotal().byModel)).toHaveLength(0);
	});

	it("allows recording after reset", () => {
		const tracker = createCostTracker({
			pricing: { "gpt-4": { input: 0.03, output: 0.06 } },
		});
		tracker.record("gpt-4", { inputTokens: 1000, outputTokens: 500 });
		tracker.reset();
		tracker.record("gpt-4", { inputTokens: 100, outputTokens: 50 });
		const total = tracker.getTotal();
		expect(total.byModel["gpt-4"].inputTokens).toBe(100);
		expect(total.byModel["gpt-4"].outputTokens).toBe(50);
		expect(total.byModel["gpt-4"].requests).toBe(1);
	});
});
