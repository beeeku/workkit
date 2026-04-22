import { describe, expect, it } from "vitest";
import { encodeComment, encodeEvent } from "../src/framing";

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("encodeEvent", () => {
	it("emits event, id, and data lines terminated by a blank line", () => {
		const out = encodeEvent({ event: "run.stage", id: 42, data: '{"stage":"verify"}' });
		expect(decode(out)).toBe('event: run.stage\nid: 42\ndata: {"stage":"verify"}\n\n');
	});

	it("splits multi-line data into multiple data: lines", () => {
		const out = encodeEvent({ event: "msg", id: 1, data: "line one\nline two\nline three" });
		expect(decode(out)).toBe(
			"event: msg\nid: 1\ndata: line one\ndata: line two\ndata: line three\n\n",
		);
	});

	it("preserves unicode in data without escaping", () => {
		const out = encodeEvent({ event: "emoji", id: 7, data: "🚀 résumé" });
		expect(decode(out)).toBe("event: emoji\nid: 7\ndata: 🚀 résumé\n\n");
	});

	it("omits the id line when id is undefined", () => {
		const out = encodeEvent({ event: "anon", data: "x" });
		expect(decode(out)).toBe("event: anon\ndata: x\n\n");
	});

	it("emits only data when event is empty string", () => {
		const out = encodeEvent({ event: "", id: 0, data: "y" });
		expect(decode(out)).toBe("id: 0\ndata: y\n\n");
	});

	it("handles empty data payload", () => {
		const out = encodeEvent({ event: "ping", id: 5, data: "" });
		expect(decode(out)).toBe("event: ping\nid: 5\ndata: \n\n");
	});

	it("handles trailing newline in data by emitting an extra empty data line", () => {
		const out = encodeEvent({ event: "msg", id: 1, data: "one\n" });
		expect(decode(out)).toBe("event: msg\nid: 1\ndata: one\ndata: \n\n");
	});
});

describe("encodeComment", () => {
	it("prefixes with colon-space and terminates with blank line", () => {
		expect(decode(encodeComment("keepalive"))).toBe(": keepalive\n\n");
	});

	it("accepts empty comment", () => {
		expect(decode(encodeComment(""))).toBe(": \n\n");
	});

	it("escapes embedded newlines by dropping them (comments are single-line)", () => {
		expect(decode(encodeComment("a\nb"))).toBe(": ab\n\n");
	});
});
