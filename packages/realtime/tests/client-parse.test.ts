import { describe, expect, it } from "vitest";
import { type ParsedFrame, createSseParser } from "../src/client/parse";

function collect(input: string): ParsedFrame[] {
	const frames: ParsedFrame[] = [];
	const feed = createSseParser((f) => frames.push(f));
	feed(input);
	return frames;
}

describe("createSseParser", () => {
	it("parses a single event with event, id, data", () => {
		const frames = collect('event: run.stage\nid: 1\ndata: {"k":1}\n\n');
		expect(frames).toEqual([{ event: "run.stage", id: 1, data: '{"k":1}' }]);
	});

	it("joins multi-line data with newlines", () => {
		const frames = collect("event: x\nid: 2\ndata: one\ndata: two\n\n");
		expect(frames).toEqual([{ event: "x", id: 2, data: "one\ntwo" }]);
	});

	it("defaults event name to 'message' when omitted", () => {
		const frames = collect("id: 5\ndata: hello\n\n");
		expect(frames).toEqual([{ event: "message", id: 5, data: "hello" }]);
	});

	it("ignores comment lines", () => {
		const frames = collect(": keepalive\n\nevent: x\nid: 1\ndata: y\n\n");
		expect(frames).toEqual([{ event: "x", id: 1, data: "y" }]);
	});

	it("handles split chunks", () => {
		const frames: ParsedFrame[] = [];
		const feed = createSseParser((f) => frames.push(f));
		feed("event: x\nid: 1\nda");
		feed("ta: hello\n\n");
		expect(frames).toEqual([{ event: "x", id: 1, data: "hello" }]);
	});

	it("parses multiple events in one chunk", () => {
		const frames = collect("event: a\nid: 1\ndata: 1\n\nevent: b\nid: 2\ndata: 2\n\n");
		expect(frames).toEqual([
			{ event: "a", id: 1, data: "1" },
			{ event: "b", id: 2, data: "2" },
		]);
	});

	it("ignores stray non-field lines and malformed ids", () => {
		const frames = collect("event: x\nid: abc\ndata: y\n\n");
		expect(frames).toEqual([{ event: "x", id: undefined, data: "y" }]);
	});

	it("tolerates CRLF line endings from proxies", () => {
		const frames = collect("event: x\r\nid: 1\r\ndata: y\r\n\r\n");
		expect(frames).toEqual([{ event: "x", id: 1, data: "y" }]);
	});
});
