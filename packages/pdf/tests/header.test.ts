import { ValidationError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { raw } from "../src/escape";
import { composeHeaderFooter } from "../src/header";

describe("composeHeaderFooter()", () => {
	it("emits empty placeholder templates when no parts supplied", () => {
		const c = composeHeaderFooter({});
		expect(c.displayHeaderFooter).toBe(false);
		expect(c.headerTemplate).toBe("<div></div>");
		expect(c.footerTemplate).toBe("<div></div>");
	});

	it("escapes plain string title by default", () => {
		const c = composeHeaderFooter({ header: { title: "<b>Q4</b> & beyond" } });
		expect(c.displayHeaderFooter).toBe(true);
		expect(c.headerTemplate).toContain("&lt;b&gt;Q4&lt;/b&gt; &amp; beyond");
		expect(c.headerTemplate).not.toContain("<b>Q4</b>");
	});

	it("emits raw HTML when caller wraps with raw()", () => {
		const c = composeHeaderFooter({
			header: { logo: raw('<img src="https://x.example.com/l.png" />') },
		});
		expect(c.headerTemplate).toContain('<img src="https://x.example.com/l.png" />');
	});

	it("escapes injection attempts in right slot", () => {
		const c = composeHeaderFooter({ header: { right: '"><script>alert(1)</script>' } });
		expect(c.headerTemplate).not.toContain("<script>");
	});

	it("includes pageNumber spans only when pageNumbers: true", () => {
		const off = composeHeaderFooter({ footer: { disclaimer: "Not advice" } });
		expect(off.footerTemplate).not.toContain("pageNumber");

		const on = composeHeaderFooter({
			footer: { disclaimer: "Not advice", pageNumbers: true },
		});
		expect(on.footerTemplate).toContain('class="pageNumber"');
		expect(on.footerTemplate).toContain('class="totalPages"');
	});

	it("throws ValidationError when disclaimerRequired but disclaimer missing", () => {
		expect(() =>
			composeHeaderFooter({
				disclaimerRequired: true,
				footer: { disclaimer: "" },
			}),
		).toThrow(ValidationError);
		expect(() =>
			composeHeaderFooter({ disclaimerRequired: true, footer: { disclaimer: "   " } }),
		).toThrow(ValidationError);
		expect(() => composeHeaderFooter({ disclaimerRequired: true })).toThrow(ValidationError);
	});

	it("disclaimerRequired passes when a non-empty disclaimer is present", () => {
		const c = composeHeaderFooter({
			disclaimerRequired: true,
			footer: { disclaimer: "Not investment advice" },
		});
		expect(c.footerTemplate).toContain("Not investment advice");
	});
});
