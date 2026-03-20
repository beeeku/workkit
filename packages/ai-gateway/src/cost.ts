import { ConfigError } from "@workkit/errors";
import type {
	BudgetCheck,
	CostSummary,
	CostTracker,
	CostTrackerConfig,
	ModelCostSummary,
	UsageRecord,
} from "./types";

/**
 * Create a cost tracker for monitoring AI spend.
 *
 * Pricing is per 1K tokens. Records usage and calculates costs
 * across models. Supports budget checking.
 *
 * @example
 * ```ts
 * const costs = createCostTracker({
 *   pricing: {
 *     'gpt-4': { input: 0.03, output: 0.06 },
 *     'gpt-3.5-turbo': { input: 0.001, output: 0.002 },
 *   },
 * })
 *
 * costs.record('gpt-4', { inputTokens: 500, outputTokens: 200 })
 * const total = costs.getTotal()
 * // { totalCost: 0.027, byModel: { 'gpt-4': { ... } } }
 * ```
 */
export function createCostTracker(config: CostTrackerConfig): CostTracker {
	if (!config.pricing || Object.keys(config.pricing).length === 0) {
		throw new ConfigError("Cost tracker requires at least one model pricing entry", {
			context: { pricing: config.pricing },
		});
	}

	// Validate pricing values
	for (const [model, pricing] of Object.entries(config.pricing)) {
		if (pricing.input < 0 || pricing.output < 0) {
			throw new ConfigError(`Invalid pricing for model "${model}": values cannot be negative`, {
				context: { model, pricing },
			});
		}
	}

	// Internal state: accumulated usage per model
	const usage = new Map<string, { inputTokens: number; outputTokens: number; requests: number }>();

	return {
		record(model: string, record: UsageRecord): void {
			if (record.inputTokens < 0 || record.outputTokens < 0) {
				throw new ConfigError("Token counts cannot be negative", {
					context: { model, record },
				});
			}

			const existing = usage.get(model) ?? { inputTokens: 0, outputTokens: 0, requests: 0 };
			existing.inputTokens += record.inputTokens;
			existing.outputTokens += record.outputTokens;
			existing.requests += 1;
			usage.set(model, existing);
		},

		getTotal(): CostSummary {
			let totalCost = 0;
			const byModel: Record<string, ModelCostSummary> = {};

			for (const [model, u] of usage) {
				const pricing = config.pricing[model];
				// Models without pricing are tracked but cost $0
				const inputRate = pricing?.input ?? 0;
				const outputRate = pricing?.output ?? 0;

				const inputCost = (u.inputTokens / 1000) * inputRate;
				const outputCost = (u.outputTokens / 1000) * outputRate;
				const modelTotal = inputCost + outputCost;

				byModel[model] = {
					inputCost,
					outputCost,
					totalCost: modelTotal,
					inputTokens: u.inputTokens,
					outputTokens: u.outputTokens,
					requests: u.requests,
				};

				totalCost += modelTotal;
			}

			return { totalCost, byModel };
		},

		checkBudget(budget: number): BudgetCheck {
			if (budget < 0) {
				throw new ConfigError("Budget cannot be negative", {
					context: { budget },
				});
			}

			const { totalCost } = this.getTotal();
			return {
				remaining: Math.max(0, budget - totalCost),
				exceeded: totalCost > budget,
				totalSpent: totalCost,
			};
		},

		reset(): void {
			usage.clear();
		},
	};
}
