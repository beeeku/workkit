import { describe, expect, it } from "vitest";
import {
	cosineSimilarity,
	estimateTokens,
	extractSearchTerms,
	generateFactId,
	generateMessageId,
	generateSummaryId,
} from "../src/utils";

describe("generateFactId", () => {
	it("starts with fact_", () => {
		expect(generateFactId()).toMatch(/^fact_/);
	});

	it("generates unique ids", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateFactId()));
		expect(ids.size).toBe(100);
	});

	it("has correct length (fact_ + 16 chars = 21)", () => {
		expect(generateFactId()).toHaveLength(21);
	});
});

describe("generateMessageId", () => {
	it("starts with msg_", () => {
		expect(generateMessageId()).toMatch(/^msg_/);
	});

	it("generates unique ids", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()));
		expect(ids.size).toBe(100);
	});
});

describe("generateSummaryId", () => {
	it("starts with sum_", () => {
		expect(generateSummaryId()).toMatch(/^sum_/);
	});

	it("generates unique ids", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateSummaryId()));
		expect(ids.size).toBe(100);
	});
});

describe("estimateTokens", () => {
	it("returns reasonable number for hello world", () => {
		const tokens = estimateTokens("hello world");
		expect(tokens).toBeGreaterThan(0);
		expect(tokens).toBeLessThan(20);
	});

	it("uses ~4 chars per token heuristic", () => {
		expect(estimateTokens("abcd")).toBe(1);
		expect(estimateTokens("abcde")).toBe(2);
		expect(estimateTokens("abcdefgh")).toBe(2);
	});

	it("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("scales linearly with length", () => {
		const short = estimateTokens("a".repeat(100));
		const long = estimateTokens("a".repeat(400));
		expect(long).toBe(short * 4);
	});
});

describe("extractSearchTerms", () => {
	it("filters stop words", () => {
		const terms = extractSearchTerms("what is the weather today");
		expect(terms).not.toContain("what");
		expect(terms).not.toContain("is");
		expect(terms).not.toContain("the");
		expect(terms).toContain("weather");
		expect(terms).toContain("today");
	});

	it("lowercases all terms", () => {
		const terms = extractSearchTerms("Hello World Sky");
		expect(terms).toContain("hello");
		expect(terms).toContain("world");
		expect(terms).toContain("sky");
	});

	it("filters single character terms", () => {
		const terms = extractSearchTerms("a b c hello");
		expect(terms).not.toContain("a");
		expect(terms).not.toContain("b");
		expect(terms).not.toContain("c");
		expect(terms).toContain("hello");
	});

	it("returns empty array for all-stop-words query", () => {
		const terms = extractSearchTerms("i you he she we they the and or");
		expect(terms).toHaveLength(0);
	});

	it("handles extra whitespace", () => {
		const terms = extractSearchTerms("  hello   world  ");
		expect(terms).toContain("hello");
		expect(terms).toContain("world");
	});
});

describe("cosineSimilarity", () => {
	it("returns 1 for identical vectors", () => {
		const v = [1, 2, 3];
		expect(cosineSimilarity(v, v)).toBeCloseTo(1);
	});

	it("returns 0 for orthogonal vectors", () => {
		expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
	});

	it("returns -1 for opposite vectors", () => {
		expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
	});

	it("returns 0 for empty vectors", () => {
		expect(cosineSimilarity([], [])).toBe(0);
	});

	it("returns 0 for mismatched length vectors", () => {
		expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
	});

	it("returns 0 for zero vectors", () => {
		expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
	});

	it("handles multi-dimensional vectors", () => {
		const a = [0.1, 0.9, 0.3];
		const b = [0.1, 0.9, 0.3];
		expect(cosineSimilarity(a, b)).toBeCloseTo(1);
	});
});
