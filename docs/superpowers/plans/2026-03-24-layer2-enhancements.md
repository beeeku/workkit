# Layer 2 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 14 new features across 5 Layer 2 packages following TDD and Karpathy principles.

**Architecture:** Wave 1 packages (crypto, cron, ratelimit) are independent — implement in parallel with subagents. Wave 2 packages (queue, do) build on patterns from Wave 1. Each feature follows TDD: write failing test → implement → verify → commit.

**Tech Stack:** TypeScript, Vitest, WebCrypto API, Cloudflare KV, Cloudflare Workers types, Biome (lint/format)

**Spec:** `docs/superpowers/specs/2026-03-24-layer2-enhancements-design.md`

---

## Wave 1: Independent Packages (Parallel)

---

### Task 1: @workkit/crypto — Digital Signatures

**Files:**
- Create: `packages/crypto/src/sign.ts`
- Create: `packages/crypto/tests/sign.test.ts`
- Modify: `packages/crypto/src/index.ts`
- Modify: `packages/crypto/src/types.ts`

- [ ] **Step 1: Add SignFn type to types.ts**

Add after `HmacFn` interface at line 14 of `packages/crypto/src/types.ts`:

```ts
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
```

- [ ] **Step 2: Write failing tests for sign/verify**

Create `packages/crypto/tests/sign.test.ts`:

```ts
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
		// Tamper by changing a character
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
		// Verify imported key works
		const sig = await sign(privateKey, "test");
		const valid = await sign.verify(imported, "test", sig);
		expect(valid).toBe(true);
	});

	it("round-trips private key", async () => {
		const { publicKey, privateKey } = await generateSigningKeyPair();
		const exported = await exportSigningKey(privateKey);
		const imported = await importSigningKey(exported, "private");
		// Verify imported key works
		const sig = await sign(imported, "test");
		const valid = await sign.verify(publicKey, "test", sig);
		expect(valid).toBe(true);
	});

	it("throws on empty base64", async () => {
		await expect(importSigningKey("", "public")).rejects.toThrow();
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/crypto && bun run test -- --run tests/sign.test.ts`
Expected: FAIL — imports don't exist yet

- [ ] **Step 4: Implement sign.ts**

Create `packages/crypto/src/sign.ts`:

```ts
import { encode, fromBase64, toBase64 } from "./encoding";
import type { SignAlgorithm, SignFn, SigningKeyPair } from "./types";

function serialize(data: unknown): Uint8Array {
	const str = typeof data === "string" ? data : JSON.stringify(data);
	return encode(str);
}

function getAlgorithmParams(algorithm: SignAlgorithm): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | EcdsaParams {
	if (algorithm === "Ed25519") {
		return { name: "Ed25519" };
	}
	return { name: "ECDSA", hash: "SHA-256" } as EcdsaParams;
}

function getKeyGenParams(algorithm: SignAlgorithm): AlgorithmIdentifier | RsaHashedKeyGenParams | EcKeyGenParams {
	if (algorithm === "Ed25519") {
		return { name: "Ed25519" };
	}
	return { name: "ECDSA", namedCurve: "P-256" } as EcKeyGenParams;
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
	const sigBytes = fromBase64(signature);
	const algorithm = getAlgorithmParams(
		publicKey.algorithm.name === "Ed25519" ? "Ed25519" : "ECDSA",
	);
	try {
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
	const keyPair = await crypto.subtle.generateKey(params, true, ["sign", "verify"]);
	return {
		privateKey: keyPair.privateKey,
		publicKey: keyPair.publicKey,
	};
}

/** Export a signing key (public or private) to a base64 string. */
export async function exportSigningKey(key: CryptoKey): Promise<string> {
	const format = key.type === "public" ? "spki" : "pkcs8";
	const exported = await crypto.subtle.exportKey(format, key);
	return toBase64(exported);
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
	const usages: KeyUsage[] = type === "public" ? ["verify"] : ["sign"];
	return crypto.subtle.importKey(format, keyData, params, true, usages);
}
```

- [ ] **Step 5: Update index.ts exports**

Add to `packages/crypto/src/index.ts`:

```ts
// Signing
export { sign, generateSigningKeyPair, exportSigningKey, importSigningKey } from "./sign";

// Envelope encryption
export { envelope } from "./envelope";

// Types
export type { SignAlgorithm, SignFn, SigningKeyPair } from "./types";
```

Update the existing type export line to include the new types.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/crypto && bun run test -- --run`
Expected: ALL PASS (new + existing)

- [ ] **Step 7: Run lint**

Run: `cd packages/crypto && npx biome check src/`
Fix any issues.

- [ ] **Step 8: Commit**

```bash
git add packages/crypto/src/sign.ts packages/crypto/tests/sign.test.ts packages/crypto/src/index.ts packages/crypto/src/types.ts
git commit -m "feat(crypto): add digital signatures (sign/verify, Ed25519/ECDSA)"
```

---

### Task 2: @workkit/crypto — Key Rotation

**Depends on:** Task 1 Step 5 (envelope export in index.ts must exist)

**Files:**
- Modify: `packages/crypto/src/envelope.ts`
- Create: `packages/crypto/tests/rotate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/crypto/tests/rotate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { envelope, generateKey } from "../src";

