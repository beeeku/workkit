import { ValidationError } from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { raw } from "../src/escape";
import { renderPDF } from "../src/render";
import { mockSession } from "./_mocks";

describe("renderPDF()", () => {
	it("returns the PDF bytes from page.pdf()", async () => {
		const { session, page } = mockSession();
		const out = await renderPDF(session, "<h1>hi</h1>");
		expect(out).toBeInstanceOf(Uint8Array);
		expect(page.captured.html).toContain("<h1>hi</h1>");
	});

	it("defaults page format to A4 and printBackground to true", async () => {
		const { session, page } = mockSession();
		await renderPDF(session, "<p>x</p>");
		expect(page.captured.pdfOptions?.format).toBe("A4");
		expect(page.captured.pdfOptions?.printBackground).toBe(true);
	});

	it("applies the supplied margin string to all sides", async () => {
		const { session, page } = mockSession();
		await renderPDF(session, "<p>x</p>", { margin: "0.5in" });
		expect(page.captured.pdfOptions?.margin).toEqual({
			top: "0.5in",
			bottom: "0.5in",
			left: "0.5in",
			right: "0.5in",
		});
	});

	it("composes header/footer when supplied", async () => {
		const { session, page } = mockSession();
		await renderPDF(session, "<p>x</p>", {
			header: { title: "Pre-Market" },
			footer: { disclaimer: "Not advice", pageNumbers: true },
		});
		expect(page.captured.pdfOptions?.displayHeaderFooter).toBe(true);
		expect(page.captured.pdfOptions?.headerTemplate).toContain("Pre-Market");
		expect(page.captured.pdfOptions?.footerTemplate).toContain("Not advice");
		expect(page.captured.pdfOptions?.footerTemplate).toContain("pageNumber");
	});

	it("escapes a plain-string title in the header", async () => {
		const { session, page } = mockSession();
		await renderPDF(session, "<p>x</p>", { header: { title: "<script>x</script>" } });
		expect(page.captured.pdfOptions?.headerTemplate).not.toContain("<script>x</script>");
		expect(page.captured.pdfOptions?.headerTemplate).toContain("&lt;script&gt;");
	});

	it("respects raw() in header logo", async () => {
		const { session, page } = mockSession();
		await renderPDF(session, "<p>x</p>", {
			header: { logo: raw('<img src="https://x.example.com/l.png" />') },
		});
		expect(page.captured.pdfOptions?.headerTemplate).toContain(
			'<img src="https://x.example.com/l.png" />',
		);
	});

	it("disables JS by default (delegated to withPage)", async () => {
		const { session, page } = mockSession();
		await renderPDF(session, "<p>x</p>");
		expect(page.captured.setJsEnabled).toBe(false);
	});

	it("propagates abort signal to withPage", async () => {
		const { session } = mockSession();
		const ctrl = new AbortController();
		ctrl.abort(new Error("nope"));
		await expect(renderPDF(session, "<p>x</p>", { signal: ctrl.signal })).rejects.toThrow("nope");
	});

	it("throws ValidationError when disclaimerRequired but disclaimer missing (before opening a page)", async () => {
		const { session } = mockSession();
		await expect(
			renderPDF(session, "<p>x</p>", { disclaimerRequired: true }),
		).rejects.toBeInstanceOf(ValidationError);
	});
});
