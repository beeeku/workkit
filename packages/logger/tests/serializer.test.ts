import { describe, expect, it, vi } from "vitest";
import { serialize } from "../src/serializer";

describe("serializer", () => {
	it("produces a JSON string with level, msg, and ts", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

		const result = JSON.parse(serialize("info", "hello", {}));
		expect(result).toEqual({
			level: "info",
			msg: "hello",
			ts: 1735689600000,
		});

		vi.useRealTimers();
	});

	it("merges extra fields into output", () => {
		const result = JSON.parse(serialize("warn", "slow", { duration: 450, path: "/api" }));
		expect(result.level).toBe("warn");
		expect(result.msg).toBe("slow");
		expect(result.duration).toBe(450);
		expect(result.path).toBe("/api");
	});

	it("omits undefined and null fields", () => {
		const result = JSON.parse(serialize("info", "clean", { a: undefined, b: null, c: "keep" }));
		expect(result).not.toHaveProperty("a");
		expect(result).not.toHaveProperty("b");
		expect(result.c).toBe("keep");
	});

	it("serializes Error objects to { message, name, stack }", () => {
		const err = new Error("boom");
		const result = JSON.parse(serialize("error", "failed", { error: err }));
		expect(result.error.message).toBe("boom");
		expect(result.error.name).toBe("Error");
		expect(result.error.stack).toBeDefined();
	});

	it("handles circular references gracefully", () => {
		const obj: Record<string, unknown> = { a: 1 };
		obj.self = obj;
		const result = serialize("info", "circular", { data: obj });
		expect(result).toContain("[Circular]");
	});

	it("truncates string values longer than 1KB", () => {
		const long = "x".repeat(2000);
		const result = JSON.parse(serialize("info", "big", { value: long }));
		expect(result.value.length).toBeLessThanOrEqual(1027); // 1024 + "..."
		expect(result.value).toMatch(/\.\.\.$/);
	});

	it("redacts fields by name list", () => {
		const result = JSON.parse(
			serialize("info", "req", { authorization: "Bearer secret", path: "/api" }, ["authorization"]),
		);
		expect(result.authorization).toBe("[REDACTED]");
		expect(result.path).toBe("/api");
	});

	it("redacts fields by custom function", () => {
		const redactor = (key: string, value: unknown) => {
			if (key === "password") return "[REDACTED]";
			return value;
		};
		const result = JSON.parse(
			serialize("info", "login", { password: "secret123", user: "alice" }, redactor),
		);
		expect(result.password).toBe("[REDACTED]");
		expect(result.user).toBe("alice");
	});
});
