import { describe, expect, it, vi } from "vitest";
import { MarketingPauseRegistry } from "../../../src/adapters/whatsapp/marketing-pause";

describe("MarketingPauseRegistry", () => {
	it("starts unpaused", () => {
		const r = new MarketingPauseRegistry();
		expect(r.isPaused()).toBe(false);
	});

	it("pause()/resume() flip the flag and emit audit events", async () => {
		const audit = vi.fn();
		const r = new MarketingPauseRegistry({ auditHook: audit });
		await r.pause("meta-quality:low");
		expect(r.isPaused()).toBe(true);
		expect(r.pauseReason()).toBe("meta-quality:low");
		expect(audit).toHaveBeenCalledTimes(1);
		expect(audit.mock.calls[0]![0]).toMatchObject({ state: "paused", reason: "meta-quality:low" });

		await r.resume("operator-cleared");
		expect(r.isPaused()).toBe(false);
		expect(audit).toHaveBeenCalledTimes(2);
		expect(audit.mock.calls[1]![0]).toMatchObject({ state: "resumed" });
	});

	it("repeated pause/resume calls do nothing (no audit double-fire)", async () => {
		const audit = vi.fn();
		const r = new MarketingPauseRegistry({ auditHook: audit });
		await r.pause("a");
		await r.pause("b");
		expect(audit).toHaveBeenCalledTimes(1);
		await r.resume("a");
		await r.resume("b");
		expect(audit).toHaveBeenCalledTimes(2);
	});
});
