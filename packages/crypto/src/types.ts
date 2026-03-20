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
