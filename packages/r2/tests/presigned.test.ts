import { BindingNotFoundError, ValidationError } from "@workkit/errors";
import { beforeEach, describe, expect, it } from "vitest";
import { createPresignedUrl } from "../src/presigned";
import { createMockR2 } from "./helpers/mock-r2";

const TEST_SIGNING_SECRET = "test-signing-secret"; // not a real secret — test fixture

describe("createPresignedUrl()", () => {
	let mock: ReturnType<typeof createMockR2>;

	beforeEach(() => {
		mock = createMockR2();
	});

	it("generates a presigned GET URL", async () => {
		const url = await createPresignedUrl(mock, {
			key: "files/report.pdf",
			method: "GET",
			signingSecret: TEST_SIGNING_SECRET,
		});
		expect(url).toContain("/_r2/presigned?");
		expect(url).toContain("key=files%2Freport.pdf");
		expect(url).toContain("method=GET");
		expect(url).toContain("expires=");
		expect(url).toContain("signature=");
	});

	it("generates a presigned PUT URL", async () => {
		const url = await createPresignedUrl(mock, {
			key: "uploads/file.pdf",
			method: "PUT",
			expiresIn: 3600,
			signingSecret: TEST_SIGNING_SECRET,
		});
		expect(url).toContain("method=PUT");
		expect(url).toContain("key=uploads%2Ffile.pdf");
	});

	it("includes maxSize param for PUT", async () => {
		const url = await createPresignedUrl(mock, {
			key: "uploads/file.pdf",
			method: "PUT",
			maxSize: 10 * 1024 * 1024,
			signingSecret: TEST_SIGNING_SECRET,
		});
		expect(url).toContain("maxSize=10485760");
	});

	it("uses default expiry of 1 hour", async () => {
		const before = Math.floor(Date.now() / 1000) + 3600;
		const url = await createPresignedUrl(mock, {
			key: "file.txt",
			method: "GET",
			signingSecret: TEST_SIGNING_SECRET,
		});
		const params = new URLSearchParams(url.split("?")[1]);
		const expires = Number.parseInt(params.get("expires")!, 10);
		// Allow 2 seconds of tolerance
		expect(expires).toBeGreaterThanOrEqual(before - 2);
		expect(expires).toBeLessThanOrEqual(before + 2);
	});

	it("respects custom expiresIn", async () => {
		const before = Math.floor(Date.now() / 1000) + 300;
		const url = await createPresignedUrl(mock, {
			key: "file.txt",
			method: "GET",
			expiresIn: 300,
			signingSecret: TEST_SIGNING_SECRET,
		});
		const params = new URLSearchParams(url.split("?")[1]);
		const expires = Number.parseInt(params.get("expires")!, 10);
		expect(expires).toBeGreaterThanOrEqual(before - 2);
		expect(expires).toBeLessThanOrEqual(before + 2);
	});

	it("generates a valid hex signature", async () => {
		const url = await createPresignedUrl(mock, {
			key: "file.txt",
			method: "GET",
			signingSecret: TEST_SIGNING_SECRET,
		});
		const params = new URLSearchParams(url.split("?")[1]);
		const sig = params.get("signature")!;
		expect(sig).toMatch(/^[0-9a-f]+$/);
		expect(sig.length).toBe(64); // SHA-256 produces 32 bytes = 64 hex chars
	});

	it("generates different signatures for different keys", async () => {
		const url1 = await createPresignedUrl(mock, {
			key: "file1.txt",
			method: "GET",
			expiresIn: 3600,
			signingSecret: TEST_SIGNING_SECRET,
		});
		const url2 = await createPresignedUrl(mock, {
			key: "file2.txt",
			method: "GET",
			expiresIn: 3600,
			signingSecret: TEST_SIGNING_SECRET,
		});
		const sig1 = new URLSearchParams(url1.split("?")[1]).get("signature");
		const sig2 = new URLSearchParams(url2.split("?")[1]).get("signature");
		expect(sig1).not.toBe(sig2);
	});

	it("generates different signatures for different methods", async () => {
		const url1 = await createPresignedUrl(mock, {
			key: "file.txt",
			method: "GET",
			expiresIn: 3600,
			signingSecret: TEST_SIGNING_SECRET,
		});
		const url2 = await createPresignedUrl(mock, {
			key: "file.txt",
			method: "PUT",
			expiresIn: 3600,
			signingSecret: TEST_SIGNING_SECRET,
		});
		const sig1 = new URLSearchParams(url1.split("?")[1]).get("signature");
		const sig2 = new URLSearchParams(url2.split("?")[1]).get("signature");
		expect(sig1).not.toBe(sig2);
	});

	it("generates different signatures for different secrets", async () => {
		const url1 = await createPresignedUrl(mock, {
			key: "file.txt",
			method: "GET",
			expiresIn: 3600,
			signingSecret: "secret-a",
		});
		const url2 = await createPresignedUrl(mock, {
			key: "file.txt",
			method: "GET",
			expiresIn: 3600,
			signingSecret: "secret-b",
		});
		const sig1 = new URLSearchParams(url1.split("?")[1]).get("signature");
		const sig2 = new URLSearchParams(url2.split("?")[1]).get("signature");
		expect(sig1).not.toBe(sig2);
	});

	// Validation errors

	it("throws ValidationError for empty key", async () => {
		await expect(
			createPresignedUrl(mock, { key: "", method: "GET", signingSecret: TEST_SIGNING_SECRET }),
		).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for negative expiresIn", async () => {
		await expect(
			createPresignedUrl(mock, {
				key: "f.txt",
				method: "GET",
				expiresIn: -1,
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for zero expiresIn", async () => {
		await expect(
			createPresignedUrl(mock, {
				key: "f.txt",
				method: "GET",
				expiresIn: 0,
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for expiresIn > 7 days", async () => {
		await expect(
			createPresignedUrl(mock, {
				key: "f.txt",
				method: "GET",
				expiresIn: 8 * 24 * 60 * 60,
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for invalid method", async () => {
		await expect(
			createPresignedUrl(mock, {
				key: "f.txt",
				method: "DELETE" as any,
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for maxSize on GET", async () => {
		await expect(
			createPresignedUrl(mock, {
				key: "f.txt",
				method: "GET",
				maxSize: 1000,
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for negative maxSize", async () => {
		await expect(
			createPresignedUrl(mock, {
				key: "f.txt",
				method: "PUT",
				maxSize: -1,
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError for zero maxSize", async () => {
		await expect(
			createPresignedUrl(mock, {
				key: "f.txt",
				method: "PUT",
				maxSize: 0,
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(ValidationError);
	});

	it("throws BindingNotFoundError for null bucket", async () => {
		await expect(
			createPresignedUrl(null as any, {
				key: "f.txt",
				method: "GET",
				signingSecret: TEST_SIGNING_SECRET,
			}),
		).rejects.toThrow(BindingNotFoundError);
	});
});
