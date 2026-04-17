import { describe, expect, it } from "vitest";
import { ChatError } from "../src/errors";
import { createMessageId, decodeMessage, encodeMessage } from "../src/protocol";
import type { ChatMessage } from "../src/types";

describe("encodeMessage", () => {
	it("should serialize a ChatMessage to JSON", () => {
		const msg: ChatMessage = {
			id: "abc-123",
			type: "message",
			role: "user",
			content: "Hello world",
			timestamp: 1700000000000,
		};
		const encoded = encodeMessage(msg);
		const parsed = JSON.parse(encoded);
		expect(parsed).toEqual(msg);
	});

	it("should include metadata when present", () => {
		const msg: ChatMessage = {
			id: "abc-123",
			type: "tool_call",
			role: "assistant",
			content: "calling tool",
			metadata: { toolName: "search", args: { q: "test" } },
			timestamp: 1700000000000,
		};
		const encoded = encodeMessage(msg);
		const parsed = JSON.parse(encoded);
		expect(parsed.metadata).toEqual({ toolName: "search", args: { q: "test" } });
	});

	it("should produce valid JSON", () => {
		const msg: ChatMessage = {
			id: "x",
			type: "system",
			role: "system",
			content: 'special "chars" & <html>',
			timestamp: 0,
		};
		expect(() => JSON.parse(encodeMessage(msg))).not.toThrow();
	});
});

describe("decodeMessage", () => {
	it("should decode a valid wire message", () => {
		const data = JSON.stringify({
			type: "message",
			content: "hello",
			role: "user",
			id: "msg-1",
		});
		const wire = decodeMessage(data);
		expect(wire.type).toBe("message");
		expect(wire.content).toBe("hello");
		expect(wire.role).toBe("user");
		expect(wire.id).toBe("msg-1");
	});

	it("should decode a minimal wire message (type + content only)", () => {
		const data = JSON.stringify({ type: "typing", content: "" });
		const wire = decodeMessage(data);
		expect(wire.type).toBe("typing");
		expect(wire.content).toBe("");
		expect(wire.id).toBeUndefined();
		expect(wire.role).toBeUndefined();
		expect(wire.metadata).toBeUndefined();
	});

	it("should decode all valid message types", () => {
		const types = ["message", "typing", "error", "tool_call", "tool_result", "system"];
		for (const type of types) {
			const wire = decodeMessage(JSON.stringify({ type, content: "test" }));
			expect(wire.type).toBe(type);
		}
	});

	it("should throw ChatError for invalid JSON", () => {
		expect(() => decodeMessage("not json")).toThrow(ChatError);
		expect(() => decodeMessage("not json")).toThrow("Failed to parse message as JSON");
	});

	it("should throw ChatError for non-object JSON", () => {
		expect(() => decodeMessage('"a string"')).toThrow(ChatError);
		expect(() => decodeMessage("42")).toThrow(ChatError);
		expect(() => decodeMessage("null")).toThrow(ChatError);
		expect(() => decodeMessage("[1,2]")).toThrow(ChatError);
	});

	it("should throw ChatError for invalid message type", () => {
		const data = JSON.stringify({ type: "invalid", content: "x" });
		expect(() => decodeMessage(data)).toThrow(ChatError);
		expect(() => decodeMessage(data)).toThrow("Invalid message type");
	});

	it("should throw ChatError for missing type", () => {
		const data = JSON.stringify({ content: "x" });
		expect(() => decodeMessage(data)).toThrow(ChatError);
	});

	it("should throw ChatError for missing content", () => {
		const data = JSON.stringify({ type: "message" });
		expect(() => decodeMessage(data)).toThrow(ChatError);
		expect(() => decodeMessage(data)).toThrow("string 'content' field");
	});

	it("should throw ChatError for non-string content", () => {
		const data = JSON.stringify({ type: "message", content: 123 });
		expect(() => decodeMessage(data)).toThrow(ChatError);
	});

	it("should parse metadata when it is a valid object", () => {
		const data = JSON.stringify({
			type: "message",
			content: "hi",
			metadata: { key: "value" },
		});
		const wire = decodeMessage(data);
		expect(wire.metadata).toEqual({ key: "value" });
	});

	it("should ignore metadata when it is not an object", () => {
		const data = JSON.stringify({
			type: "message",
			content: "hi",
			metadata: "not-an-object",
		});
		const wire = decodeMessage(data);
		expect(wire.metadata).toBeUndefined();
	});

	it("should ignore metadata when it is an array", () => {
		const data = JSON.stringify({
			type: "message",
			content: "hi",
			metadata: [1, 2, 3],
		});
		const wire = decodeMessage(data);
		expect(wire.metadata).toBeUndefined();
	});

	it("should parse lastMessageId when present", () => {
		const data = JSON.stringify({
			type: "message",
			content: "hi",
			lastMessageId: "prev-123",
		});
		const wire = decodeMessage(data);
		expect(wire.lastMessageId).toBe("prev-123");
	});

	it("should ignore lastMessageId when not a string", () => {
		const data = JSON.stringify({
			type: "message",
			content: "hi",
			lastMessageId: 42,
		});
		const wire = decodeMessage(data);
		expect(wire.lastMessageId).toBeUndefined();
	});
});

describe("encodeMessage / decodeMessage round-trip", () => {
	it("should round-trip a ChatMessage through encode then decode", () => {
		const original: ChatMessage = {
			id: "round-trip-1",
			type: "message",
			role: "assistant",
			content: "Response text",
			metadata: { tokens: 42 },
			timestamp: 1700000000000,
		};
		const wire = decodeMessage(encodeMessage(original));
		expect(wire.type).toBe(original.type);
		expect(wire.id).toBe(original.id);
		expect(wire.content).toBe(original.content);
		expect(wire.role).toBe(original.role);
		expect(wire.metadata).toEqual(original.metadata);
	});
});

describe("createMessageId", () => {
	it("should return a non-empty string", () => {
		const id = createMessageId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("should return unique IDs on successive calls", () => {
		const ids = new Set(Array.from({ length: 100 }, () => createMessageId()));
		expect(ids.size).toBe(100);
	});
});
