import { describe, expect, it } from "vitest";
import { defaultStopKeywords, isStopKeyword } from "../../../src/adapters/whatsapp/keywords";

describe("isStopKeyword()", () => {
	it("matches case-insensitively across English keywords", () => {
		expect(isStopKeyword("STOP")).toBe(true);
		expect(isStopKeyword("stop")).toBe(true);
		expect(isStopKeyword("UnSubScRiBe")).toBe(true);
	});

	it("matches Hindi keywords (Devanagari + transliteration)", () => {
		expect(isStopKeyword("बंद")).toBe(true);
		expect(isStopKeyword("rok")).toBe(true);
	});

	it("matches Spanish + French keywords", () => {
		expect(isStopKeyword("alto")).toBe(true);
		expect(isStopKeyword("baja")).toBe(true);
		expect(isStopKeyword("arrêt")).toBe(true);
		expect(isStopKeyword("arret")).toBe(true);
	});

	it("does NOT match substrings — body must equal the keyword", () => {
		expect(isStopKeyword("please stop sending these")).toBe(false);
		expect(isStopKeyword("stop now")).toBe(false);
	});

	it("trims surrounding whitespace before comparing", () => {
		expect(isStopKeyword("   stop  \n")).toBe(true);
	});

	it("ignores empty/whitespace-only input", () => {
		expect(isStopKeyword("")).toBe(false);
		expect(isStopKeyword("   ")).toBe(false);
	});

	it("respects extraKeywords", () => {
		expect(isStopKeyword("opt out", { extraKeywords: ["opt out"] })).toBe(true);
		expect(isStopKeyword("opt out")).toBe(false);
	});

	it("exposes the default keyword list for tests/inspection", () => {
		const list = defaultStopKeywords();
		expect(list).toContain("stop");
		expect(list.length).toBeGreaterThan(5);
	});
});
