import { decrypt, encrypt } from "./encrypt";
import { exportKey, generateKey, importKey } from "./keys";
import type { SealedEnvelope } from "./types";

/**
 * Envelope encryption — encrypt data with a random DEK,
 * then encrypt the DEK with a master key.
 *
 * Ideal for encrypting data at rest in KV/R2 where you want
 * key rotation without re-encrypting all data.
 */
export const envelope = {
	/**
	 * Seal data using envelope encryption.
	 * Generates a random DEK, encrypts data with it,
	 * then encrypts the DEK with the master key.
	 */
	async seal(masterKey: CryptoKey, data: unknown): Promise<SealedEnvelope> {
		// Generate a random data encryption key (DEK)
		const dek = await generateKey();

		// Encrypt the data with the DEK
		const encryptedData = await encrypt(dek, data);

		// Export and encrypt the DEK with the master key
		const dekExported = await exportKey(dek);
		const encryptedKey = await encrypt(masterKey, dekExported);

		return { encryptedData, encryptedKey };
	},

	/**
	 * Open an envelope — decrypt the DEK with the master key,
	 * then decrypt the data with the DEK.
	 */
	async open(masterKey: CryptoKey, encryptedKey: string, encryptedData: string): Promise<unknown> {
		// Decrypt the DEK
		const dekExported = (await decrypt(masterKey, encryptedKey)) as string;

		// Import the DEK
		const dek = await importKey(dekExported);

		// Decrypt the data with the DEK
		return decrypt(dek, encryptedData);
	},

	/**
	 * Rotate the master key for an existing envelope.
	 * Decrypts the DEK with the old master, re-encrypts with the new master.
	 * Data remains encrypted with the same DEK — O(1) regardless of data size.
	 */
	async rotate(
		oldMasterKey: CryptoKey,
		newMasterKey: CryptoKey,
		encryptedKey: string,
		encryptedData: string,
	): Promise<SealedEnvelope> {
		const dekExported = (await decrypt(oldMasterKey, encryptedKey)) as string;
		const newEncryptedKey = await encrypt(newMasterKey, dekExported);
		return { encryptedData, encryptedKey: newEncryptedKey };
	},
};
