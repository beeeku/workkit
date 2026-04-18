import { describe, expect, it } from "vitest";
import {
	getOptInProof,
	isOptedIn,
	recordOptIn,
	revokeOptIn,
} from "../../../src/adapters/whatsapp/opt-in";
import type { PhoneCipher } from "../../../src/adapters/whatsapp/phone";
import { createWaDb } from "./_d1";

describe("opt-in proof helpers", () => {
	it("recordOptIn + isOptedIn round-trip", async () => {
		const db = createWaDb();
		await recordOptIn(
			{ db },
			{
				userId: "u1",
				phoneE164: "+919999999999",
				method: "checkbox-signup",
			},
		);
		expect(await isOptedIn({ db }, "u1")).toBe(true);
		expect(await isOptedIn({ db }, "u2")).toBe(false);
	});

	it("revokeOptIn marks revoked_at; isOptedIn returns false after", async () => {
		const db = createWaDb();
		await recordOptIn(
			{ db },
			{ userId: "u1", phoneE164: "+919999999999", method: "checkbox-signup" },
		);
		await revokeOptIn({ db }, "u1", "inbound-stop");
		expect(await isOptedIn({ db }, "u1")).toBe(false);
		const proof = await getOptInProof({ db }, "u1");
		expect(proof?.revokedAt).toBeGreaterThan(0);
		expect(proof?.revokeReason).toBe("inbound-stop");
	});

	it("re-recordOptIn after revoke clears revoked_at", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		await revokeOptIn({ db }, "u1", "test");
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		expect(await isOptedIn({ db }, "u1")).toBe(true);
	});

	it("encrypts the phone number when a cipher is supplied", async () => {
		const db = createWaDb();
		const cipher: PhoneCipher = {
			async encrypt(plain) {
				return `ENC(${plain})`;
			},
			async decrypt(c) {
				return c.replace(/^ENC\(([^)]+)\)$/, "$1");
			},
		};
		await recordOptIn(
			{ db, cipher },
			{
				userId: "u1",
				phoneE164: "+919999999999",
				method: "checkbox-signup",
			},
		);
		const proof = await getOptInProof({ db, cipher }, "u1");
		expect(proof?.phoneE164).toBe("+919999999999");
		// Raw row should hold ciphertext.
		const raw = db.__raw
			.prepare("SELECT phone_e164 FROM wa_optin_proofs WHERE user_id = ?")
			.get("u1") as { phone_e164: string };
		expect(raw.phone_e164).toBe("ENC(+919999999999)");
	});
});