describe("envelope.rotate", () => {
	it("rotates master key and data remains decryptable", async () => {
		const oldMaster = await generateKey();
		const newMaster = await generateKey();

		// Seal with old master
		const sealed = await envelope.seal(oldMaster, { secret: "data" });

		// Rotate to new master
		const rotated = await envelope.rotate(
			oldMaster,
			newMaster,
			sealed.encryptedKey,
			sealed.encryptedData,
		);

		// Decrypt with new master
		const result = await envelope.open(
			newMaster,
			rotated.encryptedKey,
			rotated.encryptedData,
		);
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

		// Old master should fail to decrypt rotated envelope
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
		const rotated2 = await envelope.rotate(key2, key3, rotated1.encryptedKey, rotated1.encryptedData);

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/crypto && bun run test -- --run tests/rotate.test.ts`
Expected: FAIL — `envelope.rotate` doesn't exist

- [ ] **Step 3: Implement rotate in envelope.ts**

Add to `packages/crypto/src/envelope.ts` after the `open` method (before closing `}`):

```ts
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
		// Decrypt the DEK with old master
		const dekExported = (await decrypt(oldMasterKey, encryptedKey)) as string;

		// Re-encrypt the DEK with new master
		const newEncryptedKey = await encrypt(newMasterKey, dekExported);

		// Data stays as-is — still encrypted with the same DEK
		return { encryptedData, encryptedKey: newEncryptedKey };
	},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/crypto && bun run test -- --run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/crypto/src/envelope.ts packages/crypto/tests/rotate.test.ts
git commit -m "feat(crypto): add envelope key rotation"
```

---

### Task 3: @workkit/crypto — Authenticated Metadata (AAD)

**Files:**
- Modify: `packages/crypto/src/encrypt.ts`
- Create: `packages/crypto/tests/aad.test.ts`
- Modify: `packages/crypto/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/crypto/tests/aad.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/crypto && bun run test -- --run tests/aad.test.ts`
Expected: FAIL — functions don't exist

- [ ] **Step 3: Implement encryptWithAAD and decryptWithAAD**

Add to `packages/crypto/src/encrypt.ts` after the `decrypt` function:

```ts
/**
 * Encrypt data with AES-256-GCM and Additional Authenticated Data (AAD).
 *
 * The AAD is verified during decryption but never encrypted — if tampered
 * with, decryption fails. Use for embedding user IDs, timestamps, or
 * version numbers that must be verified but don't need secrecy.
 */
export async function encryptWithAAD(
	key: CryptoKey,
	data: unknown,
	aad: string,
): Promise<string> {
	const plaintext = typeof data === "string" ? data : JSON.stringify(data);
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoded = encode(plaintext);
	const additionalData = encode(aad);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData },
		key,
		encoded,
	);

	const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), IV_LENGTH);

	return toBase64(combined);
}

/**
 * Decrypt an AES-256-GCM ciphertext produced by `encryptWithAAD()`.
 *
 * The same AAD used during encryption must be provided. If the AAD
 * doesn't match, decryption throws (AES-GCM guarantees this).
 */
export async function decryptWithAAD(
	key: CryptoKey,
	ciphertext: string,
	aad: string,
): Promise<unknown> {
	if (!ciphertext) throw new Error("Cannot decrypt empty ciphertext");

	const combined = fromBase64(ciphertext);
	if (combined.length <= IV_LENGTH) {
		throw new Error("Ciphertext too short");
	}

	const iv = combined.slice(0, IV_LENGTH);
	const data = combined.slice(IV_LENGTH);
	const additionalData = encode(aad);

	const plainBuffer = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv, additionalData },
		key,
		data,
	);

	const plaintext = decode(plainBuffer);

	try {
		return JSON.parse(plaintext);
	} catch {
		return plaintext;
	}
}
```

- [ ] **Step 4: Update index.ts**

Add to exports in `packages/crypto/src/index.ts`:

```ts
export { encryptWithAAD, decryptWithAAD } from "./encrypt";
```

- [ ] **Step 5: Run all crypto tests**

Run: `cd packages/crypto && bun run test -- --run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/crypto/src/encrypt.ts packages/crypto/tests/aad.test.ts packages/crypto/src/index.ts
git commit -m "feat(crypto): add authenticated metadata encryption (AAD)"
```

---

### Task 4: @workkit/cron — Jitter Middleware

**Files:**
- Modify: `packages/cron/src/middleware.ts`
- Modify: `packages/cron/tests/middleware.test.ts`
- Modify: `packages/cron/src/index.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/cron/tests/middleware.test.ts` (new describe block):

```ts
describe("withJitter", () => {
	it("executes handler after a delay", async () => {
		const handler = vi.fn();
		const jittered = withJitter(0.1)(handler, "test-task");

		await jittered(createMockEvent("0 * * * *"), {} as any, createMockCtx());
		expect(handler).toHaveBeenCalledOnce();
	});

	it("delay is within range", async () => {
		const start = Date.now();
		const handler = vi.fn();
		const jittered = withJitter(0.05)(handler, "test-task");

		await jittered(createMockEvent("0 * * * *"), {} as any, createMockCtx());
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThanOrEqual(100); // 50ms max + some margin
	});

	it("propagates handler errors through jitter", async () => {
		const handler = vi.fn().mockRejectedValue(new Error("task failed"));
		const jittered = withJitter(0.01)(handler, "test-task");

		await expect(jittered(createMockEvent("0 * * * *"), {} as any, createMockCtx())).rejects.toThrow("task failed");
	});

	it("throws ValidationError for zero maxSeconds", async () => {
		expect(() => withJitter(0)).toThrow();
	});

	it("throws ValidationError for negative maxSeconds", async () => {
		expect(() => withJitter(-1)).toThrow();
	});
});
```

Note: Import `createMockEvent` and `createMockCtx` from `./helpers/mock`. Also add `withJitter` to the existing import from `"../src/middleware"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cron && bun run test -- --run tests/middleware.test.ts`
Expected: FAIL — `withJitter` not defined

- [ ] **Step 3: Implement withJitter**

Add to `packages/cron/src/middleware.ts` after the `withErrorReporting` function:

```ts
/**
 * Create a middleware that adds random jitter delay before task execution.
 * Prevents thundering herd when multiple Workers fire the same cron.
 *
 * @param maxSeconds Maximum jitter delay in seconds
 * @returns Middleware that delays execution by a random amount
 */
