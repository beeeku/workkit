// AES-256-GCM encryption helpers for fact text.
//
// Wire format (base64-encoded): [12-byte IV][ciphertext + 16-byte GCM tag]
// Independent of @workkit/crypto so callers don't take an extra dep.

const IV_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export async function encryptText(plaintext: string, key: CryptoKey): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const cipher = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
	);
	const out = new Uint8Array(iv.length + cipher.length);
	out.set(iv, 0);
	out.set(cipher, iv.length);
	return toBase64(out);
}

export async function decryptText(ciphertext: string, key: CryptoKey): Promise<string> {
	const buf = fromBase64(ciphertext);
	if (buf.length < IV_BYTES) throw new Error("ciphertext too short");
	const iv = buf.subarray(0, IV_BYTES);
	const data = buf.subarray(IV_BYTES);
	const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
	return new TextDecoder().decode(plain);
}
