import { describe, expect, it } from "vitest";
import { WhatsAppPhoneFormatError } from "../../../src/adapters/whatsapp/errors";
import { assertE164, isE164 } from "../../../src/adapters/whatsapp/phone";

describe("isE164() / assertE164()", () => {
	it("accepts well-formed E.164 numbers", () => {
		expect(isE164("+919999999999")).toBe(true);
		expect(isE164("+14155552671")).toBe(true);
		expect(isE164("+442071838750")).toBe(true);
	});

	it("rejects numbers without + prefix", () => {
		expect(isE164("919999999999")).toBe(false);
		expect(() => assertE164("919999999999")).toThrow(WhatsAppPhoneFormatError);
	});

	it("rejects numbers with spaces, dashes, or parens", () => {
		expect(isE164("+91 99999 99999")).toBe(false);
		expect(isE164("+1 (415) 555-2671")).toBe(false);
	});

	it("rejects too-short or too-long numbers", () => {
		expect(isE164("+1234567")).toBe(false);
		expect(isE164("+1234567890123456")).toBe(false);
	});

	it("rejects leading zero in country code", () => {
		expect(isE164("+0123456789")).toBe(false);
	});

	it("trims whitespace before validating", () => {
		expect(assertE164("  +919999999999\n")).toBe("+919999999999");
	});
});
