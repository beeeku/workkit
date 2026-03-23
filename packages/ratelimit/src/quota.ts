import { parseDuration } from "./duration";
import type {
	Duration,
	QuotaLimiter,
	QuotaOptions,
	QuotaResult,
	QuotaUsage,
	QuotaWindowResult,
} from "./types";

interface QuotaState {
	used: number;
}

/**
 * Create a quota bucket limiter with calendar-aligned windows.
 *
 * Supports multiple concurrent windows (e.g. 10/hour + 100/day).
 * Requests are only counted if ALL windows allow them. Supports
 * variable cost per request and read-only usage queries.
 *
 * @example
 * ```ts
 * const q = quota({
 *   namespace: env.RATE_LIMIT_KV,
 *   limits: [
 *     { window: '1h', limit: 10 },
 *     { window: '1d', limit: 100 },
 *   ],
 * })
 * const result = await q.check('user:123', 5)  // cost of 5
 * const usage = await q.usage('user:123')       // read-only
 * ```
 */
export function quota(options: QuotaOptions): QuotaLimiter {
	const prefix = options.prefix ?? "rl:quota:";

	const windowConfigs = options.limits.map((l) => ({
		window: l.window,
		limit: l.limit,
		durationMs: parseDuration(l.window),
	}));

	function getWindowBoundary(durationMs: number, now: number): number {
		return now - (now % durationMs);
	}

	function kvKey(window: Duration, boundary: number, key: string): string {
		return `${prefix}${window}:${boundary}:${key}`;
	}

	async function readAllWindows(
		key: string,
		now: number,
	): Promise<
		Array<{ config: (typeof windowConfigs)[0]; state: QuotaState | null; boundary: number }>
	> {
		const reads = windowConfigs.map(async (config) => {
			const boundary = getWindowBoundary(config.durationMs, now);
			const k = kvKey(config.window, boundary, key);
			const state = (await options.namespace.get(k, "json")) as QuotaState | null;
			return { config, state, boundary };
		});
		return Promise.all(reads);
	}

	return {
		async check(key: string, cost = 1): Promise<QuotaResult> {
			const now = Date.now();
			const windows = await readAllWindows(key, now);

			// Check if all windows would allow the cost
			const wouldAllow = windows.every((w) => {
				const currentUsed = w.state?.used ?? 0;
				return currentUsed + cost <= w.config.limit;
			});

			// Build per-window results
			const quotas: QuotaWindowResult[] = [];
			let earliestReset = Number.POSITIVE_INFINITY;
			let mostRestrictiveRemaining = Number.POSITIVE_INFINITY;
			let mostRestrictiveLimit = Number.POSITIVE_INFINITY;

			for (const w of windows) {
				const currentUsed = w.state?.used ?? 0;
				const newUsed = wouldAllow ? currentUsed + cost : currentUsed;
				const resetTime = w.boundary + w.config.durationMs;

				quotas.push({
					window: w.config.window,
					used: newUsed,
					limit: w.config.limit,
					remaining: Math.max(0, w.config.limit - newUsed),
				});

				if (resetTime < earliestReset) {
					earliestReset = resetTime;
				}

				const remaining = Math.max(0, w.config.limit - newUsed);
				if (remaining < mostRestrictiveRemaining) {
					mostRestrictiveRemaining = remaining;
					mostRestrictiveLimit = w.config.limit;
				}
			}

			// Only write if allowed
			if (wouldAllow) {
				const writes = windows.map((w) => {
					const currentUsed = w.state?.used ?? 0;
					const newState: QuotaState = { used: currentUsed + cost };
					const k = kvKey(w.config.window, w.boundary, key);
					const ttlSeconds = Math.ceil((w.boundary + w.config.durationMs - now) / 1000);
					return options.namespace.put(k, JSON.stringify(newState), {
						expirationTtl: Math.max(ttlSeconds, 1),
					});
				});
				await Promise.all(writes);
			}

			return {
				allowed: wouldAllow,
				remaining: mostRestrictiveRemaining,
				resetAt: new Date(earliestReset),
				limit: mostRestrictiveLimit,
				quotas,
			};
		},

		async usage(key: string): Promise<QuotaUsage[]> {
			const now = Date.now();
			const windows = await readAllWindows(key, now);

			return windows.map((w) => {
				const used = w.state?.used ?? 0;
				return {
					window: w.config.window,
					used,
					limit: w.config.limit,
					remaining: Math.max(0, w.config.limit - used),
					resetsAt: new Date(w.boundary + w.config.durationMs),
				};
			});
		},
	};
}
