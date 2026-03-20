import { describe, expect, it } from "vitest";
import { envelope } from "../src/envelope";
import { generateKey } from "../src/index";

describe("envelope encryption", () => {
	it("seal returns encryptedData and encryptedKey", async () => {
		const master = await generateKey();
		const sealed = await envelope.seal(master, "sensitive data");
		expect(typeof sealed.encryptedData).toBe("string");
		expect(typeof sealed.encryptedKey).toBe("string");
		expect(sealed.encryptedData.length).toBeGreaterThan(0);
		expect(sealed.encryptedKey.length).toBeGreaterThan(0);
	});

	it("seal/open round-trips a string", async () => {
		const master = await generateKey();
		const sealed = await envelope.seal(master, "sensitive data");
		const data = await envelope.open(master, sealed.encryptedKey, sealed.encryptedData);
		expect(data).toBe("sensitive data");
	});

	it("seal/open round-trips an object", async () => {
		const master = await generateKey();
		const obj = { userId: "123", permissions: ["read", "write"] };
		const sealed = await envelope.seal(master, obj);
		const data = await envelope.open(master, sealed.encryptedKey, sealed.encryptedData);
		expect(data).toEqual(obj);
	});

	it("each seal produces a unique DEK (different ciphertext)", async () => {
		const master = await generateKey();
		const s1 = await envelope.seal(master, "same data");
		const s2 = await envelope.seal(master, "same data");
		expect(s1.encryptedData).not.toBe(s2.encryptedData);
		expect(s1.encryptedKey).not.toBe(s2.encryptedKey);
	});

	it("open fails with wrong master key", async () => {
		const master1 = await generateKey();
		const master2 = await generateKey();
		const sealed = await envelope.seal(master1, "secret");
		await expect(
			envelope.open(master2, sealed.encryptedKey, sealed.encryptedData),
		).rejects.toThrow();
	});

	it("open fails with corrupted encryptedKey", async () => {
		const master = await generateKey();
		const sealed = await envelope.seal(master, "secret");
		await expect(
			envelope.open(master, `${sealed.encryptedKey}XX`, sealed.encryptedData),
		).rejects.toThrow();
	});

	it("open fails with corrupted encryptedData", async () => {
		const master = await generateKey();
		const sealed = await envelope.seal(master, "secret");
		await expect(
			envelope.open(master, sealed.encryptedKey, `${sealed.encryptedData}XX`),
		).rejects.toThrow();
	});

	it("round-trips a large payload", async () => {
		const master = await generateKey();
		const large = { data: "x".repeat(50_000) };
		const sealed = await envelope.seal(master, large);
		const result = await envelope.open(master, sealed.encryptedKey, sealed.encryptedData);
		expect(result).toEqual(large);
	});
});
