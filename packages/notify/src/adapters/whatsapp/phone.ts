import { WhatsAppPhoneFormatError } from "./errors";

/**
 * E.164: leading `+`, country code (1–3 digits), then 4–14 more digits
 * (total 8–15 digits). No spaces, dashes, or parens.
 */
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function assertE164(value: string): string {
	const trimmed = value.trim();
	if (!E164_RE.test(trimmed)) throw new WhatsAppPhoneFormatError(value);
	return trimmed;
}

export function isE164(value: string): boolean {
	return E164_RE.test(value.trim());
}

/**
 * Optional cipher hook for storing phone numbers at rest. Caller supplies
 * AES-GCM (or any symmetric cipher) `encrypt`/`decrypt` callbacks. The
 * default is identity — phones stored as plain E.164. Switching to a real
 * cipher later does not require a schema migration since the column is
 * declared TEXT (Base64-friendly).
 */
export interface PhoneCipher {
	encrypt(plain: string): Promise<string>;
	decrypt(cipher: string): Promise<string>;
}

export const identityCipher: PhoneCipher = {
	async encrypt(plain) {
		return plain;
	},
	async decrypt(cipher) {
		return cipher;
	},
};
