import { describe, expect, it } from "vitest";
import { generateApprovalKeys, generateApprovalToken, verifyApprovalToken } from "../src/token";

describe("generateApprovalKeys", () => {
	it("generates a key pair", async () => {
		const keys = await generateApprovalKeys();
		expect(keys.privateKey).toBeDefined();
		expect(keys.publicKey).toBeDefined();
	});
});

describe("generateApprovalToken", () => {
	it("generates a token with correct structure", async () => {
		const keys = await generateApprovalKeys();
		const { token, tokenId } = await generateApprovalToken(
			"req_123",
			"user_bob",
			"both",
			3600000,
			keys.privateKey,
		);

		expect(token).toContain(".");
		expect(tokenId).toBeDefined();
		expect(tokenId.length).toBeGreaterThan(0);

		// Decode payload
		const [encodedPayload] = token.split(".");
		const payload = JSON.parse(atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/")));
		expect(payload.v).toBe(1);
		expect(payload.rid).toBe("req_123");
		expect(payload.sub).toBe("user_bob");
		expect(payload.act).toBe("both");
		expect(payload.tid).toBe(tokenId);
	});

	it("generates unique tokenIds", async () => {
		const keys = await generateApprovalKeys();
		const t1 = await generateApprovalToken("req_1", "bob", "both", 3600000, keys.privateKey);
		const t2 = await generateApprovalToken("req_1", "bob", "both", 3600000, keys.privateKey);
		expect(t1.tokenId).not.toBe(t2.tokenId);
	});
});

describe("verifyApprovalToken", () => {
	it("verifies a valid token", async () => {
		const keys = await generateApprovalKeys();
		const { token } = await generateApprovalToken(
			"req_123",
			"bob",
			"approve",
			3600000,
			keys.privateKey,
		);

		const result = await verifyApprovalToken(token, "req_123", "bob", keys.publicKey, new Set());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.rid).toBe("req_123");
			expect(result.value.sub).toBe("bob");
		}
	});

	it("rejects expired token", async () => {
		const keys = await generateApprovalKeys();
		// Token that expired 1 second ago
		const { token } = await generateApprovalToken(
			"req_123",
			"bob",
			"approve",
			-1000,
			keys.privateKey,
		);

		const result = await verifyApprovalToken(token, "req_123", "bob", keys.publicKey, new Set());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("TOKEN_EXPIRED");
	});

	it("rejects wrong request ID", async () => {
		const keys = await generateApprovalKeys();
		const { token } = await generateApprovalToken(
			"req_123",
			"bob",
			"approve",
			3600000,
			keys.privateKey,
		);

		const result = await verifyApprovalToken(token, "req_999", "bob", keys.publicKey, new Set());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("REQUEST_MISMATCH");
	});

	it("rejects wrong approver", async () => {
		const keys = await generateApprovalKeys();
		const { token } = await generateApprovalToken(
			"req_123",
			"bob",
			"approve",
			3600000,
			keys.privateKey,
		);

		const result = await verifyApprovalToken(token, "req_123", "alice", keys.publicKey, new Set());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("APPROVER_MISMATCH");
	});

	it("rejects consumed token", async () => {
		const keys = await generateApprovalKeys();
		const { token, tokenId } = await generateApprovalToken(
			"req_123",
			"bob",
			"approve",
			3600000,
			keys.privateKey,
		);

		const consumed = new Set([tokenId]);
		const result = await verifyApprovalToken(token, "req_123", "bob", keys.publicKey, consumed);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("TOKEN_ALREADY_USED");
	});

	it("rejects malformed token", async () => {
		const keys = await generateApprovalKeys();
		const result = await verifyApprovalToken(
			"not-a-token",
			"req_123",
			"bob",
			keys.publicKey,
			new Set(),
		);
		expect(result.ok).toBe(false);
	});

	it("rejects token with wrong signature", async () => {
		const keys1 = await generateApprovalKeys();
		const keys2 = await generateApprovalKeys();
		const { token } = await generateApprovalToken(
			"req_123",
			"bob",
			"approve",
			3600000,
			keys1.privateKey,
		);

		// Verify with wrong public key
		const result = await verifyApprovalToken(token, "req_123", "bob", keys2.publicKey, new Set());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("INVALID_SIGNATURE");
	});
});