export function withJitter<E = unknown>(maxSeconds: number): CronMiddleware<E> {
	if (maxSeconds <= 0) {
		throw new ValidationError("maxSeconds must be positive", [
			{ path: ["maxSeconds"], message: `Expected positive number, got ${maxSeconds}` },
		]);
	}

	return (handler: CronTaskHandler<E>, _taskName: string): CronTaskHandler<E> => {
		return async (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void> => {
			const delayMs = Math.random() * maxSeconds * 1000;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			await handler(event, env, ctx);
		};
	};
}
```

Add `ValidationError` import at the top of the file:
```ts
import { ValidationError } from "@workkit/errors";
```

- [ ] **Step 4: Update index.ts**

In `packages/cron/src/index.ts`, update the middleware export line:

```ts
export { withTimeout, withRetry, withErrorReporting, withJitter } from "./middleware";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/cron && bun run test -- --run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cron/src/middleware.ts packages/cron/tests/middleware.test.ts packages/cron/src/index.ts
git commit -m "feat(cron): add withJitter middleware for thundering herd prevention"
```

---

### Task 5: @workkit/cron — Cron Builder API

**Files:**
- Create: `packages/cron/src/builder.ts`
- Create: `packages/cron/tests/builder.test.ts`
- Modify: `packages/cron/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/cron/tests/builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cron } from "../src";

