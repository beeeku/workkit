import { describe, expect, it } from "vitest";
import { envelope, generateKey } from "../src";

describe("envelope.rotate", () => {
	it("rotates master key and data remains decryptable", async () => {
		const oldMaster = await generateKey();
		const newMaster = await generateKey();
		const sealed = await envelope.seal(oldMaster, { secret: "data" });
		const rotated = await envelope.rotate(
			oldMaster,
			newMaster,
			sealed.encryptedKey,
			sealed.encryptedData,
		);
		const result = await envelope.open(newMaster, rotated.encryptedKey, rotated.encryptedData);
		expect(result).toEqual({ secret: "data" });
	});

	it("old master key cannot decrypt after rotation", async () => {
		const oldMaster = await generateKey();
		const newMaster = await generateKey();
		const sealed = await envelope.seal(oldMaster, "sensitive");
		const rotated = await envelope.rotate(
			oldMaster,
			newMaster,
			sealed.encryptedKey,
			sealed.encryptedData,
		);
		await expect(
			envelope.open(oldMaster, rotated.encryptedKey, rotated.encryptedData),
		).rejects.toThrow();
	});

	it("preserves original data integrity", async () => {
		const oldMaster = await generateKey();
		const newMaster = await generateKey();
		const originalData = { users: [1, 2, 3], nested: { deep: true } };
		const sealed = await envelope.seal(oldMaster, originalData);
		const rotated = await envelope.rotate(
			oldMaster,
			newMaster,
			sealed.encryptedKey,
			sealed.encryptedData,
		);
		const result = await envelope.open(newMaster, rotated.encryptedKey, rotated.encryptedData);
		expect(result).toEqual(originalData);
	});

	it("supports multiple sequential rotations", async () => {
		const key1 = await generateKey();
		const key2 = await generateKey();
		const key3 = await generateKey();
		const sealed = await envelope.seal(key1, "multi-rotate");
		const rotated1 = await envelope.rotate(key1, key2, sealed.encryptedKey, sealed.encryptedData);
		const rotated2 = await envelope.rotate(
			key2,
			key3,
			rotated1.encryptedKey,
			rotated1.encryptedData,
		);
		const result = await envelope.open(key3, rotated2.encryptedKey, rotated2.encryptedData);
		expect(result).toBe("multi-rotate");
	});

	it("throws with invalid old master key", async () => {
		const realMaster = await generateKey();
		const wrongMaster = await generateKey();
		const newMaster = await generateKey();
		const sealed = await envelope.seal(realMaster, "data");
		await expect(
			envelope.rotate(wrongMaster, newMaster, sealed.encryptedKey, sealed.encryptedData),
		).rejects.toThrow();
	});
});
