import { describe, expect, it } from "vitest";
import { UnsafeLinkError } from "../../../src/adapters/inapp/errors";
import { safeLink } from "../../../src/adapters/inapp/safe-link";

describe("safeLink()", () => {
	it("accepts https:// by default", () => {
		expect(safeLink("https://example.com/x")).toBe("https://example.com/x");
	});
	it("accepts relative paths by default", () => {
		expect(safeLink("/briefs/r1")).toBe("/briefs/r1");
	});
	it("rejects http:// when not in allowlist", () => {
		expect(() => safeLink("http://example.com")).toThrow(UnsafeLinkError);
	});
	it("rejects javascript:", () => {
		expect(() => safeLink("javascript:alert(1)")).toThrow(UnsafeLinkError);
	});
	it("rejects data:", () => {
		expect(() => safeLink("data:text/html,<script>alert(1)</script>")).toThrow(UnsafeLinkError);
	});
	it("rejects file:", () => {
		expect(() => safeLink("file:///etc/passwd")).toThrow(UnsafeLinkError);
	});
	it("rejects malformed URLs", () => {
		expect(() => safeLink(":::nope")).toThrow(UnsafeLinkError);
	});
	it("rejects empty strings", () => {
		expect(() => safeLink("   ")).toThrow(UnsafeLinkError);
	});
	it("respects allowedSchemes", () => {
		expect(safeLink("mailto:x@y.com", { allowedSchemes: ["mailto:"] })).toBe("mailto:x@y.com");
	});
	it("respects allowRelative=false (rejects /paths)", () => {
		expect(() => safeLink("/x", { allowRelative: false })).toThrow(UnsafeLinkError);
	});
});
