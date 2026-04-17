import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/password";

// Use a low iteration count in tests to keep them fast.
// The default (600 000) is intentionally slow to resist brute-force attacks.
const TEST_ITERATIONS = 1_000;

describe("hashPassword", () => {
	it("returns hash, salt, iterations, and algorithm", async () => {
		const result = await hashPassword("my-password", { iterations: TEST_ITERATIONS });

		expect(result.hash).toBeTruthy();
		expect(result.salt).toBeTruthy();
		expect(result.iterations).toBe(TEST_ITERATIONS);
		expect(result.algorithm).toBe("pbkdf2-sha-256");
	});

	it("defaults to 600 000 iterations", async () => {
		const result = await hashPassword("my-password");
		expect(result.iterations).toBe(600_000);
	});

	it("generates different salts for same password", async () => {
		const a = await hashPassword("same-password", { iterations: TEST_ITERATIONS });
		const b = await hashPassword("same-password", { iterations: TEST_ITERATIONS });

		expect(a.salt).not.toBe(b.salt);
		expect(a.hash).not.toBe(b.hash);
	});

	it("generates hex-encoded hash", async () => {
		const result = await hashPassword("test", { iterations: TEST_ITERATIONS });

		expect(result.hash).toMatch(/^[0-9a-f]+$/);
		expect(result.hash).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
	});

	it("generates hex-encoded salt", async () => {
		const result = await hashPassword("test", { iterations: TEST_ITERATIONS });

		expect(result.salt).toMatch(/^[0-9a-f]+$/);
		expect(result.salt).toHaveLength(32); // 16 bytes = 32 hex chars
	});

	it("accepts custom iteration count", async () => {
		const result = await hashPassword("test", { iterations: 10_000 });

		expect(result.iterations).toBe(10_000);
	});

	it("throws on empty password", async () => {
		await expect(hashPassword("")).rejects.toThrow("Password cannot be empty");
	});
});

describe("verifyPassword", () => {
	it("verifies correct password", async () => {
		const hashed = await hashPassword("correct-horse-battery-staple", {
			iterations: TEST_ITERATIONS,
		});
		const valid = await verifyPassword("correct-horse-battery-staple", hashed);

		expect(valid).toBe(true);
	});

	it("rejects wrong password", async () => {
		const hashed = await hashPassword("correct-password", { iterations: TEST_ITERATIONS });
		const valid = await verifyPassword("wrong-password", hashed);

		expect(valid).toBe(false);
	});

	it("rejects similar but different passwords", async () => {
		const hashed = await hashPassword("password", { iterations: TEST_ITERATIONS });
		const valid = await verifyPassword("Password", hashed);

		expect(valid).toBe(false);
	});

	it("works with custom iterations", async () => {
		const hashed = await hashPassword("test", { iterations: 1000 });
		const valid = await verifyPassword("test", hashed);

		expect(valid).toBe(true);
	});

	it("round-trips with special characters", async () => {
		const password = "p@$$w0rd!#%^&*()";
		const hashed = await hashPassword(password, { iterations: TEST_ITERATIONS });
		const valid = await verifyPassword(password, hashed);

		expect(valid).toBe(true);
	});

	it("round-trips with unicode", async () => {
		const password = "mot de passe avec des accents: caf\u00e9";
		const hashed = await hashPassword(password, { iterations: TEST_ITERATIONS });
		const valid = await verifyPassword(password, hashed);

		expect(valid).toBe(true);
	});

	it("round-trips with very long password", async () => {
		const password = "a".repeat(1000);
		const hashed = await hashPassword(password, { iterations: TEST_ITERATIONS });
		const valid = await verifyPassword(password, hashed);

		expect(valid).toBe(true);
	});
});
