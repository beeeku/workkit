import { describe, expect, it } from "vitest";
import { forgetWhatsAppUser } from "../../../src/adapters/whatsapp/forget";
import { recordOptIn } from "../../../src/adapters/whatsapp/opt-in";
import { recordInbound } from "../../../src/adapters/whatsapp/session-window";
import { createWaDb } from "./_d1";

describe("forgetWhatsAppUser()", () => {
	it("deletes only the supplied user's opt-in proof + inbound log rows", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		await recordOptIn({ db }, { userId: "u2", phoneE164: "+918888888888", method: "x" });
		await recordInbound({ db }, { userId: "u1", at: 100 });
		await recordInbound({ db }, { userId: "u2", at: 100 });

		const r = await forgetWhatsAppUser(db, "u1");
		expect(r.optInRowsDeleted).toBe(1);
		expect(r.inboundLogRowsDeleted).toBe(1);
		expect(r.mediaCacheRowsDeleted).toBe(0);

		const survivors = db.__raw.prepare("SELECT user_id FROM wa_optin_proofs").all() as {
			user_id: string;
		}[];
		expect(survivors).toEqual([{ user_id: "u2" }]);
	});
});
