import { describe, expect, it } from "vitest";
import { extractBasicAuth, extractBearerToken } from "../src/extract";

describe("extractBearerToken", () => {
	it("extracts token from valid Bearer header", () => {
		const request = new Request("https://example.com", {
			headers: { Authorization: "Bearer my-token-123" },
		});

		expect(extractBearerToken(request)).toBe("my-token-123");
	});

	it("returns null when no Authorization header", () => {
		const request = new Request("https://example.com");

		expect(extractBearerToken(request)).toBeNull();
	});

	it("returns null for Basic auth header", () => {
		const request = new Request("https://example.com", {
			headers: { Authorization: "Basic dXNlcjpwYXNz" },
		});

		expect(extractBearerToken(request)).toBeNull();
	});

	it("is case-insensitive for Bearer prefix", () => {
		const request = new Request("https://example.com", {
			headers: { Authorization: "bearer my-token" },
		});

		expect(extractBearerToken(request)).toBe("my-token");
	});

	it("handles JWT-style tokens", () => {
		const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123";
		const request = new Request("https://example.com", {
			headers: { Authorization: `Bearer ${jwt}` },
		});

		expect(extractBearerToken(request)).toBe(jwt);
	});

	it("returns null for empty Authorization header", () => {
		const request = new Request("https://example.com", {
			headers: { Authorization: "" },
		});

		expect(extractBearerToken(request)).toBeNull();
	});

	it("returns null for Bearer without token", () => {
		const request = new Request("https://example.com", {
			headers: { Authorization: "Bearer " },
		});

		expect(extractBearerToken(request)).toBeNull();
	});
});

describe("extractBasicAuth", () => {
	it("extracts username and password", () => {
		const encoded = btoa("admin:secret123");
		const request = new Request("https://example.com", {
			headers: { Authorization: `Basic ${encoded}` },
		});

		const result = extractBasicAuth(request);

		expect(result).not.toBeNull();
		expect(result!.username).toBe("admin");
		expect(result!.password).toBe("secret123");
	});

	it("returns null when no Authorization header", () => {
		const request = new Request("https://example.com");

		expect(extractBasicAuth(request)).toBeNull();
	});

	it("returns null for Bearer auth header", () => {
		const request = new Request("https://example.com", {
			headers: { Authorization: "Bearer token123" },
		});

		expect(extractBasicAuth(request)).toBeNull();
	});

	it("handles password with colons", () => {
		const encoded = btoa("user:pass:with:colons");
		const request = new Request("https://example.com", {
			headers: { Authorization: `Basic ${encoded}` },
		});

		const result = extractBasicAuth(request);

		expect(result!.username).toBe("user");
		expect(result!.password).toBe("pass:with:colons");
	});

	it("handles empty password", () => {
		const encoded = btoa("user:");
		const request = new Request("https://example.com", {
			headers: { Authorization: `Basic ${encoded}` },
		});

		const result = extractBasicAuth(request);

		expect(result!.username).toBe("user");
		expect(result!.password).toBe("");
	});

	it("returns null for invalid base64", () => {
		const request = new Request("https://example.com", {
			headers: { Authorization: "Basic !!!invalid!!!" },
		});

		expect(extractBasicAuth(request)).toBeNull();
	});

	it("returns null when no colon in decoded string", () => {
		const encoded = btoa("no-colon-here");
		const request = new Request("https://example.com", {
			headers: { Authorization: `Basic ${encoded}` },
		});

		expect(extractBasicAuth(request)).toBeNull();
	});

	it("is case-insensitive for Basic prefix", () => {
		const encoded = btoa("user:pass");
		const request = new Request("https://example.com", {
			headers: { Authorization: `basic ${encoded}` },
		});

		const result = extractBasicAuth(request);

		expect(result!.username).toBe("user");
		expect(result!.password).toBe("pass");
	});
});
