import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "../src/quiet-hours";

describe("isWithinQuietHours()", () => {
	it("returns true when the local hour is inside a same-day window", () => {
		// 09:00 UTC = 14:30 IST
		const at = new Date("2026-04-18T09:00:00Z");
		expect(isWithinQuietHours({ start: "14:00", end: "15:00", timezone: "Asia/Kolkata" }, at)).toBe(
			true,
		);
	});

	it("returns false when the local hour is outside a same-day window", () => {
		const at = new Date("2026-04-18T09:00:00Z"); // 14:30 IST
		expect(isWithinQuietHours({ start: "00:00", end: "08:00", timezone: "Asia/Kolkata" }, at)).toBe(
			false,
		);
	});

	it("handles midnight wrap (start > end) — late evening case", () => {
		// 18:30 UTC = 00:00 IST next day — inside 22:00–06:00 IST
		const at = new Date("2026-04-18T18:30:00Z");
		expect(isWithinQuietHours({ start: "22:00", end: "06:00", timezone: "Asia/Kolkata" }, at)).toBe(
			true,
		);
	});

	it("handles midnight wrap — early morning case", () => {
		// 23:00 UTC = 04:30 IST next day — inside 22:00–06:00 IST
		const at = new Date("2026-04-18T23:00:00Z");
		expect(isWithinQuietHours({ start: "22:00", end: "06:00", timezone: "Asia/Kolkata" }, at)).toBe(
			true,
		);
	});

	it("handles midnight wrap — outside the wrap window", () => {
		// 06:00 UTC = 11:30 IST — outside 22:00–06:00 IST
		const at = new Date("2026-04-18T06:00:00Z");
		expect(isWithinQuietHours({ start: "22:00", end: "06:00", timezone: "Asia/Kolkata" }, at)).toBe(
			false,
		);
	});

	it("treats start == end as an empty window (always false)", () => {
		const at = new Date("2026-04-18T09:00:00Z");
		expect(isWithinQuietHours({ start: "12:00", end: "12:00", timezone: "Asia/Kolkata" }, at)).toBe(
			false,
		);
	});

	it("rejects malformed HH:mm", () => {
		const at = new Date();
		expect(() =>
			isWithinQuietHours({ start: "25:00", end: "06:00", timezone: "UTC" }, at),
		).toThrow();
		expect(() => isWithinQuietHours({ start: "abc", end: "06:00", timezone: "UTC" }, at)).toThrow();
	});
});
