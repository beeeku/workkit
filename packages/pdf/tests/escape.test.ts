import { describe, expect, it } from "vitest";
import { escapeHtml, isRaw, raw, toSafeHtml } from "../src/escape";

describe("escapeHtml() (renamed from escape to avoid the global)", () => {
	it("escapes HTML special chars", () => {
		expect(escapeHtml(`<div class="x">a & b</div>`)).toBe(
			"&lt;div class=&quot;x&quot;&gt;a &amp; b&lt;/div&gt;",
		);
	});

	it("escapes single quotes", () => {
		expect(escapeHtml("it's")).toBe("it&#39;s");
	});

	it("coerces numbers and booleans", () => {
		expect(escapeHtml(42)).toBe("42");
		expect(escapeHtml(true)).toBe("true");
	});

	it("returns empty string for null/undefined", () => {
		expect(escapeHtml(null)).toBe("");
		expect(escapeHtml(undefined)).toBe("");
	});
});

describe("raw() / isRaw()", () => {
	it("brands a string and isRaw recognizes it", () => {
		const r = raw("<b>safe</b>");
		expect(isRaw(r)).toBe(true);
		expect(isRaw("<b>plain</b>")).toBe(false);
		expect(isRaw(42)).toBe(false);
		expect(isRaw(null)).toBe(false);
	});
});

describe("toSafeHtml()", () => {
	it("escapes plain strings", () => {
		expect(toSafeHtml("<x>")).toBe("&lt;x&gt;");
	});

	it("passes raw() through unescaped", () => {
		expect(toSafeHtml(raw("<x>"))).toBe("<x>");
	});

	it("returns empty for null/undefined", () => {
		expect(toSafeHtml(null)).toBe("");
		expect(toSafeHtml(undefined)).toBe("");
	});

	it("escapes numbers and booleans", () => {
		expect(toSafeHtml(42)).toBe("42");
	});
});
