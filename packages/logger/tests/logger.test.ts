import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger";

describe("createLogger", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("creates a logger with default info level", () => {
		const log = createLogger();
		expect(log.level).toBe("info");
	});

	it("logs info messages to console.info", () => {
		consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const log = createLogger();
		log.info("hello");
		expect(consoleSpy).toHaveBeenCalledTimes(1);
		const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
		expect(output.level).toBe("info");
		expect(output.msg).toBe("hello");
	});

	it("logs warn messages to console.warn", () => {
		consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const log = createLogger();
		log.warn("caution");
		expect(consoleSpy).toHaveBeenCalledTimes(1);
	});

	it("logs error messages to console.error", () => {
		consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = createLogger();
		log.error("broken");
		expect(consoleSpy).toHaveBeenCalledTimes(1);
	});

	it("logs debug messages to console.debug", () => {
		consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		const log = createLogger({ level: "debug" });
		log.debug("verbose");
		expect(consoleSpy).toHaveBeenCalledTimes(1);
	});

	it("filters messages below configured level", () => {
		consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
		const log = createLogger({ level: "warn" });
		log.debug("filtered");
		log.info("also filtered");
		expect(consoleSpy).not.toHaveBeenCalled();
	});

	it("includes base fields in every log entry", () => {
		consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const log = createLogger({ fields: { service: "api", version: "1.0" } });
		log.info("hello");
		const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
		expect(output.service).toBe("api");
		expect(output.version).toBe("1.0");
	});

	it("merges call-site fields with base fields", () => {
		consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const log = createLogger({ fields: { service: "api" } });
		log.info("req", { path: "/users", method: "GET" });
		const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
		expect(output.service).toBe("api");
		expect(output.path).toBe("/users");
		expect(output.method).toBe("GET");
	});

	it("call-site fields override base fields", () => {
		consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		const log = createLogger({ fields: { env: "prod" } });
		log.info("override", { env: "staging" });
		const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
		expect(output.env).toBe("staging");
	});

	describe("child logger", () => {
		it("creates a child with additional persistent fields", () => {
			consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
			const log = createLogger({ fields: { service: "api" } });
			const child = log.child({ userId: "42" });
			child.info("action");
			const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
			expect(output.service).toBe("api");
			expect(output.userId).toBe("42");
		});

		it("child fields override parent fields", () => {
			consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
			const log = createLogger({ fields: { scope: "parent" } });
			const child = log.child({ scope: "child" });
			child.info("test");
			const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
			expect(output.scope).toBe("child");
		});

		it("inherits parent log level", () => {
			consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
			const log = createLogger({ level: "warn" });
			const child = log.child({ component: "db" });
			child.debug("filtered");
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it("supports nested children", () => {
			consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
			const log = createLogger({ fields: { a: 1 } });
			const child1 = log.child({ b: 2 });
			const child2 = child1.child({ c: 3 });
			child2.info("deep");
			const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
			expect(output.a).toBe(1);
			expect(output.b).toBe(2);
			expect(output.c).toBe(3);
		});
	});
});
