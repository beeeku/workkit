import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJWT, parseDuration, signJWT, verifyJWT } from "../src/jwt";

const TEST_SECRET = "test-secret-key-for-jwt-testing-purposes";

describe("parseDuration", () => {
	it("parses seconds", () => {
		expect(parseDuration("30s")).toBe(30);
	});

	it("parses minutes", () => {
		expect(parseDuration("15m")).toBe(900);
	});

	it("parses hours", () => {
		expect(parseDuration("1h")).toBe(3600);
	});

	it("parses days", () => {
		expect(parseDuration("7d")).toBe(604800);
	});

	it("parses weeks", () => {
		expect(parseDuration("2w")).toBe(1209600);
	});

	it("throws on invalid format", () => {
		expect(() => parseDuration("abc")).toThrow("Invalid duration format");
	});

	it("throws on empty string", () => {
		expect(() => parseDuration("")).toThrow("Invalid duration format");
	});

	it("throws on missing unit", () => {
		expect(() => parseDuration("123")).toThrow("Invalid duration format");
	});
});

describe("signJWT", () => {
	it("signs a JWT with default HS256", async () => {
		const token = await signJWT({ sub: "user:1" }, { secret: TEST_SECRET });

		expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
	});

	it("includes iat claim automatically", async () => {
		const before = Math.floor(Date.now() / 1000);
		const token = await signJWT({ sub: "user:1" }, { secret: TEST_SECRET });
		const after = Math.floor(Date.now() / 1000);

		const { payload } = decodeJWT(token);
		expect(payload.iat).toBeGreaterThanOrEqual(before);
		expect(payload.iat).toBeLessThanOrEqual(after);
	});

	it("includes exp claim when expiresIn is set", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				expiresIn: "1h",
			},
		);

		const { payload } = decodeJWT(token);
		expect(payload.exp).toBeDefined();
		expect(payload.exp! - payload.iat!).toBe(3600);
	});

	it("includes issuer claim", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				issuer: "https://auth.example.com",
			},
		);

		const { payload } = decodeJWT(token);
		expect(payload.iss).toBe("https://auth.example.com");
	});

	it("includes audience claim", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				audience: "my-api",
			},
		);

		const { payload } = decodeJWT(token);
		expect(payload.aud).toBe("my-api");
	});

	it("includes audience as array", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				audience: ["api-1", "api-2"],
			},
		);

		const { payload } = decodeJWT(token);
		expect(payload.aud).toEqual(["api-1", "api-2"]);
	});

	it("includes notBefore claim", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				notBefore: "5m",
			},
		);

		const { payload } = decodeJWT(token);
		expect(payload.nbf).toBeDefined();
		expect(payload.nbf! - payload.iat!).toBe(300);
	});

	it("includes jwtId claim", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				jwtId: "unique-id-123",
			},
		);

		const { payload } = decodeJWT(token);
		expect(payload.jti).toBe("unique-id-123");
	});

	it("signs with HS384", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				algorithm: "HS384",
			},
		);

		const { header } = decodeJWT(token);
		expect(header.alg).toBe("HS384");
	});

	it("signs with HS512", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				algorithm: "HS512",
			},
		);

		const { header } = decodeJWT(token);
		expect(header.alg).toBe("HS512");
	});

	it("throws on unsupported algorithm", async () => {
		await expect(
			signJWT(
				{ sub: "user:1" },
				{
					secret: TEST_SECRET,
					algorithm: "RS256" as any,
				},
			),
		).rejects.toThrow("Unsupported algorithm");
	});

	it("preserves custom payload fields", async () => {
		const token = await signJWT(
			{ sub: "user:1", role: "admin", orgId: "org:42" },
			{ secret: TEST_SECRET },
		);

		const { payload } = decodeJWT(token);
		expect(payload.sub).toBe("user:1");
		expect((payload as any).role).toBe("admin");
		expect((payload as any).orgId).toBe("org:42");
	});
});

describe("decodeJWT", () => {
	it("decodes header, payload, and signature", async () => {
		const token = await signJWT({ sub: "user:1", role: "admin" }, { secret: TEST_SECRET });

		const decoded = decodeJWT<{ sub: string; role: string }>(token);
		expect(decoded.header.alg).toBe("HS256");
		expect(decoded.header.typ).toBe("JWT");
		expect(decoded.payload.sub).toBe("user:1");
		expect(decoded.payload.role).toBe("admin");
		expect(decoded.signature).toBeTruthy();
	});

	it("throws on malformed token (less than 3 parts)", () => {
		expect(() => decodeJWT("only.two")).toThrow("expected 3 dot-separated parts");
	});

	it("throws on malformed token (more than 3 parts)", () => {
		expect(() => decodeJWT("a.b.c.d")).toThrow("expected 3 dot-separated parts");
	});

	it("throws on invalid base64url in header", () => {
		expect(() => decodeJWT("!!!.eyJ0ZXN0IjoxfQ.sig")).toThrow("failed to decode");
	});

	it("does not verify signature", async () => {
		const token = await signJWT({ sub: "user:1" }, { secret: TEST_SECRET });
		// Tamper with the signature
		const parts = token.split(".");
		const tampered = `${parts[0]}.${parts[1]}.tampered-signature`;

		// decodeJWT should NOT throw — it doesn't verify
		const decoded = decodeJWT(tampered);
		expect(decoded.payload.sub).toBe("user:1");
		expect(decoded.signature).toBe("tampered-signature");
	});
});

