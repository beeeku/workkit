import { describe, expect, it } from "vitest";
import {
	exportSigningKey,
	generateSigningKeyPair,
	importSigningKey,
	sign,
} from "../src";

describe("sign", () => {
	it("signs and verifies string data", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		const signature = await sign(privateKey, "hello world");
		expect(typeof signature).toBe("string");
		expect(signature.length).toBeGreaterThan(0);
		const valid = await sign.verify(publicKey, "hello world", signature);
		expect(valid).toBe(true);
	});

	it("signs and verifies object data", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		const data = { userId: "123", role: "admin" };
		const signature = await sign(privateKey, data);
		const valid = await sign.verify(publicKey, data, signature);
		expect(valid).toBe(true);
	});

	it("verify fails with wrong public key", async () => {
		const pair1 = await generateSigningKeyPair();
		const pair2 = await generateSigningKeyPair();
		const signature = await sign(pair1.privateKey, "data");
		const valid = await sign.verify(pair2.publicKey, "data", signature);
		expect(valid).toBe(false);
	});

	it("verify fails with tampered data", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		const signature = await sign(privateKey, "original");
		const valid = await sign.verify(publicKey, "tampered", signature);
		expect(valid).toBe(false);
	});

	it("verify fails with tampered signature", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		const signature = await sign(privateKey, "data");
		const tampered = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
		const valid = await sign.verify(publicKey, "data", tampered);
		expect(valid).toBe(false);
	});

	it("handles empty string data", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		const signature = await sign(privateKey, "");
		const valid = await sign.verify(publicKey, "", signature);
		expect(valid).toBe(true);
	});

	it("handles null and numeric data", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		for (const data of [null, 42, true, [1, 2, 3]]) {
			const signature = await sign(privateKey, data);
			const valid = await sign.verify(publicKey, data, signature);
			expect(valid).toBe(true);
		}
	});

	it("handles large data", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		const large = "x".repeat(100_000);
		const sig = await sign(privateKey, large);
		expect(await sign.verify(publicKey, large, sig)).toBe(true);
	});
});

describe("generateSigningKeyPair", () => {
	it("generates Ed25519 key pair by default", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair();
		expect(privateKey).toBeInstanceOf(CryptoKey);
		expect(publicKey).toBeInstanceOf(CryptoKey);
		expect(privateKey.type).toBe("private");
		expect(publicKey.type).toBe("public");
	});

	it("generates ECDSA key pair when specified", async () => {
		const { privateKey, publicKey } = await generateSigningKeyPair("ECDSA");
		expect(privateKey.type).toBe("private");
		expect(publicKey.type).toBe("public");
	});
});

describe("exportSigningKey / importSigningKey", () => {
	it("round-trips public key", async () => {
		const { publicKey, privateKey } = await generateSigningKeyPair();
		const exported = await exportSigningKey(publicKey);
		expect(typeof exported).toBe("string");
		const imported = await importSigningKey(exported, "public");
		const sig = await sign(privateKey, "test");
		const valid = await sign.verify(imported, "test", sig);
		expect(valid).toBe(true);
	});

	it("round-trips private key", async () => {
		const { publicKey, privateKey } = await generateSigningKeyPair();
		const exported = await exportSigningKey(privateKey);
		const imported = await importSigningKey(exported, "private");
		const sig = await sign(imported, "test");
		const valid = await sign.verify(publicKey, "test", sig);
		expect(valid).toBe(true);
	});

	it("throws on empty base64", async () => {
		await expect(importSigningKey("", "public")).rejects.toThrow();
	});
});
