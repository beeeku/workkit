import { fromBase64, toBase64 } from "./encoding";

/** Generate a new AES-256-GCM CryptoKey */
export async function generateKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
		"encrypt",
		"decrypt",
	]) as Promise<CryptoKey>;
}

/** Export a CryptoKey to a base64 string */
export async function exportKey(key: CryptoKey): Promise<string> {
	const raw = (await crypto.subtle.exportKey("raw", key)) as ArrayBuffer;
	return toBase64(raw);
}

/** Import a base64 string as an AES-256-GCM CryptoKey */
export async function importKey(base64: string): Promise<CryptoKey> {
	if (!base64) throw new Error("Cannot import empty key");
	const raw = fromBase64(base64);
	return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, [
		"encrypt",
		"decrypt",
	]);
}
