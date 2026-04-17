import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthCheck } from "../src/health";
import type { ProbeConfig } from "../src/types";

function healthyProbe(name: string, opts?: Partial<ProbeConfig>): ProbeConfig {
	return {
		name,
		check: async () => {},
		critical: opts?.critical ?? true,
		timeout: opts?.timeout,
	};
}

function failingProbe(name: string, message: string, opts?: Partial<ProbeConfig>): ProbeConfig {
	return {
		name,
		check: async () => {
			throw new Error(message);
		},
		critical: opts?.critical ?? true,
		timeout: opts?.timeout,
	};
}

function slowProbe(name: string, delayMs: number, opts?: Partial<ProbeConfig>): ProbeConfig {
	return {
		name,
		check: () => new Promise((resolve) => setTimeout(resolve, delayMs)),
		critical: opts?.critical ?? true,
		timeout: opts?.timeout,
	};
}

describe("createHealthCheck", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns healthy when all probes pass", async () => {
		const hc = createHealthCheck([healthyProbe("kv"), healthyProbe("d1")]);
		const result = await hc.check();

		expect(result.status).toBe("healthy");
		expect(result.checks).toHaveLength(2);
		expect(result.checks[0]!.status).toBe("healthy");
		expect(result.checks[1]!.status).toBe("healthy");
		expect(result.timestamp).toBeTruthy();
	});

	it("returns unhealthy when a critical probe fails", async () => {
		const hc = createHealthCheck([
			healthyProbe("kv"),
			failingProbe("d1", "connection refused", { critical: true }),
		]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
		expect(result.checks[1]!.status).toBe("unhealthy");
		expect(result.checks[1]!.message).toBe("connection refused");
	});

	it("returns degraded when a non-critical probe fails", async () => {
		const hc = createHealthCheck([
			healthyProbe("kv"),
			failingProbe("cache", "miss", { critical: false }),
		]);
		const result = await hc.check();

		expect(result.status).toBe("degraded");
		expect(result.checks[0]!.status).toBe("healthy");
		expect(result.checks[1]!.status).toBe("unhealthy");
	});

	it("returns unhealthy when both critical and non-critical probes fail", async () => {
		const hc = createHealthCheck([
			failingProbe("d1", "db down", { critical: true }),
			failingProbe("cache", "miss", { critical: false }),
		]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
	});

	it("times out slow probes", async () => {
		const hc = createHealthCheck([slowProbe("slow", 10_000, { timeout: 100 })]);

		const resultPromise = hc.check();
		vi.advanceTimersByTime(200);
		const result = await resultPromise;

		expect(result.status).toBe("unhealthy");
		expect(result.checks[0]!.status).toBe("unhealthy");
		expect(result.checks[0]!.message).toContain("timed out");
	});

	it("includes version when provided", async () => {
		const hc = createHealthCheck([healthyProbe("kv")], { version: "1.2.3" });
		const result = await hc.check();

		expect(result.version).toBe("1.2.3");
	});

	it("caches results for cacheTtl seconds", async () => {
		let callCount = 0;
		const countingProbe: ProbeConfig = {
			name: "counter",
			check: async () => {
				callCount++;
			},
		};

		const hc = createHealthCheck([countingProbe], { cacheTtl: 10 });

		await hc.check();
		expect(callCount).toBe(1);

		await hc.check();
		expect(callCount).toBe(1); // cached

		// Advance past TTL
		vi.advanceTimersByTime(11_000);

		await hc.check();
		expect(callCount).toBe(2); // cache expired
	});

	it("does not cache when cacheTtl is 0", async () => {
		let callCount = 0;
		const countingProbe: ProbeConfig = {
			name: "counter",
			check: async () => {
				callCount++;
			},
		};

		const hc = createHealthCheck([countingProbe], { cacheTtl: 0 });

		await hc.check();
		await hc.check();
		expect(callCount).toBe(2);
	});

	it("isHealthy returns true for a healthy probe", async () => {
		const hc = createHealthCheck([healthyProbe("kv"), healthyProbe("d1")]);
		const healthy = await hc.isHealthy("kv");
		expect(healthy).toBe(true);
	});

	it("isHealthy returns false for an unhealthy probe", async () => {
		const hc = createHealthCheck([healthyProbe("kv"), failingProbe("d1", "down")]);
		const healthy = await hc.isHealthy("d1");
		expect(healthy).toBe(false);
	});

	it("isHealthy returns false for an unknown probe name", async () => {
		const hc = createHealthCheck([healthyProbe("kv")]);
		const healthy = await hc.isHealthy("nonexistent");
		expect(healthy).toBe(false);
	});

	it("records latency in probe results", async () => {
		const hc = createHealthCheck([healthyProbe("kv")]);
		const result = await hc.check();

		expect(typeof result.checks[0]!.latencyMs).toBe("number");
		expect(result.checks[0]!.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("records checkedAt as ISO timestamp", async () => {
		const hc = createHealthCheck([healthyProbe("kv")]);
		const result = await hc.check();

		expect(result.checks[0]!.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("runs probes concurrently", async () => {
		const order: string[] = [];
		const probeA: ProbeConfig = {
			name: "a",
			check: async () => {
				order.push("a-start");
				await Promise.resolve();
				order.push("a-end");
			},
		};
		const probeB: ProbeConfig = {
			name: "b",
			check: async () => {
				order.push("b-start");
				await Promise.resolve();
				order.push("b-end");
			},
		};

		const hc = createHealthCheck([probeA, probeB]);
		await hc.check();

		// Both probes should start before either ends (concurrent execution)
		expect(order.indexOf("a-start")).toBeLessThan(order.indexOf("a-end"));
		expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("b-end"));
	});
});
