import { describe, expect, it } from "vitest";
import { exportKey, generateKey, importKey } from "../src/index";

describe("key management", () => {
	it("generateKey returns a CryptoKey", async () => {
		const key = await generateKey();
		expect(key).toBeInstanceOf(CryptoKey);
	});

	it("generateKey creates extractable AES-GCM keys", async () => {
		const key = await generateKey();
		expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
		expect(key.extractable).toBe(true);
		expect(key.usages).toContain("encrypt");
		expect(key.usages).toContain("decrypt");
	});

	it("export returns a base64 string", async () => {
		const key = await generateKey();
		const exported = await exportKey(key);
		expect(typeof exported).toBe("string");
		expect(exported.length).toBeGreaterThan(0);
		// Should be valid base64
		expect(() => atob(exported)).not.toThrow();
	});

	it("export/import round-trips", async () => {
		const key = await generateKey();
		const exported = await exportKey(key);
		const imported = await importKey(exported);
		expect(imported).toBeInstanceOf(CryptoKey);
		expect(imported.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
	});

	it("imported key can encrypt/decrypt", async () => {
		const { encrypt, decrypt } = await import("../src/index");
		const key = await generateKey();
		const exported = await exportKey(key);
		const imported = await importKey(exported);

		const ciphertext = await encrypt(key, "test data");
		const plaintext = await decrypt(imported, ciphertext);
		expect(plaintext).toBe("test data");
	});

	it("different generateKey calls produce different keys", async () => {
		const key1 = await generateKey();
		const key2 = await generateKey();
		const exp1 = await exportKey(key1);
		const exp2 = await exportKey(key2);
		expect(exp1).not.toBe(exp2);
	});

	it("importKey throws on invalid base64", async () => {
		await expect(importKey("not-valid-base64!!!")).rejects.toThrow();
	});

	it("importKey throws on empty string", async () => {
		await expect(importKey("")).rejects.toThrow();
	});
});
