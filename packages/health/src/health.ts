import type { HealthCheckOptions, HealthResult, ProbeConfig, ProbeResult } from "./types";

export interface HealthChecker {
	check(): Promise<HealthResult>;
	isHealthy(name: string): Promise<boolean>;
}

/**
 * Creates a health check runner that executes all probes concurrently and
 * aggregates their results into a single {@link HealthResult}.
 */
export function createHealthCheck(
	probes: ProbeConfig[],
	options?: HealthCheckOptions,
): HealthChecker {
	let cached: HealthResult | null = null;
	let cachedAt = 0;

	async function runProbe(probe: ProbeConfig): Promise<ProbeResult> {
		const timeout = probe.timeout ?? 5000;
		const start = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);

		try {
			const probePromise = probe.check();
			// Attach a no-op catch so a late rejection (after timeout wins) doesn't surface
			// as an unhandled promise rejection in Workers or strict Node environments.
			probePromise.catch(() => undefined);
			await Promise.race([
				probePromise,
				new Promise<never>((_, reject) => {
					controller.signal.addEventListener("abort", () => {
						reject(new Error(`Probe "${probe.name}" timed out after ${timeout}ms`));
					});
				}),
			]);

			return {
				name: probe.name,
				status: "healthy",
				latencyMs: Date.now() - start,
				checkedAt: new Date().toISOString(),
			};
		} catch (err) {
			return {
				name: probe.name,
				status: "unhealthy",
				latencyMs: Date.now() - start,
				message: err instanceof Error ? err.message : String(err),
				checkedAt: new Date().toISOString(),
			};
		} finally {
			clearTimeout(timer);
		}
	}

	function aggregate(checks: ProbeResult[]): HealthResult["status"] {
		let hasCriticalFailure = false;
		let hasNonCriticalFailure = false;

		for (let i = 0; i < checks.length; i++) {
			const check = checks[i]!;
			if (check.status === "unhealthy") {
				const probe = probes[i]!;
				const critical = probe.critical ?? true;
				if (critical) {
					hasCriticalFailure = true;
				} else {
					hasNonCriticalFailure = true;
				}
			}
		}

		if (hasCriticalFailure) return "unhealthy";
		if (hasNonCriticalFailure) return "degraded";
		return "healthy";
	}

	async function check(): Promise<HealthResult> {
		const ttl = options?.cacheTtl ?? 0;
		if (ttl > 0 && cached && Date.now() - cachedAt < ttl * 1000) {
			return cached;
		}

		const results = await Promise.allSettled(probes.map(runProbe));

		const checks: ProbeResult[] = results.map((result, idx) => {
			if (result.status === "fulfilled") {
				return result.value;
			}
			return {
				name: probes[idx]!.name,
				status: "unhealthy" as const,
				latencyMs: 0,
				message: result.reason instanceof Error ? result.reason.message : String(result.reason),
				checkedAt: new Date().toISOString(),
			};
		});

		const healthResult: HealthResult = {
			status: aggregate(checks),
			timestamp: new Date().toISOString(),
			checks,
		};

		if (options?.version) {
			healthResult.version = options.version;
		}

		if (ttl > 0) {
			cached = healthResult;
			cachedAt = Date.now();
		}

		return healthResult;
	}

	async function isHealthy(name: string): Promise<boolean> {
		const result = await check();
		const probe = result.checks.find((c) => c.name === name);
		return probe?.status === "healthy";
	}

	return { check: check, isHealthy: isHealthy };
}
