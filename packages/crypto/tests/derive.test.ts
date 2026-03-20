import { describe, expect, it } from "vitest";
import { deriveKey } from "../src/derive";
import { decrypt, encrypt, exportKey, generateKey } from "../src/index";

describe("deriveKey (PBKDF2 — from password string)", () => {
	it("derives a CryptoKey from password + salt", async () => {
		const key = await deriveKey("my-password", "my-salt");
		expect(key).toBeInstanceOf(CryptoKey);
		expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
	});

	it("same password + salt produces same key", async () => {
		const key1 = await deriveKey("password", "salt");
		const key2 = await deriveKey("password", "salt");
		const exp1 = await exportKey(key1);
		const exp2 = await exportKey(key2);
		expect(exp1).toBe(exp2);
	});

	it("different password produces different key", async () => {
		const key1 = await deriveKey("password1", "salt");
		const key2 = await deriveKey("password2", "salt");
		const exp1 = await exportKey(key1);
		const exp2 = await exportKey(key2);
		expect(exp1).not.toBe(exp2);
	});

	it("different salt produces different key", async () => {
		const key1 = await deriveKey("password", "salt1");
		const key2 = await deriveKey("password", "salt2");
		const exp1 = await exportKey(key1);
		const exp2 = await exportKey(key2);
		expect(exp1).not.toBe(exp2);
	});

	it("derived key can encrypt/decrypt", async () => {
		const key = await deriveKey("secret", "salt");
		const ct = await encrypt(key, "hello");
		const pt = await decrypt(key, ct);
		expect(pt).toBe("hello");
	});
});

describe("deriveKey (HKDF — from CryptoKey + context)", () => {
	it("derives a key from master key + context string", async () => {
		const master = await generateKey();
		const derived = await deriveKey(master, "user:123");
		expect(derived).toBeInstanceOf(CryptoKey);
		expect(derived.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
	});

	it("same master key + same context produces same key", async () => {
		const master = await generateKey();
		const d1 = await deriveKey(master, "ctx");
		const d2 = await deriveKey(master, "ctx");
		const e1 = await exportKey(d1);
		const e2 = await exportKey(d2);
		expect(e1).toBe(e2);
	});

	it("same master key + different context produces different keys", async () => {
		const master = await generateKey();
		const d1 = await deriveKey(master, "user:123");
		const d2 = await deriveKey(master, "session:abc");
		const e1 = await exportKey(d1);
		const e2 = await exportKey(d2);
		expect(e1).not.toBe(e2);
	});

	it("different master keys + same context produces different keys", async () => {
		const m1 = await generateKey();
		const m2 = await generateKey();
		const d1 = await deriveKey(m1, "ctx");
		const d2 = await deriveKey(m2, "ctx");
		const e1 = await exportKey(d1);
		const e2 = await exportKey(d2);
		expect(e1).not.toBe(e2);
	});

	it("derived key can encrypt/decrypt", async () => {
		const master = await generateKey();
		const key = await deriveKey(master, "encryption-context");
		const ct = await encrypt(key, { data: "secret" });
		const pt = await decrypt(key, ct);
		expect(pt).toEqual({ data: "secret" });
	});
});
