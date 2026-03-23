import { describe, expect, it } from "vitest";
import { decryptWithAAD, encryptWithAAD, generateKey } from "../src";

describe("encryptWithAAD / decryptWithAAD", () => {
	it("encrypts and decrypts with AAD", async () => {
		const key = await generateKey();
		const encrypted = await encryptWithAAD(key, "secret", "user:123");
		const decrypted = await decryptWithAAD(key, encrypted, "user:123");
		expect(decrypted).toBe("secret");
	});

	it("decryption fails with wrong AAD", async () => {
		const key = await generateKey();
		const encrypted = await encryptWithAAD(key, "secret", "user:123");
		await expect(decryptWithAAD(key, encrypted, "user:456")).rejects.toThrow();
	});

	it("decryption fails with empty AAD when non-empty was used", async () => {
		const key = await generateKey();
		const encrypted = await encryptWithAAD(key, "secret", "context");
		await expect(decryptWithAAD(key, encrypted, "")).rejects.toThrow();
	});

	it("handles JSON data with AAD", async () => {
		const key = await generateKey();
		const data = { role: "admin", permissions: ["read", "write"] };
		const encrypted = await encryptWithAAD(key, data, "session:abc");
		const decrypted = await decryptWithAAD(key, encrypted, "session:abc");
		expect(decrypted).toEqual(data);
	});

	it("handles special characters in AAD", async () => {
		const key = await generateKey();
		const aad = "user:123|ts:2026-03-24T00:00:00Z|version:3";
		const encrypted = await encryptWithAAD(key, "data", aad);
		const decrypted = await decryptWithAAD(key, encrypted, aad);
		expect(decrypted).toBe("data");
	});
});
