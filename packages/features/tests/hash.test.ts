import { describe, expect, it } from "vitest";
import { deterministicHash } from "../src/hash";

describe("deterministicHash", () => {
	it("returns a number between 0 and 99", () => {
		for (let i = 0; i < 100; i++) {
			const result = deterministicHash(`test-input-${i}`);
			expect(result).toBeGreaterThanOrEqual(0);
			expect(result).toBeLessThan(100);
		}
	});

	it("is deterministic — same input always returns same output", () => {
		const input = "user-123:dark-mode";
		const first = deterministicHash(input);
		const second = deterministicHash(input);
		const third = deterministicHash(input);
		expect(first).toBe(second);
		expect(second).toBe(third);
	});

	it("produces different values for different inputs", () => {
		const a = deterministicHash("user-1:flag-a");
		const b = deterministicHash("user-2:flag-a");
		const c = deterministicHash("user-1:flag-b");
		// With good distribution, at least some should differ
		const unique = new Set([a, b, c]);
		expect(unique.size).toBeGreaterThan(1);
	});

	it("distributes roughly uniformly across 1000 inputs", () => {
		const buckets = new Array(10).fill(0);
		for (let i = 0; i < 1000; i++) {
			const hash = deterministicHash(`user-${i}:test-flag`);
			const bucket = Math.floor(hash / 10);
			buckets[bucket]++;
		}
		// Each bucket should have ~100 entries; allow 50-150 range for randomness
		for (const count of buckets) {
			expect(count).toBeGreaterThan(50);
			expect(count).toBeLessThan(150);
		}
	});

	it("handles empty string", () => {
		const result = deterministicHash("");
		expect(result).toBeGreaterThanOrEqual(0);
		expect(result).toBeLessThan(100);
	});

	it("handles long strings", () => {
		const long = "a".repeat(10000);
		const result = deterministicHash(long);
		expect(result).toBeGreaterThanOrEqual(0);
		expect(result).toBeLessThan(100);
	});
});
