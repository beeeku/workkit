import { describe, expect, it } from "vitest";
import { getSerializer } from "../src/serialization";

describe("json serializer", () => {
	const s = getSerializer<{ name: string }>("json");

	it("serializes objects to JSON strings", () => {
		expect(s.serialize({ name: "test" })).toBe('{"name":"test"}');
	});

	it("handles nested objects", () => {
		const s2 = getSerializer<{ a: { b: number } }>("json");
		expect(s2.serialize({ a: { b: 1 } })).toBe('{"a":{"b":1}}');
	});

	it("handles arrays", () => {
		const s2 = getSerializer<number[]>("json");
		expect(s2.serialize([1, 2, 3])).toBe("[1,2,3]");
	});

	it("has kvType json", () => {
		expect(s.kvType).toBe("json");
	});
});

describe("text serializer", () => {
	const s = getSerializer<string>("text");

	it("passes string values through unchanged", () => {
		expect(s.serialize("hello")).toBe("hello");
	});

	it("has kvType text", () => {
		expect(s.kvType).toBe("text");
	});
});

describe("arrayBuffer serializer", () => {
	const s = getSerializer<ArrayBuffer>("arrayBuffer");

	it("passes ArrayBuffer values through unchanged", () => {
		const buf = new ArrayBuffer(8);
		expect(s.serialize(buf)).toBe(buf);
	});

	it("has kvType arrayBuffer", () => {
		expect(s.kvType).toBe("arrayBuffer");
	});
});

describe("stream serializer", () => {
	it("has kvType stream", () => {
		const s = getSerializer<ReadableStream>("stream");
		expect(s.kvType).toBe("stream");
	});
});
