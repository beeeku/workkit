import { describe, expect, it } from "vitest";
import { combinePrefixes, prefixKey, stripPrefix } from "../src/prefix";

describe("prefixKey", () => {
	it("prepends prefix to key", () => {
		expect(prefixKey("user:", "123")).toBe("user:123");
	});

	it("returns key unchanged when prefix is undefined", () => {
		expect(prefixKey(undefined, "123")).toBe("123");
	});

	it("returns key unchanged when prefix is empty string", () => {
		expect(prefixKey("", "123")).toBe("123");
	});

	it("handles multi-segment prefixes", () => {
		expect(prefixKey("v2:user:", "abc")).toBe("v2:user:abc");
	});
});

describe("stripPrefix", () => {
	it("removes prefix from key", () => {
		expect(stripPrefix("user:", "user:123")).toBe("123");
	});

	it("returns key unchanged when no prefix", () => {
		expect(stripPrefix(undefined, "user:123")).toBe("user:123");
	});

	it("returns key unchanged when key does not start with prefix", () => {
		expect(stripPrefix("user:", "post:123")).toBe("post:123");
	});
});

describe("combinePrefixes", () => {
	it("combines client and list prefixes", () => {
		expect(combinePrefixes("user:", "active:")).toBe("user:active:");
	});

	it("returns client prefix when list prefix is undefined", () => {
		expect(combinePrefixes("user:", undefined)).toBe("user:");
	});

	it("returns list prefix when client prefix is undefined", () => {
		expect(combinePrefixes(undefined, "active:")).toBe("active:");
	});

	it("returns undefined when both are undefined", () => {
		expect(combinePrefixes(undefined, undefined)).toBeUndefined();
	});
});