describe("verifyJWT", () => {
	it("verifies a valid token", async () => {
		const token = await signJWT(
			{ sub: "user:1", role: "admin" },
			{ secret: TEST_SECRET, expiresIn: "1h" },
		);

		const payload = await verifyJWT<{ sub: string; role: string }>(token, {
			secret: TEST_SECRET,
		});

		expect(payload.sub).toBe("user:1");
		expect(payload.role).toBe("admin");
	});

	it("rejects token with wrong secret", async () => {
		const token = await signJWT({ sub: "user:1" }, { secret: TEST_SECRET });

		await expect(verifyJWT(token, { secret: "wrong-secret" })).rejects.toThrow(
			"signature verification failed",
		);
	});

	it("rejects expired token", async () => {
		vi.useFakeTimers();

		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				expiresIn: "1h",
			},
		);

		// Advance time past expiration
		vi.advanceTimersByTime(2 * 3600 * 1000);

		await expect(verifyJWT(token, { secret: TEST_SECRET })).rejects.toThrow("expired");

		vi.useRealTimers();
	});

	it("accepts expired token within clock tolerance", async () => {
		vi.useFakeTimers();

		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				expiresIn: "1h",
			},
		);

		// Advance just past expiration
		vi.advanceTimersByTime(3600 * 1000 + 5000);

		const payload = await verifyJWT(token, {
			secret: TEST_SECRET,
			clockTolerance: 10,
		});

		expect(payload.sub).toBe("user:1");

		vi.useRealTimers();
	});

	it("rejects token not yet valid (nbf)", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				notBefore: "1h",
			},
		);

		await expect(verifyJWT(token, { secret: TEST_SECRET })).rejects.toThrow("not yet valid");
	});

	it("validates issuer", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				issuer: "https://auth.example.com",
			},
		);

		await expect(
			verifyJWT(token, {
				secret: TEST_SECRET,
				issuer: "https://other.example.com",
			}),
		).rejects.toThrow("issuer mismatch");
	});

	it("accepts matching issuer", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				issuer: "https://auth.example.com",
			},
		);

		const payload = await verifyJWT(token, {
			secret: TEST_SECRET,
			issuer: "https://auth.example.com",
		});

		expect(payload.iss).toBe("https://auth.example.com");
	});

	it("validates audience (string)", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				audience: "my-api",
			},
		);

		await expect(
			verifyJWT(token, {
				secret: TEST_SECRET,
				audience: "other-api",
			}),
		).rejects.toThrow("audience mismatch");
	});

	it("accepts matching audience", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				audience: "my-api",
			},
		);

		const payload = await verifyJWT(token, {
			secret: TEST_SECRET,
			audience: "my-api",
		});

		expect(payload.aud).toBe("my-api");
	});

	it("validates audience (array — must have intersection)", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				audience: ["api-1", "api-2"],
			},
		);

		await expect(
			verifyJWT(token, {
				secret: TEST_SECRET,
				audience: "api-3",
			}),
		).rejects.toThrow("audience mismatch");
	});

	it("accepts matching audience from array", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				audience: ["api-1", "api-2"],
			},
		);

		const payload = await verifyJWT(token, {
			secret: TEST_SECRET,
			audience: "api-2",
		});

		expect(payload.aud).toEqual(["api-1", "api-2"]);
	});

	it("rejects disallowed algorithm", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				algorithm: "HS384",
			},
		);

		await expect(
			verifyJWT(token, {
				secret: TEST_SECRET,
				algorithms: ["HS256"],
			}),
		).rejects.toThrow("not allowed");
	});

	it("accepts allowed algorithm", async () => {
		const token = await signJWT(
			{ sub: "user:1" },
			{
				secret: TEST_SECRET,
				algorithm: "HS384",
			},
		);

		const payload = await verifyJWT(token, {
			secret: TEST_SECRET,
			algorithms: ["HS256", "HS384"],
		});

		expect(payload.sub).toBe("user:1");
	});

	it("rejects tampered payload", async () => {
		const token = await signJWT({ sub: "user:1" }, { secret: TEST_SECRET });
		const parts = token.split(".");
		// Replace payload with different data
		const tamperedPayload = btoa(JSON.stringify({ sub: "user:999" }))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

		await expect(verifyJWT(tampered, { secret: TEST_SECRET })).rejects.toThrow(
			"signature verification failed",
		);
	});

	it("round-trips with all algorithms", async () => {
		for (const alg of ["HS256", "HS384", "HS512"] as const) {
			const token = await signJWT(
				{ sub: "user:1", alg: alg },
				{ secret: TEST_SECRET, algorithm: alg },
			);

			const payload = await verifyJWT(token, {
				secret: TEST_SECRET,
				algorithms: [alg],
			});

			expect(payload.sub).toBe("user:1");
		}
	});

	it("rejects token without audience when audience is required", async () => {
		const token = await signJWT({ sub: "user:1" }, { secret: TEST_SECRET });

		await expect(
			verifyJWT(token, {
				secret: TEST_SECRET,
				audience: "required-api",
			}),
		).rejects.toThrow("audience mismatch");
	});
});