describe("cron builder", () => {
	it("every minute", () => {
		expect(cron().every().minute().build()).toBe("* * * * *");
	});

	it("every N minutes", () => {
		expect(cron().every(15).minutes().build()).toBe("*/15 * * * *");
	});

	it("every hour", () => {
		expect(cron().every().hour().build()).toBe("0 * * * *");
	});

	it("every N hours", () => {
		expect(cron().every(2).hours().build()).toBe("0 */2 * * *");
	});

	it("every day at specific time", () => {
		expect(cron().every().day().at(9, 0).build()).toBe("0 9 * * *");
	});

	it("every day at hour only (minute defaults to 0)", () => {
		expect(cron().every().day().at(9).build()).toBe("0 9 * * *");
	});

	it("every weekday at specific time", () => {
		expect(cron().every().weekday().at(9).build()).toBe("0 9 * * 1-5");
	});

	it("on specific day of week", () => {
		expect(cron().on().monday().at(14, 30).build()).toBe("30 14 * * 1");
	});

	it("on first of month", () => {
		expect(cron().on().day(1).at(0).build()).toBe("0 0 1 * *");
	});

	it("every month", () => {
		expect(cron().every().month().on().day(15).at(8).build()).toBe("0 8 15 * *");
	});

	it("toString works for template literals", () => {
		const expr = `${cron().every(5).minutes()}`;
		expect(expr).toBe("*/5 * * * *");
	});

	it("validates output", () => {
		// This should not throw — valid expression
		expect(() => cron().every().minute().build()).not.toThrow();
	});

	it("singular and plural aliases work the same", () => {
		expect(cron().every().minute().build()).toBe(cron().every().minutes().build());
		expect(cron().every().hour().build()).toBe(cron().every().hours().build());
	});

	it("all days of week", () => {
		expect(cron().on().tuesday().at(10).build()).toBe("0 10 * * 2");
		expect(cron().on().wednesday().at(10).build()).toBe("0 10 * * 3");
		expect(cron().on().thursday().at(10).build()).toBe("0 10 * * 4");
		expect(cron().on().friday().at(10).build()).toBe("0 10 * * 5");
		expect(cron().on().saturday().at(10).build()).toBe("0 10 * * 6");
		expect(cron().on().sunday().at(10).build()).toBe("0 10 * * 0");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cron && bun run test -- --run tests/builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the cron builder**

Create `packages/cron/src/builder.ts`:

```ts
import { ValidationError } from "@workkit/errors";
import { isValidCron } from "./parser";

interface CronState {
	minute: string;
	hour: string;
	dayOfMonth: string;
	month: string;
	dayOfWeek: string;
}

export interface CronBuilder {
	every(n?: number): EveryBuilder;
	at(hour: number, minute?: number): CronBuilder;
	on(): OnBuilder;
	build(): string;
	toString(): string;
}

export interface EveryBuilder {
	minute(): CronBuilder;
	minutes(): CronBuilder;
	hour(): CronBuilder;
	hours(): CronBuilder;
	day(): CronBuilder;
	weekday(): CronBuilder;
	month(): CronBuilder;
}

export interface OnBuilder {
	monday(): CronBuilder;
	tuesday(): CronBuilder;
	wednesday(): CronBuilder;
	thursday(): CronBuilder;
	friday(): CronBuilder;
	saturday(): CronBuilder;
	sunday(): CronBuilder;
	day(n: number): CronBuilder;
}

function createBuilder(state: CronState): CronBuilder {
	const builder: CronBuilder = {
		every(n?: number) {
			return createEveryBuilder({ ...state }, n);
		},
		at(hour: number, minute = 0) {
			return createBuilder({ ...state, hour: String(hour), minute: String(minute) });
		},
		on() {
			return createOnBuilder({ ...state });
		},
		build() {
			const expr = `${state.minute} ${state.hour} ${state.dayOfMonth} ${state.month} ${state.dayOfWeek}`;
			if (!isValidCron(expr)) {
				throw new ValidationError("Invalid cron expression generated", [
				{ path: ["expression"], message: expr },
			]);
			}
			return expr;
		},
		toString() {
			return builder.build();
		},
	};
	return builder;
}

function createEveryBuilder(state: CronState, n?: number): EveryBuilder {
	return {
		minute() {
			return createBuilder({ ...state, minute: n ? `*/${n}` : "*" });
		},
		minutes() {
			return this.minute();
		},
		hour() {
			return createBuilder({
				...state,
				minute: "0",
				hour: n ? `*/${n}` : "*",
			});
		},
		hours() {
			return this.hour();
		},
		day() {
			return createBuilder({ ...state, minute: state.minute === "*" ? "0" : state.minute, hour: state.hour === "*" ? "0" : state.hour });
		},
		weekday() {
			return createBuilder({
				...state,
				minute: state.minute === "*" ? "0" : state.minute,
				hour: state.hour === "*" ? "0" : state.hour,
				dayOfWeek: "1-5",
			});
		},
		month() {
			return createBuilder({
				...state,
				minute: state.minute === "*" ? "0" : state.minute,
				hour: state.hour === "*" ? "0" : state.hour,
			});
		},
	};
}

function createOnBuilder(state: CronState): OnBuilder {
	const withDay = (dow: number) =>
		createBuilder({
			...state,
			minute: state.minute === "*" ? "0" : state.minute,
			hour: state.hour === "*" ? "0" : state.hour,
			dayOfWeek: String(dow),
		});

	return {
		monday() { return withDay(1); },
		tuesday() { return withDay(2); },
		wednesday() { return withDay(3); },
		thursday() { return withDay(4); },
		friday() { return withDay(5); },
		saturday() { return withDay(6); },
		sunday() { return withDay(0); },
		day(n: number) {
			return createBuilder({
				...state,
				minute: state.minute === "*" ? "0" : state.minute,
				hour: state.hour === "*" ? "0" : state.hour,
				dayOfMonth: String(n),
			});
		},
	};
}

/** Create a cron expression using a fluent builder API. */
export function cron(): CronBuilder {
	return createBuilder({
		minute: "*",
		hour: "*",
		dayOfMonth: "*",
		month: "*",
		dayOfWeek: "*",
	});
}
```

- [ ] **Step 4: Update index.ts**

Add to `packages/cron/src/index.ts`:

```ts
// Builder
export { cron } from "./builder";
export type { CronBuilder, EveryBuilder, OnBuilder } from "./builder";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/cron && bun run test -- --run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cron/src/builder.ts packages/cron/tests/builder.test.ts packages/cron/src/index.ts
git commit -m "feat(cron): add fluent cron builder API"
```

---

### Task 6: @workkit/cron — Task Dependencies

**Files:**
- Modify: `packages/cron/src/types.ts`
- Modify: `packages/cron/src/handler.ts`
- Modify: `packages/cron/tests/handler.test.ts`

- [ ] **Step 1: Update CronTask type**

In `packages/cron/src/types.ts`, add `after` field to `CronTask` (line 4-9):

```ts
export interface CronTask<E = unknown> {
	/** Cron expression (e.g. '0 * * * *') */
	schedule: string;
	/** Task handler function */
	handler: CronTaskHandler<E>;
	/** Task names that must complete before this task runs */
	after?: string[];
}
```

Add `parallel` to `CronHandlerOptions`:

```ts
export interface CronHandlerOptions<E = unknown> {
	tasks: CronTaskMap<E>;
	middleware?: CronMiddleware<E>[];
	onNoMatch?: (event: ScheduledEvent, env: E, ctx: ExecutionContext) => void | Promise<void>;
	/** Run independent tasks in parallel (default: false for backward compat) */
	parallel?: boolean;
}
```

- [ ] **Step 2: Write failing tests**

Add to `packages/cron/tests/handler.test.ts`:

```ts
describe("task dependencies", () => {
	it("executes tasks in dependency order", async () => {
		const order: string[] = [];
		const handler = createCronHandler({
			tasks: {
				fetch: {
					schedule: "0 * * * *",
					handler: async () => { order.push("fetch"); },
				},
				process: {
					schedule: "0 * * * *",
					handler: async () => { order.push("process"); },
					after: ["fetch"],
				},
				notify: {
					schedule: "0 * * * *",
					handler: async () => { order.push("notify"); },
					after: ["process"],
				},
			},
		});

		await handler(createMockEvent("0 * * * *"), {} as any, createMockCtx());
		expect(order).toEqual(["fetch", "process", "notify"]);
	});

	it("skips dependents when dependency fails", async () => {
		const order: string[] = [];
		const handler = createCronHandler({
			tasks: {
				fetch: {
					schedule: "0 * * * *",
					handler: async () => { throw new Error("fetch failed"); },
				},
				process: {
					schedule: "0 * * * *",
					handler: async () => { order.push("process"); },
					after: ["fetch"],
				},
			},
		});

		await expect(handler(createMockEvent("0 * * * *"), {} as any, createMockCtx())).rejects.toThrow("fetch failed");
		expect(order).toEqual([]); // process was skipped
	});

	it("throws ValidationError for circular dependencies", () => {
		expect(() =>
			createCronHandler({
				tasks: {
					a: { schedule: "0 * * * *", handler: async () => {}, after: ["b"] },
					b: { schedule: "0 * * * *", handler: async () => {}, after: ["a"] },
				},
			}),
		).toThrow();
	});

	it("tasks without dependencies preserve sequential behavior by default", async () => {
		const order: string[] = [];
		const handler = createCronHandler({
			tasks: {
				first: { schedule: "0 * * * *", handler: async () => { order.push("first"); } },
				second: { schedule: "0 * * * *", handler: async () => { order.push("second"); } },
			},
		});

		await handler(createMockEvent("0 * * * *"), {} as any, createMockCtx());
		expect(order).toEqual(["first", "second"]);
	});
});
```

Note: Import `createMockEvent` and `createMockCtx` from `./helpers/mock`. The test code above already uses the correct names.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/cron && bun run test -- --run tests/handler.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement dependency resolution in handler.ts**

Replace `packages/cron/src/handler.ts` with updated version that includes topological sort:

```ts
import { ValidationError } from "@workkit/errors";
import type { ExecutionContext, ScheduledEvent } from "@workkit/types";
import { matchCron } from "./matcher";
import type { CronHandler, CronHandlerOptions, CronMiddleware, CronTaskHandler } from "./types";

function applyMiddleware<E>(
	handler: CronTaskHandler<E>,
	middleware: CronMiddleware<E>[],
	taskName: string,
): CronTaskHandler<E> {
	let wrapped = handler;
	for (let i = middleware.length - 1; i >= 0; i--) {
		wrapped = middleware[i]!(wrapped, taskName);
	}
	return wrapped;
}

/** Topological sort using Kahn's algorithm. Returns sorted names or throws on cycle. */
function topoSort(tasks: Map<string, string[]>): string[] {
	const inDegree = new Map<string, number>();
	const adj = new Map<string, string[]>();

	for (const name of tasks.keys()) {
		inDegree.set(name, 0);
		adj.set(name, []);
	}

	for (const [name, deps] of tasks) {
		for (const dep of deps) {
			if (!tasks.has(dep)) continue; // dependency not in matched set — skip
			adj.get(dep)!.push(name);
			inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
		}
	}

	const queue: string[] = [];
	for (const [name, degree] of inDegree) {
		if (degree === 0) queue.push(name);
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift()!;
		sorted.push(current);
		for (const neighbor of adj.get(current) ?? []) {
			const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
			inDegree.set(neighbor, newDegree);
			if (newDegree === 0) queue.push(neighbor);
		}
	}

	if (sorted.length !== tasks.size) {
		throw new ValidationError("Circular dependency detected in cron tasks", [
			{ path: ["tasks"], message: `Cycle detected among: ${[...tasks.keys()].join(", ")}` },
		]);
	}

	return sorted;
}

export function createCronHandler<E = unknown>(options: CronHandlerOptions<E>): CronHandler<E> {
	const { tasks, middleware = [], onNoMatch, parallel = false } = options;

	// Validate dependencies at creation time
	const allDeps = new Map<string, string[]>();
	for (const [name, task] of Object.entries(tasks)) {
		allDeps.set(name, task.after ?? []);
	}
	topoSort(allDeps); // throws on cycle

	return async (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void> => {
		const matched = new Map<string, { handler: CronTaskHandler<E>; after: string[] }>();

		for (const [name, task] of Object.entries(tasks)) {
			if (matchCron(task.schedule, event.cron)) {
				const wrappedHandler =
					middleware.length > 0 ? applyMiddleware(task.handler, middleware, name) : task.handler;
				matched.set(name, { handler: wrappedHandler, after: task.after ?? [] });
			}
		}

		if (matched.size === 0) {
			if (onNoMatch) {
				await onNoMatch(event, env, ctx);
			}
			return;
		}

		// Topological sort matched tasks
		const matchedDeps = new Map<string, string[]>();
		for (const [name, { after }] of matched) {
			matchedDeps.set(name, after);
		}
		const sortedNames = topoSort(matchedDeps);

		const errors: Error[] = [];
		const failed = new Set<string>();

		for (const name of sortedNames) {
			const task = matched.get(name)!;

			// Skip if any dependency failed
			const depFailed = task.after.some((dep) => failed.has(dep));
			if (depFailed) {
				failed.add(name);
				continue;
			}

			try {
				await task.handler(event, env, ctx);
			} catch (error) {
				failed.add(name);
				errors.push(error instanceof Error ? error : new Error(String(error)));
			}
		}

		if (errors.length > 0) {
			throw errors[0];
		}
	};
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/cron && bun run test -- --run`
Expected: ALL PASS (new + existing)

- [ ] **Step 6: Commit**

```bash
git add packages/cron/src/types.ts packages/cron/src/handler.ts packages/cron/tests/handler.test.ts
git commit -m "feat(cron): add task dependencies with topological sort"
```

---

### Task 7: @workkit/ratelimit — Tiered Rate Limiting

**Files:**
- Create: `packages/ratelimit/src/tiered.ts`
- Create: `packages/ratelimit/tests/tiered.test.ts`
- Modify: `packages/ratelimit/src/types.ts`
- Modify: `packages/ratelimit/src/index.ts`

- [ ] **Step 1: Add types**

Add to `packages/ratelimit/src/types.ts`:

```ts
/** Options for tiered rate limiter */
export interface TieredOptions {
	/** KV namespace */
	namespace: KVNamespace;
	/** Tier configurations */
	tiers: Record<string, TierConfig>;
	/** Window duration */
	window: Duration;
	/** Default tier name when unknown tier is provided */
	defaultTier?: string;
	/** Algorithm to use (default: 'fixed') */
	algorithm?: "fixed" | "sliding";
	/** Optional key prefix */
	prefix?: string;
}

/** Configuration for a single tier */
export interface TierConfig {
	/** Maximum requests per window. Use Infinity for unlimited. */
	limit: number;
}

/** A tiered rate limiter with per-tier checks */
export interface TieredRateLimiter {
	/** Check rate limit for a key at a specific tier */
	check(key: string, tier: string): Promise<RateLimitResult>;
	/** Get a single-arg RateLimiter for a specific tier (for use with composite) */
	forTier(tier: string): RateLimiter;
}
```

- [ ] **Step 2: Write failing tests**

Create `packages/ratelimit/tests/tiered.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { tiered } from "../src";

function createMockKV() {
	const store = new Map<string, string>();
	return {
		get: vi.fn(async (key: string, type?: string) => {
			const val = store.get(key);
			if (!val) return null;
			return type === "json" ? JSON.parse(val) : val;
		}),
		put: vi.fn(async (key: string, value: string, _opts?: any) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => { store.delete(key); }),
	} as unknown as KVNamespace;
}

describe("tiered", () => {
	it("free tier hits limit while pro is still allowed", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 2 }, pro: { limit: 100 } },
			window: "1m",
		});

		await limiter.check("user:1", "free");
		await limiter.check("user:1", "free");
		const result = await limiter.check("user:1", "free");
		expect(result.allowed).toBe(false);

		const proResult = await limiter.check("user:2", "pro");
		expect(proResult.allowed).toBe(true);
	});

	it("Infinity tier always allows without KV access", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { enterprise: { limit: Infinity } },
			window: "1h",
		});

		const result = await limiter.check("user:1", "enterprise");
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(Infinity);
		expect(kv.get).not.toHaveBeenCalled();
	});

	it("unknown tier uses defaultTier", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 5 } },
			window: "1m",
			defaultTier: "free",
		});

		const result = await limiter.check("user:1", "unknown-tier");
		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(5);
	});

	it("unknown tier without default throws", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 5 } },
			window: "1m",
		});

		await expect(limiter.check("user:1", "unknown")).rejects.toThrow();
	});

	it("forTier returns a RateLimiter with single-arg check", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 10 } },
			window: "1m",
		});

		const freeLimiter = limiter.forTier("free");
		const result = await freeLimiter.check("user:1");
		expect(result.allowed).toBe(true);
	});

	it("different keys tracked independently per tier", async () => {
		const kv = createMockKV();
		const limiter = tiered({
			namespace: kv,
			tiers: { free: { limit: 1 } },
			window: "1m",
		});

		const r1 = await limiter.check("user:1", "free");
		const r2 = await limiter.check("user:2", "free");
		expect(r1.allowed).toBe(true);
		expect(r2.allowed).toBe(true);
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/ratelimit && bun run test -- --run tests/tiered.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement tiered.ts**

Create `packages/ratelimit/src/tiered.ts`:

```ts
import { ValidationError } from "@workkit/errors";
import { fixedWindow } from "./fixed-window";
import { slidingWindow } from "./sliding-window";
import type { RateLimiter, RateLimitResult, TieredOptions, TieredRateLimiter } from "./types";

export function tiered(options: TieredOptions): TieredRateLimiter {
	const { tiers, defaultTier, algorithm = "fixed", prefix = "rl:tiered:" } = options;
	const cache = new Map<string, RateLimiter>();

	function getLimiter(tier: string): RateLimiter {
		const existing = cache.get(tier);
		if (existing) return existing;

		const config = tiers[tier];
		if (!config) {
			if (defaultTier && tiers[defaultTier]) {
				return getLimiter(defaultTier);
			}
			throw new ValidationError(`Unknown tier "${tier}" and no defaultTier configured`, [
				{ path: ["tier"], message: `Available tiers: ${Object.keys(tiers).join(", ")}` },
			]);
		}

		// Infinity means unlimited — return a pass-through limiter
		if (config.limit === Infinity) {
			const passthrough: RateLimiter = {
				async check(): Promise<RateLimitResult> {
					return {
						allowed: true,
						remaining: Infinity,
						resetAt: new Date(0),
						limit: Infinity,
					};
				},
			};
			cache.set(tier, passthrough);
			return passthrough;
		}

		const factory = algorithm === "sliding" ? slidingWindow : fixedWindow;
		const limiter = factory({
			namespace: options.namespace,
			limit: config.limit,
			window: options.window,
			prefix: `${prefix}${tier}:`,
		});

		cache.set(tier, limiter);
		return limiter;
	}

	return {
		async check(key: string, tier: string): Promise<RateLimitResult> {
			return getLimiter(tier).check(key);
		},
		forTier(tier: string): RateLimiter {
			return {
				check: (key: string) => getLimiter(tier).check(key),
			};
		},
	};
}
```

- [ ] **Step 5: Update index.ts and types export**

Add to `packages/ratelimit/src/index.ts`:

```ts
export { tiered } from "./tiered";
```

Add type exports:
```ts
export type { TieredOptions, TierConfig, TieredRateLimiter } from "./types";
```

- [ ] **Step 6: Run tests**

Run: `cd packages/ratelimit && bun run test -- --run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/ratelimit/src/tiered.ts packages/ratelimit/tests/tiered.test.ts packages/ratelimit/src/types.ts packages/ratelimit/src/index.ts
git commit -m "feat(ratelimit): add tiered rate limiting with per-plan limits"
```

---

### Task 8: @workkit/ratelimit — Quota Buckets

**Files:**
- Create: `packages/ratelimit/src/quota.ts`
- Create: `packages/ratelimit/tests/quota.test.ts`
- Modify: `packages/ratelimit/src/types.ts`
- Modify: `packages/ratelimit/src/index.ts`

- [ ] **Step 1: Add types**

Add to `packages/ratelimit/src/types.ts`:

```ts
/** Options for quota limiter */
export interface QuotaOptions {
	namespace: KVNamespace;
	limits: QuotaLimit[];
	prefix?: string;
}

/** A single quota window */
export interface QuotaLimit {
	window: Duration;
	limit: number;
}

/** Result from quota check, extends RateLimitResult with per-window details */
export interface QuotaResult extends RateLimitResult {
	quotas: QuotaWindowResult[];
}

/** Per-window quota details */
export interface QuotaWindowResult {
	window: Duration;
	used: number;
	limit: number;
	remaining: number;
}

/** Usage info for a specific key */
export interface QuotaUsage {
	window: Duration;
	used: number;
	limit: number;
	remaining: number;
	resetsAt: Date;
}

/** A quota limiter that tracks cumulative usage over calendar-aligned windows */
export interface QuotaLimiter extends RateLimiter {
	check(key: string, cost?: number): Promise<QuotaResult>;
	usage(key: string): Promise<QuotaUsage[]>;
}
```

- [ ] **Step 2: Write failing tests**

Create `packages/ratelimit/tests/quota.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { quota } from "../src";

function createMockKV() {
	const store = new Map<string, string>();
	return {
		get: vi.fn(async (key: string, type?: string) => {
			const val = store.get(key);
			if (!val) return null;
			return type === "json" ? JSON.parse(val) : val;
		}),
		put: vi.fn(async (key: string, value: string, _opts?: any) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => { store.delete(key); }),
	} as unknown as KVNamespace;
}

describe("quota", () => {
	it("daily quota increments and blocks at limit", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [{ window: "1d", limit: 3 }],
		});

		expect((await q.check("user:1")).allowed).toBe(true);
		expect((await q.check("user:1")).allowed).toBe(true);
		expect((await q.check("user:1")).allowed).toBe(true);
		expect((await q.check("user:1")).allowed).toBe(false);
	});

	it("returns per-window breakdown in quotas array", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [
				{ window: "1d", limit: 100 },
				{ window: "1h", limit: 10 },
			],
		});

		const result = await q.check("user:1");
		expect(result.quotas).toHaveLength(2);
		expect(result.quotas[0]!.window).toBe("1d");
		expect(result.quotas[1]!.window).toBe("1h");
	});

	it("blocks when any window is exceeded", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [
				{ window: "1d", limit: 100 },
				{ window: "1h", limit: 2 },
			],
		});

		await q.check("user:1");
		await q.check("user:1");
		const result = await q.check("user:1");
		expect(result.allowed).toBe(false); // hourly exceeded
	});

	it("usage reports without incrementing", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [{ window: "1d", limit: 10 }],
		});

		await q.check("user:1");
		await q.check("user:1");

		const usageResult = await q.usage("user:1");
		expect(usageResult).toHaveLength(1);
		expect(usageResult[0]!.used).toBe(2);
		expect(usageResult[0]!.remaining).toBe(8);
	});

	it("cost parameter deducts N from quota", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [{ window: "1d", limit: 10 }],
		});

		const result = await q.check("user:1", 5);
		expect(result.allowed).toBe(true);
		expect(result.quotas[0]!.used).toBe(5);
		expect(result.quotas[0]!.remaining).toBe(5);
	});

	it("composable via RateLimiter interface (no cost arg)", async () => {
		const kv = createMockKV();
		const q = quota({
			namespace: kv,
			limits: [{ window: "1d", limit: 10 }],
		});

		// RateLimiter interface: check(key) with no cost
		const result = await q.check("user:1");
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBeDefined();
		expect(result.resetAt).toBeInstanceOf(Date);
		expect(result.limit).toBeDefined();
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/ratelimit && bun run test -- --run tests/quota.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement quota.ts**

Create `packages/ratelimit/src/quota.ts`:

```ts
import { parseDuration } from "./duration";
import type {
	Duration,
	QuotaLimiter,
	QuotaOptions,
	QuotaResult,
	QuotaUsage,
	QuotaWindowResult,
	RateLimitResult,
} from "./types";

interface QuotaState {
	used: number;
}

function getWindowBoundary(now: number, windowMs: number): number {
	// Calendar-aligned: daily = midnight UTC, hourly = top of hour
	return now - (now % windowMs);
}

function getWindowResetAt(boundary: number, windowMs: number): Date {
	return new Date(boundary + windowMs);
}

export function quota(options: QuotaOptions): QuotaLimiter {
	const { namespace, limits, prefix = "rl:quota:" } = options;

	async function readWindow(key: string, window: Duration): Promise<{ used: number; boundary: number; windowMs: number }> {
		const windowMs = parseDuration(window);
		const now = Date.now();
		const boundary = getWindowBoundary(now, windowMs);
		const kvKey = `${prefix}${window}:${boundary}:${key}`;

		const existing = (await namespace.get(kvKey, "json")) as QuotaState | null;
		return { used: existing?.used ?? 0, boundary, windowMs };
	}

	async function incrementWindow(key: string, window: Duration, cost: number): Promise<{ used: number; boundary: number; windowMs: number }> {
		const windowMs = parseDuration(window);
		const now = Date.now();
		const boundary = getWindowBoundary(now, windowMs);
		const kvKey = `${prefix}${window}:${boundary}:${key}`;

		const existing = (await namespace.get(kvKey, "json")) as QuotaState | null;
		const newUsed = (existing?.used ?? 0) + cost;

		const ttlSeconds = Math.ceil((boundary + windowMs - now) / 1000);
		await namespace.put(kvKey, JSON.stringify({ used: newUsed }), {
			expirationTtl: Math.max(ttlSeconds, 1),
		});

		return { used: newUsed, boundary, windowMs };
	}

	return {
		async check(key: string, cost = 1): Promise<QuotaResult> {
			const quotas: QuotaWindowResult[] = [];
			let allowed = true;
			let mostRestrictiveRemaining = Infinity;
			let earliestReset = new Date(0);
			let mostRestrictiveLimit = 0;

			// Check all windows first (read-only)
			const reads = await Promise.all(
				limits.map(async (l) => {
					const { used, boundary, windowMs } = await readWindow(key, l.window);
					return { ...l, used, boundary, windowMs };
				}),
			);

			// Determine if allowed
			for (const r of reads) {
				if (r.used + cost > r.limit) {
					allowed = false;
				}
			}

			// Increment all windows (even if not allowed — to track overages)
			if (allowed) {
				const writes = await Promise.all(
					limits.map(async (l) => {
						const { used, boundary, windowMs } = await incrementWindow(key, l.window, cost);
						return { ...l, used, boundary, windowMs };
					}),
				);

				for (const w of writes) {
					const remaining = Math.max(0, w.limit - w.used);
					const resetAt = getWindowResetAt(w.boundary, w.windowMs);
					quotas.push({ window: w.window, used: w.used, limit: w.limit, remaining });
					if (remaining < mostRestrictiveRemaining) {
						mostRestrictiveRemaining = remaining;
						mostRestrictiveLimit = w.limit;
						earliestReset = resetAt;
					}
				}
			} else {
				for (const r of reads) {
					const remaining = Math.max(0, r.limit - r.used);
					const resetAt = getWindowResetAt(r.boundary, r.windowMs);
					quotas.push({ window: r.window, used: r.used, limit: r.limit, remaining });
					if (remaining < mostRestrictiveRemaining) {
						mostRestrictiveRemaining = remaining;
						mostRestrictiveLimit = r.limit;
						earliestReset = resetAt;
					}
				}
			}

			return {
				allowed,
				remaining: mostRestrictiveRemaining === Infinity ? 0 : mostRestrictiveRemaining,
				resetAt: earliestReset,
				limit: mostRestrictiveLimit,
				quotas,
			};
		},

		async usage(key: string): Promise<QuotaUsage[]> {
			const results = await Promise.all(
				limits.map(async (l) => {
					const { used, boundary, windowMs } = await readWindow(key, l.window);
					return {
						window: l.window,
						used,
						limit: l.limit,
						remaining: Math.max(0, l.limit - used),
						resetsAt: getWindowResetAt(boundary, windowMs),
					};
				}),
			);
			return results;
		},
	};
}
```

- [ ] **Step 5: Update index.ts**

Add to `packages/ratelimit/src/index.ts`:

```ts
export { quota } from "./quota";
export type { QuotaOptions, QuotaLimit, QuotaResult, QuotaWindowResult, QuotaUsage, QuotaLimiter } from "./types";
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/ratelimit && bun run test -- --run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/ratelimit/src/quota.ts packages/ratelimit/tests/quota.test.ts packages/ratelimit/src/types.ts packages/ratelimit/src/index.ts
git commit -m "feat(ratelimit): add quota buckets with calendar-aligned windows"
```

---

## Wave 2: Pattern-Heavy Packages

---

### Task 9: @workkit/queue — Circuit Breaker

**Files:**
- Create: `packages/queue/src/circuit-breaker.ts`
- Create: `packages/queue/tests/circuit-breaker.test.ts`
- Modify: `packages/queue/src/types.ts`
- Modify: `packages/queue/src/index.ts`

**Note:** Read `packages/queue/src/consumer.ts` and `packages/queue/src/types.ts` for the exact `ConsumerHandler`, `TypedMessageBatch`, and `ConsumerMessage` types before implementing. The circuit breaker wraps a `ConsumerHandler<Body>`.

- [ ] **Step 1: Add types to types.ts**

```ts
/** Options for circuit breaker wrapper */
export interface CircuitBreakerOptions {
	namespace: KVNamespace;
	key: string;
	failureThreshold: number;
	resetTimeout: Duration;
	halfOpenMax?: number;
}

/** Internal circuit breaker state stored in KV */
export interface CircuitBreakerState {
	state: "closed" | "open" | "half-open";
	failures: number;
	lastFailure: number;
	openedAt: number;
	halfOpenAttempts: number;
}
```

Define `Duration` locally in queue's types.ts as `type Duration = \`${number}${"s" | "m" | "h" | "d"}\`` and implement a local `parseDuration` helper (same logic as ratelimit's). Do NOT add a cross-package dependency on @workkit/ratelimit — keep queue independent.

- [ ] **Step 2: Write failing tests**

Create `packages/queue/tests/circuit-breaker.test.ts`. Test the three states (closed, open, half-open), transitions, and KV persistence. Mock KV with a Map-based implementation similar to the ratelimit tests.

- [ ] **Step 3: Implement circuit-breaker.ts**

The implementation reads/writes circuit state to KV, wraps the consumer handler, and manages state transitions based on success/failure outcomes.

- [ ] **Step 4: Run tests**

Run: `cd packages/queue && bun run test -- --run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/queue/src/circuit-breaker.ts packages/queue/tests/circuit-breaker.test.ts packages/queue/src/types.ts packages/queue/src/index.ts
git commit -m "feat(queue): add circuit breaker for consumer fault tolerance"
```

---

### Task 10: @workkit/queue — Workflow Primitives

**Files:**
- Create: `packages/queue/src/workflow.ts`
- Create: `packages/queue/tests/workflow.test.ts`
- Modify: `packages/queue/src/index.ts`

- [ ] **Step 1: Write failing tests** for linear workflow, context merging, rollback, and error handling.

- [ ] **Step 2: Implement workflow.ts** — Linear step chain with envelope wrapping, context accumulation, and reverse rollback on failure.

- [ ] **Step 3: Run tests and commit**

```bash
git commit -m "feat(queue): add workflow primitives with step chains and rollback"
```

---

### Task 11: @workkit/queue — DLQ Analyzer

**Files:**
- Create: `packages/queue/src/dlq-analyzer.ts`
- Create: `packages/queue/tests/dlq-analyzer.test.ts`
- Modify: `packages/queue/src/index.ts`

- [ ] **Step 1: Write failing tests** for record, summary, topErrors, error grouping, and TTL.

- [ ] **Step 2: Implement dlq-analyzer.ts** — KV-backed aggregation with counters for total, byQueue, byHour, and error patterns.

- [ ] **Step 3: Run tests and commit**

```bash
git commit -m "feat(queue): add DLQ analyzer for failure pattern insights"
```

---

### Task 12: @workkit/do — Storage Versioning

**Files:**
- Create: `packages/do/src/versioned-storage.ts`
- Create: `packages/do/tests/versioned-storage.test.ts`
- Modify: `packages/do/src/index.ts`

- [ ] **Step 1: Write failing tests** for fresh storage, migration chains, transaction rollback, and non-contiguous migration validation.

- [ ] **Step 2: Implement versioned-storage.ts** — Reads `__schema_version`, runs migrations in transaction, returns standard TypedStorageWrapper.

- [ ] **Step 3: Run tests and commit**

```bash
git commit -m "feat(do): add versioned storage with forward-only migrations"
```

---

### Task 13: @workkit/do — Event Sourcing

**Files:**
- Create: `packages/do/src/event-store.ts`
- Create: `packages/do/tests/event-store.test.ts`
- Modify: `packages/do/src/index.ts`

- [ ] **Step 1: Write failing tests** for append, getState, getEvents pagination, rebuild, and snapshot intervals.

- [ ] **Step 2: Implement event-store.ts** — Zero-padded event keys, reducer-based state materialization, periodic snapshots.

- [ ] **Step 3: Run tests and commit**

```bash
git commit -m "feat(do): add event sourcing with snapshots and replay"
```

---

### Task 14: @workkit/do — Time-Bucketed Aggregations

**Files:**
- Create: `packages/do/src/time-series.ts`
- Create: `packages/do/tests/time-series.test.ts`
- Modify: `packages/do/src/index.ts`

- [ ] **Step 1: Write failing tests** for record, query range, rollup, prune, custom reducers, and backdated records.

- [ ] **Step 2: Implement time-series.ts** — Bucket key generation, configurable reducers, range queries, retention-based pruning.

- [ ] **Step 3: Run tests and commit**

```bash
git commit -m "feat(do): add time-bucketed aggregations for metrics"
```

---

## Final Verification

### Task 15: Full Build and Test

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/Bikash/.instar/agents/jarvis/workkit && bun run test
```
Expected: ALL PASS across all 22+ packages

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Run build**

```bash
bun run build
```

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git commit -m "chore: fix lint/type issues from Layer 2 enhancements"
```
