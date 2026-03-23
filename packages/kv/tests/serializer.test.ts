import { describe, expect, it } from "vitest";
import { jsonSerializer, resolveSerializer, textSerializer } from "../src/serializer";

describe("jsonSerializer", () => {
	it("serializes objects to JSON strings", () => {
		expect(jsonSerializer.serialize({ name: "test" })).toBe('{"name":"test"}');
	});

	it("deserializes JSON strings to objects", () => {
		expect(jsonSerializer.deserialize('{"name":"test"}')).toEqual({ name: "test" });
	});

	it("handles nested objects and arrays", () => {
		const value = { users: [{ name: "A" }, { name: "B" }] };
		const serialized = jsonSerializer.serialize(value);
		expect(jsonSerializer.deserialize(serialized as string)).toEqual(value);
	});

	it("throws on circular references", () => {
		const obj: any = {};
		obj.self = obj;
		expect(() => jsonSerializer.serialize(obj)).toThrow();
	});
});

describe("textSerializer", () => {
	it("passes strings through unchanged", () => {
		expect(textSerializer.serialize("hello")).toBe("hello");
		expect(textSerializer.deserialize("hello")).toBe("hello");
	});
});

describe("resolveSerializer", () => {
	it("returns jsonSerializer for undefined", () => {
		const s = resolveSerializer(undefined);
		expect(s.serialize({ a: 1 })).toBe('{"a":1}');
	});

	it("returns jsonSerializer for 'json'", () => {
		const s = resolveSerializer("json");
		expect(s.serialize({ a: 1 })).toBe('{"a":1}');
	});

	it("returns textSerializer for 'text'", () => {
		const s = resolveSerializer<string>("text");
		expect(s.serialize("hello")).toBe("hello");
	});

	it("returns custom serializer when provided", () => {
		const custom = {
			serialize: (v: number) => String(v),
			deserialize: (raw: string) => Number(raw),
		};
		const s = resolveSerializer(custom);
		expect(s.serialize(42)).toBe("42");
		expect(s.deserialize("42")).toBe(42);
	});
});
