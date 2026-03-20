import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAlarmHandler, parseDuration, scheduleAlarm } from "../src/alarm";
import { createMockStorage } from "./helpers";

describe("parseDuration", () => {
	it("should parse seconds", () => {
		expect(parseDuration("30s")).toBe(30_000);
	});

	it("should parse minutes", () => {
		expect(parseDuration("5m")).toBe(300_000);
	});

	it("should parse hours", () => {
		expect(parseDuration("1h")).toBe(3_600_000);
	});

	it("should parse days", () => {
		expect(parseDuration("2d")).toBe(172_800_000);
	});

	it("should parse large numbers", () => {
		expect(parseDuration("100s")).toBe(100_000);
	});

	it("should throw on invalid format", () => {
		expect(() => parseDuration("abc")).toThrow();
	});

	it("should throw on empty string", () => {
		expect(() => parseDuration("")).toThrow();
	});

	it("should throw on missing unit", () => {
		expect(() => parseDuration("100")).toThrow();
	});

	it("should throw on zero", () => {
		expect(() => parseDuration("0s")).toThrow();
	});

	it("should throw on negative", () => {
		expect(() => parseDuration("-5m")).toThrow();
	});
});

describe("scheduleAlarm", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should schedule an alarm with "in" duration string', async () => {
		const storage = createMockStorage();
		await scheduleAlarm(storage, { in: "5m" });
		expect(storage._alarm).toBe(Date.now() + 300_000);
	});

	it('should schedule an alarm with "in" seconds', async () => {
		const storage = createMockStorage();
		await scheduleAlarm(storage, { in: "30s" });
		expect(storage._alarm).toBe(Date.now() + 30_000);
	});

	it('should schedule an alarm with "in" hours', async () => {
		const storage = createMockStorage();
		await scheduleAlarm(storage, { in: "1h" });
		expect(storage._alarm).toBe(Date.now() + 3_600_000);
	});

	it("should schedule an alarm at a specific Date", async () => {
		const storage = createMockStorage();
		const target = new Date("2025-06-01T12:00:00Z");
		await scheduleAlarm(storage, { at: target });
		expect(storage._alarm).toBe(target.getTime());
	});

	it("should schedule an alarm at a specific timestamp", async () => {
		const storage = createMockStorage();
		const ts = Date.now() + 60_000;
		await scheduleAlarm(storage, { at: ts });
		expect(storage._alarm).toBe(ts);
	});
});

describe("createAlarmHandler", () => {
	it("should route to the correct action", async () => {
		const checkExpiry = vi.fn();
		const sendReminder = vi.fn();
		const handler = createAlarmHandler({
			actions: {
				"check-expiry": checkExpiry,
				"send-reminder": sendReminder,
			},
		});
		const storage = createMockStorage();
		storage._data.set("__alarm_action", "check-expiry");
		await handler.handle(storage);
		expect(checkExpiry).toHaveBeenCalledOnce();
		expect(checkExpiry).toHaveBeenCalledWith(storage);
		expect(sendReminder).not.toHaveBeenCalled();
	});

	it("should route to another action", async () => {
		const cleanup = vi.fn();
		const handler = createAlarmHandler({
			actions: {
				cleanup,
			},
		});
		const storage = createMockStorage();
		storage._data.set("__alarm_action", "cleanup");
		await handler.handle(storage);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("should throw when action not found", async () => {
		const handler = createAlarmHandler({
			actions: {
				"check-expiry": vi.fn(),
			},
		});
		const storage = createMockStorage();
		storage._data.set("__alarm_action", "unknown-action");
		await expect(handler.handle(storage)).rejects.toThrow(/unknown-action/);
	});

	it("should throw when no action key in storage", async () => {
		const handler = createAlarmHandler({
			actions: {
				"check-expiry": vi.fn(),
			},
		});
		const storage = createMockStorage();
		await expect(handler.handle(storage)).rejects.toThrow();
	});

	it("should use custom action key", async () => {
		const myAction = vi.fn();
		const handler = createAlarmHandler({
			actions: { myAction },
			actionKey: "custom_key",
		});
		const storage = createMockStorage();
		storage._data.set("custom_key", "myAction");
		await handler.handle(storage);
		expect(myAction).toHaveBeenCalledOnce();
	});

	it("should await async action handlers", async () => {
		const order: string[] = [];
		const handler = createAlarmHandler({
			actions: {
				slow: async () => {
					await new Promise((r) => setTimeout(r, 10));
					order.push("action-done");
				},
			},
		});
		const storage = createMockStorage();
		storage._data.set("__alarm_action", "slow");
		await handler.handle(storage);
		order.push("after-handle");
		expect(order).toEqual(["action-done", "after-handle"]);
	});

	it("should clear the action key after handling", async () => {
		const handler = createAlarmHandler({
			actions: {
				cleanup: vi.fn(),
			},
		});
		const storage = createMockStorage();
		storage._data.set("__alarm_action", "cleanup");
		await handler.handle(storage);
		expect(storage._data.has("__alarm_action")).toBe(false);
	});
});
