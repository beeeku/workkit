import { ConfigError, ValidationError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { storedPDF } from "../src/store";
import { mockBucket, mockSession } from "./_mocks";

describe("storedPDF()", () => {
	it("renders, uploads, presigns, and returns the key + bytes + url", async () => {
		const { session } = mockSession(new Uint8Array([1, 2, 3, 4, 5]));
		const bucket = mockBucket();
		const result = await storedPDF(session, "<p>brief</p>", {
			bucket,
			key: ["reports", "user-1", "brief.pdf"],
		});
		expect(result.r2Key).toBe("reports/user-1/brief.pdf");
		expect(result.bytes).toBe(5);
		expect(result.url).toContain("https://signed.example.com/reports/user-1/brief.pdf");
		expect(bucket.puts[0]?.bytes).toBe(5);
		expect(bucket.puts[0]?.contentType).toBe("application/pdf");
		expect(bucket.presignCalls[0]?.expiresIn).toBe(3600);
	});

	it("accepts a single safe-key string for `key`", async () => {
		const { session } = mockSession();
		const bucket = mockBucket();
		const result = await storedPDF(session, "<p>x</p>", {
			bucket,
			key: "reports/2026/q1/brief.pdf",
		});
		expect(result.r2Key).toBe("reports/2026/q1/brief.pdf");
	});

	it("rejects unsafe key parts", async () => {
		const { session } = mockSession();
		const bucket = mockBucket();
		await expect(
			storedPDF(session, "<p>x</p>", { bucket, key: ["reports", "..", "brief.pdf"] }),
		).rejects.toBeInstanceOf(ValidationError);
		expect(bucket.puts).toHaveLength(0);
	});

	it("clamps via throw when presignTtl exceeds 24h", async () => {
		const { session } = mockSession();
		const bucket = mockBucket();
		await expect(
			storedPDF(session, "<p>x</p>", {
				bucket,
				key: ["x.pdf"],
				presignTtl: 86_401,
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("rejects non-positive presignTtl", async () => {
		const { session } = mockSession();
		const bucket = mockBucket();
		await expect(
			storedPDF(session, "<p>x</p>", {
				bucket,
				key: ["x.pdf"],
				presignTtl: 0,
			}),
		).rejects.toBeInstanceOf(ValidationError);
	});

	it("returns url:null when readPolicy: 'private'", async () => {
		const { session } = mockSession();
		const bucket = mockBucket();
		const result = await storedPDF(session, "<p>x</p>", {
			bucket,
			key: ["x.pdf"],
			readPolicy: "private",
		});
		expect(result.url).toBeNull();
		expect(bucket.presignCalls).toHaveLength(0);
	});

	it("throws ConfigError if presign requested but bucket lacks createPresignedUrl", async () => {
		const { session } = mockSession();
		const bucket = mockBucket({ supportsPresign: false });
		await expect(storedPDF(session, "<p>x</p>", { bucket, key: ["x.pdf"] })).rejects.toBeInstanceOf(
			ConfigError,
		);
	});

	it("forwards customMetadata to R2.put", async () => {
		const { session } = mockSession();
		const bucket = mockBucket();
		await storedPDF(session, "<p>x</p>", {
			bucket,
			key: ["x.pdf"],
			metadata: { userId: "u1", reportId: "r1" },
		});
		expect(bucket.puts[0]?.metadata).toEqual({ userId: "u1", reportId: "r1" });
	});
});
