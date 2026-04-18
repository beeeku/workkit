import { describe, expect, it } from "vitest";
import { forgetUser } from "../src/forget";
import { MemoryD1, seed } from "./_mocks";

describe("forgetUser()", () => {
	it("cascades through prefs, opt-outs, and deliveries for the user", async () => {
		const d1 = new MemoryD1();
		seed(d1, "notification_prefs", [
			{
				user_id: "u1",
				notification_id: "n1",
				channels: "[]",
				quiet_hours_start: null,
				quiet_hours_end: null,
				timezone: null,
			},
			{
				user_id: "u2",
				notification_id: "n1",
				channels: "[]",
				quiet_hours_start: null,
				quiet_hours_end: null,
				timezone: null,
			},
		]);
		seed(d1, "notification_optouts", [
			{ user_id: "u1", channel: "email", notification_id: "n1", opted_out_at: 0, reason: null },
		]);
		seed(d1, "notification_deliveries", [
			{
				id: "d1",
				user_id: "u1",
				notification_id: "n1",
				channel: "email",
				status: "sent",
				idempotency_key: "k1",
				payload: null,
				provider_id: null,
				error: null,
				attempted_at: 0,
				delivered_at: null,
			},
		]);

		const result = await forgetUser(d1, "u1");
		expect(result).toEqual({ prefsDeleted: 1, optOutsDeleted: 1, deliveriesDeleted: 1 });

		// u2's prefs untouched.
		const survivors = d1.tables.get("notification_prefs")?.rows ?? [];
		expect(survivors).toHaveLength(1);
		expect(survivors[0]?.user_id).toBe("u2");
	});
});
