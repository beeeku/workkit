import { describe, expect, it } from "vitest";
import { createTimeSeries } from "../src/time-series";
import { createMockStorage } from "./helpers";

describe("createTimeSeries", () => {
	it("should record and query a single value", async () => {
		const raw = createMockStorage();
		const ts = createTimeSeries(raw, {
			prefix: "metrics",
			granularity: "hour",
		});

		const at = new Date("2025-06-15T10:30:00Z");
		await ts.record(42, at);

		const results = await ts.query(
			new Date("2025-06-15T10:00:00Z"),
			new Date("2025-06-15T11:00:00Z"),
		);

		expect(results).toHaveLength(1);
		expect(results[0]!.value).toBe(42);
		expect(results[0]!.count).toBe(1);
	});

	it("should aggregate multiple records in same bucket via sum", async () => {
		const raw = createMockStorage();
		const ts = createTimeSeries(raw, {
			prefix: "hits",
			granularity: "hour",
		});

		const at = new Date("2025-06-15T10:15:00Z");
		await ts.record(10, at);
		await ts.record(20, at);
		await ts.record(5, at);

		const results = await ts.query(
			new Date("2025-06-15T10:00:00Z"),
			new Date("2025-06-15T11:00:00Z"),
		);

		expect(results).toHaveLength(1);
		expect(results[0]!.value).toBe(35);
		expect(results[0]!.count).toBe(3);
	});

	it("should query across multiple buckets sorted by time", async () => {
		const raw = createMockStorage();
		const ts = createTimeSeries(raw, {
			prefix: "reqs",
			granularity: "hour",
		});

		await ts.record(10, new Date("2025-06-15T08:00:00Z"));
		await ts.record(20, new Date("2025-06-15T09:30:00Z"));
		await ts.record(30, new Date("2025-06-15T10:45:00Z"));

		const results = await ts.query(
			new Date("2025-06-15T07:00:00Z"),
			new Date("2025-06-15T11:00:00Z"),
		);

		expect(results).toHaveLength(3);
		expect(results[0]!.value).toBe(10);
		expect(results[1]!.value).toBe(20);
		expect(results[2]!.value).toBe(30);
		// Sorted ascending by bucket
		expect(results[0]!.bucket.getTime()).toBeLessThan(results[1]!.bucket.getTime());
		expect(results[1]!.bucket.getTime()).toBeLessThan(results[2]!.bucket.getTime());
	});

	it("should rollup from minute to hour", async () => {
		const raw = createMockStorage();
		const ts = createTimeSeries(raw, {
			prefix: "cpu",
			granularity: "minute",
		});

		// Three different minutes in the same hour
		await ts.record(10, new Date("2025-06-15T10:00:00Z"));
		await ts.record(20, new Date("2025-06-15T10:15:00Z"));
		await ts.record(30, new Date("2025-06-15T10:45:00Z"));

		const rolled = await ts.rollup("hour");
		expect(rolled).toHaveLength(1);
		expect(rolled[0]!.value).toBe(60);
		expect(rolled[0]!.count).toBe(3);
	});

	it("should prune entries older than retention", async () => {
		const raw = createMockStorage();
		const ts = createTimeSeries(raw, {
			prefix: "old",
			granularity: "day",
			retention: "7d",
		});

		const now = new Date();
		const old = new Date(now.getTime() - 10 * 86_400_000); // 10 days ago
		const recent = new Date(now.getTime() - 2 * 86_400_000); // 2 days ago

		await ts.record(1, old);
		await ts.record(2, recent);

		const pruned = await ts.prune();
		expect(pruned).toBe(1);

		// Only recent entry remains
		const results = await ts.query(
			new Date(now.getTime() - 30 * 86_400_000),
			new Date(now.getTime() + 86_400_000),
		);
		expect(results).toHaveLength(1);
		expect(results[0]!.value).toBe(2);
	});

	it("should support custom reducer (non-numeric)", async () => {
		const raw = createMockStorage();

		interface MaxVal {
			max: number;
		}

		const ts = createTimeSeries<MaxVal>(raw, {
			prefix: "peaks",
			granularity: "hour",
			reducer: (existing, incoming) => ({
				max: Math.max(existing.max, incoming.max),
			}),
		});

		const at = new Date("2025-06-15T10:00:00Z");
		await ts.record({ max: 5 }, at);
		await ts.record({ max: 15 }, at);
		await ts.record({ max: 8 }, at);

		const results = await ts.query(
			new Date("2025-06-15T09:00:00Z"),
			new Date("2025-06-15T11:00:00Z"),
		);

		expect(results).toHaveLength(1);
		expect(results[0]!.value).toEqual({ max: 15 });
		expect(results[0]!.count).toBe(3);
	});

	it("should place backdated records in the correct bucket", async () => {
		const raw = createMockStorage();
		const ts = createTimeSeries(raw, {
			prefix: "backdate",
			granularity: "day",
		});

		// Record for yesterday
		const yesterday = new Date("2025-06-14T15:00:00Z");
		const today = new Date("2025-06-15T10:00:00Z");

		await ts.record(100, yesterday);
		await ts.record(200, today);

		const results = await ts.query(
			new Date("2025-06-14T00:00:00Z"),
			new Date("2025-06-16T00:00:00Z"),
		);

		expect(results).toHaveLength(2);
		expect(results[0]!.bucket).toEqual(new Date("2025-06-14T00:00:00Z"));
		expect(results[0]!.value).toBe(100);
		expect(results[1]!.bucket).toEqual(new Date("2025-06-15T00:00:00Z"));
		expect(results[1]!.value).toBe(200);
	});
});
