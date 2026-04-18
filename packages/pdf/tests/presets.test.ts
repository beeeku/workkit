import { describe, expect, it } from "vitest";
import { defaults, margin, pageSize, resolveMargin } from "../src/presets";

describe("page size presets", () => {
	it("exposes A4 / Letter / Legal with formats", () => {
		expect(pageSize.A4.format).toBe("A4");
		expect(pageSize.Letter.format).toBe("Letter");
		expect(pageSize.Legal.format).toBe("Legal");
	});

	it("defaults to A4 + 1in normal margin", () => {
		expect(defaults.page).toBe(pageSize.A4);
		expect(defaults.margin).toEqual(margin.normal);
	});
});

describe("resolveMargin()", () => {
	it("returns default when undefined", () => {
		expect(resolveMargin(undefined)).toEqual(margin.normal);
	});

	it("expands a single string to all sides", () => {
		expect(resolveMargin("0.5in")).toEqual({
			top: "0.5in",
			bottom: "0.5in",
			left: "0.5in",
			right: "0.5in",
		});
	});

	it("fills missing sides from partial", () => {
		expect(resolveMargin({ top: "2in" })).toEqual({
			top: "2in",
			bottom: "1in",
			left: "1in",
			right: "1in",
		});
	});

	it("passes through full margin record", () => {
		const m = { top: "1in", bottom: "2in", left: "3in", right: "4in" };
		expect(resolveMargin(m)).toEqual(m);
	});
});
