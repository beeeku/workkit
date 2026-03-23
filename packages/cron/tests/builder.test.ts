import { describe, expect, it } from "vitest";
import { cron } from "../src";

describe("cron builder", () => {
	it("every minute", () => {
		expect(cron().every().minute().build()).toBe("* * * * *");
	});

	it("every N minutes", () => {
		expect(cron().every(15).minutes().build()).toBe("*/15 * * * *");
	});

	it("every hour", () => {
		expect(cron().every().hour().build()).toBe("0 * * * *");
	});

	it("every N hours", () => {
		expect(cron().every(2).hours().build()).toBe("0 */2 * * *");
	});

	it("every day at specific time", () => {
		expect(cron().every().day().at(9, 0).build()).toBe("0 9 * * *");
	});

	it("every day at hour only (minute defaults to 0)", () => {
		expect(cron().every().day().at(9).build()).toBe("0 9 * * *");
	});

	it("every weekday at specific time", () => {
		expect(cron().every().weekday().at(9).build()).toBe("0 9 * * 1-5");
	});

	it("on specific day of week", () => {
		expect(cron().on().monday().at(14, 30).build()).toBe("30 14 * * 1");
	});

	it("on first of month", () => {
		expect(cron().on().day(1).at(0).build()).toBe("0 0 1 * *");
	});

	it("toString works for template literals", () => {
		const expr = `${cron().every(5).minutes()}`;
		expect(expr).toBe("*/5 * * * *");
	});

	it("singular and plural aliases work the same", () => {
		expect(cron().every().minute().build()).toBe(cron().every().minutes().build());
		expect(cron().every().hour().build()).toBe(cron().every().hours().build());
	});

	it("all days of week", () => {
		expect(cron().on().tuesday().at(10).build()).toBe("0 10 * * 2");
		expect(cron().on().wednesday().at(10).build()).toBe("0 10 * * 3");
		expect(cron().on().thursday().at(10).build()).toBe("0 10 * * 4");
		expect(cron().on().friday().at(10).build()).toBe("0 10 * * 5");
		expect(cron().on().saturday().at(10).build()).toBe("0 10 * * 6");
		expect(cron().on().sunday().at(10).build()).toBe("0 10 * * 0");
	});
});
