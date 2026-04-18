import { describe, expect, it } from "vitest";
import {
	SESSION_WINDOW_MS,
	recordInbound,
	withinSessionWindow,
} from "../../../src/adapters/whatsapp/session-window";
import { createWaDb } from "./_d1";

describe("session window", () => {
	it("withinSessionWindow returns false when no inbound recorded", async () => {
		const db = createWaDb();
		expect(await withinSessionWindow({ db }, "u1")).toBe(false);
	});

	it("returns true within 24h of the last inbound", async () => {
		const db = createWaDb();
		const t = 1_700_000_000_000;
		await recordInbound({ db }, { userId: "u1", at: t });
		expect(await withinSessionWindow({ db, now: () => t + 1000 }, "u1")).toBe(true);
		expect(await withinSessionWindow({ db, now: () => t + SESSION_WINDOW_MS - 1 }, "u1")).toBe(
			true,
		);
	});

	it("returns false when the last inbound is older than 24h", async () => {
		const db = createWaDb();
		const t = 1_700_000_000_000;
		await recordInbound({ db }, { userId: "u1", at: t });
		expect(await withinSessionWindow({ db, now: () => t + SESSION_WINDOW_MS + 1 }, "u1")).toBe(
			false,
		);
	});

	it("recordInbound upserts and last_inbound_at advances", async () => {
		const db = createWaDb();
		await recordInbound({ db }, { userId: "u1", at: 1, text: "hi" });
		await recordInbound({ db }, { userId: "u1", at: 2, text: "again" });
		const row = db.__raw
			.prepare("SELECT last_inbound_at, last_text FROM wa_inbound_log WHERE user_id = ?")
			.get("u1") as { last_inbound_at: number; last_text: string };
		expect(row.last_inbound_at).toBe(2);
		expect(row.last_text).toBe("again");
	});
});
