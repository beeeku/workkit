import { describe, expect, it } from "vitest";
import {
	cacheKey,
	getCached,
	purgeExpiredMedia,
	putCached,
} from "../../../src/adapters/whatsapp/media-cache";
import { createWaDb } from "./_d1";

describe("media-cache", () => {
	it("cacheKey is `<provider>://<r2Key>:<etag>`", () => {
		expect(cacheKey("meta", "reports/u1/r1.pdf", "abc123")).toBe("meta://reports/u1/r1.pdf:abc123");
	});

	it("put + get round-trips", async () => {
		const db = createWaDb();
		const key = cacheKey("meta", "k", "etag1");
		await putCached({ db, now: () => 1000 }, key, {
			provider: "meta",
			mediaId: "mid_1",
			mimeType: "image/png",
			bytes: 42,
		});
		const cached = await getCached({ db, now: () => 1000 }, key);
		expect(cached?.mediaId).toBe("mid_1");
		expect(cached?.mimeType).toBe("image/png");
		expect(cached?.bytes).toBe(42);
	});

	it("returns null when expired (via TTL)", async () => {
		const db = createWaDb();
		const key = cacheKey("meta", "k", "etag1");
		await putCached({ db, now: () => 1000 }, key, {
			provider: "meta",
			mediaId: "mid_1",
			ttlMs: 100,
		});
		// 1000 + 100 = 1100; at t=2000 we're past expiry.
		expect(await getCached({ db, now: () => 2000 }, key)).toBeNull();
	});

	it("purgeExpiredMedia removes rows past their expiry", async () => {
		const db = createWaDb();
		await putCached({ db, now: () => 0 }, cacheKey("meta", "a", "1"), {
			provider: "meta",
			mediaId: "x",
			ttlMs: 100,
		});
		await putCached({ db, now: () => 0 }, cacheKey("meta", "b", "1"), {
			provider: "meta",
			mediaId: "y",
			ttlMs: 100_000,
		});
		const r = await purgeExpiredMedia({ db, now: () => 5000 });
		expect(r.deleted).toBe(1);
	});
});
