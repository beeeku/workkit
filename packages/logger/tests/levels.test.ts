import { describe, expect, it } from "vitest";
import { LEVEL_VALUES, shouldLog } from "../src/levels";

describe("log levels", () => {
	describe("LEVEL_VALUES", () => {
		it("debug < info < warn < error", () => {
			expect(LEVEL_VALUES.debug).toBeLessThan(LEVEL_VALUES.info);
			expect(LEVEL_VALUES.info).toBeLessThan(LEVEL_VALUES.warn);
			expect(LEVEL_VALUES.warn).toBeLessThan(LEVEL_VALUES.error);
		});
	});

	describe("shouldLog", () => {
		it("logs everything at debug level", () => {
			expect(shouldLog("debug", "debug")).toBe(true);
			expect(shouldLog("info", "debug")).toBe(true);
			expect(shouldLog("warn", "debug")).toBe(true);
			expect(shouldLog("error", "debug")).toBe(true);
		});

		it("filters debug at info level", () => {
			expect(shouldLog("debug", "info")).toBe(false);
			expect(shouldLog("info", "info")).toBe(true);
			expect(shouldLog("warn", "info")).toBe(true);
			expect(shouldLog("error", "info")).toBe(true);
		});

		it("filters debug and info at warn level", () => {
			expect(shouldLog("debug", "warn")).toBe(false);
			expect(shouldLog("info", "warn")).toBe(false);
			expect(shouldLog("warn", "warn")).toBe(true);
			expect(shouldLog("error", "warn")).toBe(true);
		});

		it("only allows error at error level", () => {
			expect(shouldLog("debug", "error")).toBe(false);
			expect(shouldLog("info", "error")).toBe(false);
			expect(shouldLog("warn", "error")).toBe(false);
			expect(shouldLog("error", "error")).toBe(true);
		});
	});
});
