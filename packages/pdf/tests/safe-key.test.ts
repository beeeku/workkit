import { ValidationError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { safeKey } from "../src/safe-key";

describe("safeKey()", () => {
	it("joins parts with /", () => {
		expect(safeKey("reports", "user-1", "brief.pdf")).toBe("reports/user-1/brief.pdf");
	});

	it("trims leading/trailing slashes per part", () => {
		expect(safeKey("/reports/", "/user-1/", "/brief.pdf")).toBe("reports/user-1/brief.pdf");
	});

	it("rejects empty input list", () => {
		expect(() => safeKey()).toThrow(ValidationError);
	});

	it("rejects empty parts", () => {
		expect(() => safeKey("reports", "", "brief.pdf")).toThrow(ValidationError);
	});

	it("rejects '..' as a component", () => {
		expect(() => safeKey("reports", "..", "brief.pdf")).toThrow(ValidationError);
	});

	it("rejects embedded '..' segments", () => {
		expect(() => safeKey("reports/../etc", "brief.pdf")).toThrow(ValidationError);
	});

	it("rejects '.' as a component", () => {
		expect(() => safeKey("reports", ".", "brief.pdf")).toThrow(ValidationError);
	});

	it("rejects backslash", () => {
		expect(() => safeKey("reports", "a\\b", "brief.pdf")).toThrow(ValidationError);
	});

	it("rejects control characters", () => {
		expect(() => safeKey("reports", "a\u0007b", "brief.pdf")).toThrow(ValidationError);
	});

	it("rejects DEL (0x7F)", () => {
		expect(() => safeKey("reports", "a\u007Fb", "brief.pdf")).toThrow(ValidationError);
	});

	it("rejects components that reduce to empty after slash trim", () => {
		expect(() => safeKey("reports", "///", "brief.pdf")).toThrow(ValidationError);
	});

	it("allows internal slashes within a single part", () => {
		expect(safeKey("reports/2026/q1", "brief.pdf")).toBe("reports/2026/q1/brief.pdf");
	});
});
