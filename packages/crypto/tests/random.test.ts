import { describe, expect, it } from "vitest";
import { randomBytes, randomHex, randomUUID } from "../src/index";

describe("randomBytes", () => {
	it("returns a Uint8Array of the specified length", () => {
		const bytes = randomBytes(32);
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(bytes.length).toBe(32);
	});

	it("returns different values on each call", () => {
		const a = randomBytes(16);
		const b = randomBytes(16);
		// Extremely unlikely to be equal
		expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
	});

	it("supports various lengths", () => {
		expect(randomBytes(1).length).toBe(1);
		expect(randomBytes(64).length).toBe(64);
		expect(randomBytes(256).length).toBe(256);
	});
});

describe("randomHex", () => {
	it("returns a hex string of double the byte length", () => {
		const hex = randomHex(16);
		expect(typeof hex).toBe("string");
		expect(hex.length).toBe(32);
		expect(hex).toMatch(/^[0-9a-f]+$/);
	});

	it("returns different values on each call", () => {
		const a = randomHex(16);
		const b = randomHex(16);
		expect(a).not.toBe(b);
	});

	it("supports various lengths", () => {
		expect(randomHex(1).length).toBe(2);
		expect(randomHex(32).length).toBe(64);
	});
});

describe("randomUUID", () => {
	it("returns a valid UUID v4 format", () => {
		const uuid = randomUUID();
		expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});

	it("returns different values on each call", () => {
		const a = randomUUID();
		const b = randomUUID();
		expect(a).not.toBe(b);
	});
});
