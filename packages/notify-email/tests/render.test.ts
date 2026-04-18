import { describe, expect, it } from "vitest";
import { __resetRenderer, htmlToText, renderEmail } from "../src/render";

describe("htmlToText()", () => {
	it("strips simple tags", () => {
		expect(htmlToText("<p>hello <b>world</b></p>")).toBe("hello world");
	});

	it("converts <br> to newlines and block elements to newlines", () => {
		expect(htmlToText("a<br/>b<br>c<p>d</p>e")).toContain("a\nb\nc");
	});

	it("strips script/style blocks entirely", () => {
		expect(htmlToText("<p>x</p><script>alert(1)</script><style>.a{}</style><p>y</p>")).toBe("x\ny");
	});

	it("decodes the most common HTML entities and collapses whitespace runs", () => {
		expect(htmlToText("a &amp; b &nbsp; c &lt;d&gt;")).toBe("a & b c <d>");
	});

	it("collapses runs of whitespace", () => {
		expect(htmlToText("a    b\t\tc")).toBe("a b c");
	});
});

describe("renderEmail()", () => {
	it("treats a plain string template as ready HTML", async () => {
		const out = await renderEmail({ template: "<p>hi</p>" });
		expect(out.html).toBe("<p>hi</p>");
		expect(out.text).toBe("hi");
	});

	it("respects an explicitly provided text", async () => {
		const out = await renderEmail({ template: "<p>hi</p>", text: "bye" });
		expect(out.text).toBe("bye");
	});

	it("falls back to '[no text content]' when text is empty", async () => {
		const out = await renderEmail({ template: "" });
		expect(out.text).toBe("[no text content]");
	});

	it("requests @react-email/render when template is not a string and throws if missing", async () => {
		__resetRenderer();
		await expect(renderEmail({ template: { not: "a string" } })).rejects.toThrow(
			/@react-email\/render/,
		);
	});
});
