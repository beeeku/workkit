import { ValidationError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { buildIdempotencyKey, canonicalJson, sha256Hex } from "../src/idempotency";

describe("canonicalJson()", () => {
	it("sorts keys recursively so equivalent payloads stringify identically", () => {
		const a = canonicalJson({ b: 1, a: { y: 2, x: 1 } });
		const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1 });
		expect(a).toBe(b);
	});

	it("preserves array order (arrays are ordered)", () => {
		expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
	});

	it("rejects non-finite numbers", () => {
		expect(() => canonicalJson({ x: Number.NaN })).toThrow(ValidationError);
		expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(ValidationError);
	});

	it("rejects circular references", () => {
		const a: Record<string, unknown> = { x: 1 };
		a.self = a;
		expect(() => canonicalJson(a)).toThrow(ValidationError);
	});

	it("allows non-cyclic shared references (DAG-style payloads)", () => {
		const shared = { v: 1 };
		// `a` and `b` point at the same object but there is no cycle.
		const payload = { a: shared, b: shared };
		expect(() => canonicalJson(payload)).not.toThrow();
	});
});

describe("sha256Hex()", () => {
	it("produces stable lowercase hex", async () => {
		const h = await sha256Hex("hello");
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(await sha256Hex("hello")).toBe(h);
	});
});

describe("buildIdempotencyKey()", () => {
	it("hashes (userId, notificationId, payload) by default", async () => {
		const k1 = await buildIdempotencyKey({
			userId: "u1",
			notificationId: "n1",
			payload: { a: 1, b: 2 },
		});
		const k2 = await buildIdempotencyKey({
			userId: "u1",
			notificationId: "n1",
			payload: { b: 2, a: 1 },
		});
		expect(k1).toBe(k2);
		const k3 = await buildIdempotencyKey({
			userId: "u2",
			notificationId: "n1",
			payload: { a: 1, b: 2 },
		});
		expect(k1).not.toBe(k3);
	});

	it("returns the override unchanged when supplied", async () => {
		const k = await buildIdempotencyKey({
			userId: "u",
			notificationId: "n",
			payload: {},
			override: "custom",
		});
		expect(k).toBe("custom");
	});
});
