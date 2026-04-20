import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedWindow } from "../src/fixed-window";
import { quota } from "../src/quota";
import { slidingWindow } from "../src/sliding-window";
import { createMockKV } from "./helpers/mock-kv";

// Cloudflare KV rejects expirationTtl below 60 with
// "400 Invalid expiration_ttl of N. Expiration TTL must be at least 60."
// Every KV-backed limiter in this package must clamp at write time (issue #108).
const MIN_KV_TTL = 60;

describe("KV expirationTtl clamp (issue #108)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("fixedWindow never writes TTL < 60 near end of a 1m window", async () => {
		const kv = createMockKV();
		const putSpy = vi.spyOn(kv, "put");
		const limiter = fixedWindow({ namespace: kv, limit: 10, window: "1m" });

		// 50s into the minute — naive TTL would be 10.
		vi.setSystemTime(new Date("2025-01-01T00:00:50.000Z"));
		await limiter.check("user:1");

		expect(putSpy).toHaveBeenCalled();
		const opts = putSpy.mock.calls[0]![2] as { expirationTtl: number };
		expect(opts.expirationTtl).toBeGreaterThanOrEqual(MIN_KV_TTL);
	});

	it("slidingWindow never writes TTL < 60 for sub-minute windows", async () => {
		const kv = createMockKV();
		const putSpy = vi.spyOn(kv, "put");
		// 30s window → TTL formula yields values below 60 near end of window.
		const limiter = slidingWindow({ namespace: kv, limit: 10, window: "30s" });

		// 25s into the 30s window — naive TTL = (30*2 - 25) = 35.
		vi.setSystemTime(new Date("2025-01-01T00:00:25.000Z"));
		await limiter.check("user:1");

		expect(putSpy).toHaveBeenCalled();
		const opts = putSpy.mock.calls[0]![2] as { expirationTtl: number };
		expect(opts.expirationTtl).toBeGreaterThanOrEqual(MIN_KV_TTL);
	});

	it("quota never writes TTL < 60 near end of any window", async () => {
		const kv = createMockKV();
		const putSpy = vi.spyOn(kv, "put");
		const q = quota({ namespace: kv, limits: [{ window: "1m", limit: 10 }] });

		// 50s into the minute — naive TTL would be 10.
		vi.setSystemTime(new Date("2025-01-01T00:00:50.000Z"));
		await q.check("user:1");

		expect(putSpy).toHaveBeenCalled();
		for (const call of putSpy.mock.calls) {
			const opts = call[2] as { expirationTtl?: number } | undefined;
			if (opts?.expirationTtl !== undefined) {
				expect(opts.expirationTtl).toBeGreaterThanOrEqual(MIN_KV_TTL);
			}
		}
	});
});
