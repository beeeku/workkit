import { describe, expect, it, vi } from "vitest";
import { computeScore, createRecall } from "../src/recall";

describe("computeScore", () => {
	it("computes weighted score", () => {
		const score = computeScore(0.8, 0, 1.0, true, 30);
		// 0.6*0.8 + 0.2*1.0 + 0.1*1.0 + 0.1*1.0 = 0.48 + 0.2 + 0.1 + 0.1 = 0.88
		expect(score).toBeCloseTo(0.88, 1);
	});

	it("recency decays over time", () => {
		const fresh = computeScore(0.5, 0, 1.0, false, 30);
		const old = computeScore(0.5, 30 * 24 * 60 * 60 * 1000, 1.0, false, 30);
		expect(fresh).toBeGreaterThan(old);
	});

	it("recency halves at half-life", () => {
		const halfLifeDays = 30;
		const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
		const atHalfLife = computeScore(0, halfLifeMs, 1.0, false, halfLifeDays);
		const atZero = computeScore(0, 0, 1.0, false, halfLifeDays);
		// Recency component: 0.2 * 0.5 = 0.1 at half-life vs 0.2 * 1.0 = 0.2 at zero
		expect(atZero - atHalfLife).toBeCloseTo(0.1, 1);
	});
});

describe("createRecall", () => {
	function createMockD1(results: any[] = []) {
		const stmt = {
			bind: vi.fn().mockReturnThis(),
			all: vi.fn(async () => ({ results, success: true })),
		};
		return { prepare: vi.fn(() => stmt) } as any;
	}

	it("returns empty array when no matches", async () => {
		const db = createMockD1();
		const recall = createRecall(db);
		const result = await recall("something unknown");

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	it("scores and ranks results", async () => {
		const now = Date.now();
		const db = createMockD1([
			{
				id: "fact_1",
				text: "User prefers dark mode",
				subject: "user",
				tags: '["preferences"]',
				confidence: 1.0,
				valid_from: now,
				valid_until: null,
				superseded_by: null,
				forgotten_at: null,
				embedding_status: "pending",
				encrypted: 0,
				created_at: now,
				source: null,
				forgotten_reason: null,
				ttl: null,
			},
			{
				id: "fact_2",
				text: "User likes dark themes",
				subject: "user",
				tags: '["preferences"]',
				confidence: 0.5,
				valid_from: now - 86400000,
				valid_until: null,
				superseded_by: null,
				forgotten_at: null,
				embedding_status: "pending",
				encrypted: 0,
				created_at: now - 86400000,
				source: null,
				forgotten_reason: null,
				ttl: null,
			},
		]);
		const recall = createRecall(db);
		const result = await recall("dark mode", { subject: "user" });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.length).toBeGreaterThan(0);
			// Higher confidence + more recent should score higher
			expect(result.value[0].fact.id).toBe("fact_1");
			expect(result.value[0].score).toBeGreaterThan(0);
			expect(result.value[0].signals).toBeDefined();
		}
	});

	it("filters below threshold", async () => {
		const db = createMockD1([
			{
				id: "fact_1",
				text: "completely unrelated content",
				subject: null,
				tags: "[]",
				confidence: 0.1,
				valid_from: Date.now() - 365 * 86400000,
				valid_until: null,
				superseded_by: null,
				forgotten_at: null,
				embedding_status: "pending",
				encrypted: 0,
				created_at: Date.now() - 365 * 86400000,
				source: null,
				forgotten_reason: null,
				ttl: null,
			},
		]);
		const recall = createRecall(db);
		const result = await recall("dark mode", { threshold: 0.5 });

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toHaveLength(0);
	});

	it("excludes superseded facts", async () => {
		const now = Date.now();
		const db = createMockD1([
			{
				id: "fact_old",
				text: "User likes blue",
				subject: "user",
				tags: "[]",
				confidence: 1.0,
				valid_from: now,
				valid_until: now,
				superseded_by: "fact_new",
				forgotten_at: null,
				embedding_status: "pending",
				encrypted: 0,
				created_at: now,
				source: null,
				forgotten_reason: null,
				ttl: null,
			},
			{
				id: "fact_new",
				text: "User likes dark",
				subject: "user",
				tags: "[]",
				confidence: 1.0,
				valid_from: now,
				valid_until: null,
				superseded_by: null,
				forgotten_at: null,
				embedding_status: "pending",
				encrypted: 0,
				created_at: now,
				source: null,
				forgotten_reason: null,
				ttl: null,
			},
		]);
		const recall = createRecall(db);
		const result = await recall("likes", {});

		expect(result.ok).toBe(true);
		if (result.ok) {
			const ids = result.value.map((r) => r.fact.id);
			expect(ids).not.toContain("fact_old");
		}
	});

	it("returns storage error on db failure", async () => {
		const stmt = {
			bind: vi.fn().mockReturnThis(),
			all: vi.fn(async () => {
				throw new Error("DB failed");
			}),
		};
		const db = { prepare: vi.fn(() => stmt) } as any;
		const recall = createRecall(db);
		const result = await recall("query");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("STORAGE_ERROR");
	});

	it("respects custom limit", async () => {
		const now = Date.now();
		const rows = Array.from({ length: 5 }, (_, i) => ({
			id: `fact_${i}`,
			text: "test fact",
			subject: null,
			tags: "[]",
			confidence: 1.0,
			valid_from: now,
			valid_until: null,
			superseded_by: null,
			forgotten_at: null,
			embedding_status: "pending",
			encrypted: 0,
			created_at: now,
			source: null,
			forgotten_reason: null,
			ttl: null,
		}));
		const db = createMockD1(rows);
		const recall = createRecall(db);
		const result = await recall("test", { limit: 3 });

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.length).toBeLessThanOrEqual(3);
	});

	it("signals are exposed on each result", async () => {
		const now = Date.now();
		const db = createMockD1([
			{
				id: "fact_x",
				text: "user prefers blue",
				subject: "user",
				tags: "[]",
				confidence: 0.9,
				valid_from: now,
				valid_until: null,
				superseded_by: null,
				forgotten_at: null,
				embedding_status: "pending",
				encrypted: 0,
				created_at: now,
				source: null,
				forgotten_reason: null,
				ttl: null,
			},
		]);
		const recall = createRecall(db);
		const result = await recall("blue", {});

		expect(result.ok).toBe(true);
		if (result.ok && result.value.length > 0) {
			const { signals } = result.value[0];
			expect(signals).toHaveProperty("similarity");
			expect(signals).toHaveProperty("recency");
			expect(signals).toHaveProperty("confidence");
			expect(signals).toHaveProperty("metadata");
		}
	});
});
