import { encode, fromBase64, toBase64 } from "./encoding";
import type { SignAlgorithm, SignFn, SigningKeyPair } from "./types";

function serialize(data: unknown): Uint8Array {
	const str = typeof data === "string" ? data : JSON.stringify(data);
	return encode(str);
}

function getAlgorithmParams(
	algorithm: SignAlgorithm,
): string | SubtleCryptoSignAlgorithm {
	if (algorithm === "Ed25519") {
		return { name: "Ed25519" };
	}
	return { name: "ECDSA", hash: "SHA-256" };
}

function getKeyGenParams(
	algorithm: SignAlgorithm,
): string | SubtleCryptoGenerateKeyAlgorithm {
	if (algorithm === "Ed25519") {
		return { name: "Ed25519" };
	}
	return { name: "ECDSA", namedCurve: "P-256" };
}

async function signData(privateKey: CryptoKey, data: unknown): Promise<string> {
	const payload = serialize(data);
	const algorithm = getAlgorithmParams(
		privateKey.algorithm.name === "Ed25519" ? "Ed25519" : "ECDSA",
	);
	const signature = await crypto.subtle.sign(algorithm, privateKey, payload);
	return toBase64(signature);
}

async function verifyData(
	publicKey: CryptoKey,
	data: unknown,
	signature: string,
): Promise<boolean> {
	const payload = serialize(data);
	const algorithm = getAlgorithmParams(
		publicKey.algorithm.name === "Ed25519" ? "Ed25519" : "ECDSA",
	);
	try {
		const sigBytes = fromBase64(signature);
		return await crypto.subtle.verify(algorithm, publicKey, sigBytes, payload);
	} catch {
		return false;
	}
}

/** Sign data with a private key. Returns a base64-encoded signature. */
export const sign: SignFn = Object.assign(signData, { verify: verifyData });

/** Generate a signing key pair (Ed25519 default, ECDSA P-256 fallback). */
export async function generateSigningKeyPair(
	algorithm: SignAlgorithm = "Ed25519",
): Promise<SigningKeyPair> {
	const params = getKeyGenParams(algorithm);
	const keyPair = (await crypto.subtle.generateKey(params, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	return {
		privateKey: keyPair.privateKey,
		publicKey: keyPair.publicKey,
	};
}

/** Export a signing key (public or private) to a base64 string. */
export async function exportSigningKey(key: CryptoKey): Promise<string> {
	const format = key.type === "public" ? "spki" : "pkcs8";
	const exported = await crypto.subtle.exportKey(format, key);
	return toBase64(exported as ArrayBuffer);
}

/** Import a signing key from a base64 string. */
export async function importSigningKey(
	base64: string,
	type: "public" | "private",
	algorithm: SignAlgorithm = "Ed25519",
): Promise<CryptoKey> {
	if (!base64) throw new Error("Cannot import empty key");
	const format = type === "public" ? "spki" : "pkcs8";
	const keyData = fromBase64(base64);
	const params = getKeyGenParams(algorithm);
	const usages = type === "public" ? ["verify"] : ["sign"];
	return crypto.subtle.importKey(
		format,
		keyData,
		params as string | SubtleCryptoImportKeyAlgorithm,
		true,
		usages,
	);
}
