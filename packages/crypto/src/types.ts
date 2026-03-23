/** Supported hash algorithms */
export type HashAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

/** Sealed envelope containing encrypted data and encrypted DEK */
export interface SealedEnvelope {
	encryptedData: string;
	encryptedKey: string;
}

/** HMAC function with verify method */
export interface HmacFn {
	(secret: string, data: string): Promise<string>;
	verify(secret: string, data: string, mac: string): Promise<boolean>;
}

/** Supported signing algorithms */
export type SignAlgorithm = "Ed25519" | "ECDSA";

/** Sign function with verify method */
export interface SignFn {
	(privateKey: CryptoKey, data: unknown): Promise<string>;
	verify(publicKey: CryptoKey, data: unknown, signature: string): Promise<boolean>;
}

/** Signing key pair */
export interface SigningKeyPair {
	privateKey: CryptoKey;
	publicKey: CryptoKey;
}
