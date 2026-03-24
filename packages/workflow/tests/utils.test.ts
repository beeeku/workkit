import { describe, expect, it } from "vitest";
import { generateExecutionId, generateStepKey, parseDuration } from "../src/utils";

describe("generateExecutionId", () => {
	it("has wf_ prefix", () => {
		const id = generateExecutionId();
		expect(id.startsWith("wf_")).toBe(true);
	});

	it("has correct total length (wf_ + 16 chars)", () => {
		const id = generateExecutionId();
		expect(id.length).toBe(3 + 16);
	});

	it("generates unique ids", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateExecutionId()));
		expect(ids.size).toBe(100);
	});

	it("only contains alphanumeric characters after prefix", () => {
		const id = generateExecutionId();
		const suffix = id.slice(3);
		expect(/^[A-Za-z0-9]+$/.test(suffix)).toBe(true);
	});
});

describe("parseDuration", () => {
	it("parses milliseconds", () => {
		expect(parseDuration("100ms")).toBe(100);
		expect(parseDuration("1ms")).toBe(1);
		expect(parseDuration("500ms")).toBe(500);
	});

	it("parses seconds", () => {
		expect(parseDuration("1s")).toBe(1000);
		expect(parseDuration("30s")).toBe(30_000);
		expect(parseDuration("60s")).toBe(60_000);
	});

	it("parses minutes", () => {
		expect(parseDuration("1m")).toBe(60_000);
		expect(parseDuration("5m")).toBe(300_000);
		expect(parseDuration("60m")).toBe(3_600_000);
	});

	it("parses hours", () => {
		expect(parseDuration("1h")).toBe(3_600_000);
		expect(parseDuration("2h")).toBe(7_200_000);
		expect(parseDuration("24h")).toBe(86_400_000);
	});

	it("parses days", () => {
		expect(parseDuration("1d")).toBe(86_400_000);
		expect(parseDuration("7d")).toBe(604_800_000);
	});

	it("throws on invalid format", () => {
		expect(() => parseDuration("")).toThrow("Invalid duration:");
		expect(() => parseDuration("abc")).toThrow("Invalid duration:");
		expect(() => parseDuration("100")).toThrow("Invalid duration:");
		expect(() => parseDuration("1x")).toThrow("Invalid duration:");
		expect(() => parseDuration("-1s")).toThrow("Invalid duration:");
	});
});

describe("generateStepKey", () => {
	it("formats key correctly", () => {
		expect(generateStepKey(0)).toBe("wf:step:0");
		expect(generateStepKey(1)).toBe("wf:step:1");
		expect(generateStepKey(99)).toBe("wf:step:99");
	});

	it("generates distinct keys for different indices", () => {
		const keys = Array.from({ length: 10 }, (_, i) => generateStepKey(i));
		const unique = new Set(keys);
		expect(unique.size).toBe(10);
	});
});
