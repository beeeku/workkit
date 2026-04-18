import { describe, expect, it, vi } from "vitest";
import {
	type WhatsAppPayload,
	type WhatsAppTemplateRef,
	whatsappAdapter,
} from "../../../src/adapters/whatsapp/adapter";
import { MarketingPauseRegistry } from "../../../src/adapters/whatsapp/marketing-pause";
import { recordOptIn } from "../../../src/adapters/whatsapp/opt-in";
import type {
	WaProvider,
	WaProviderEvent,
	WaSendResult,
} from "../../../src/adapters/whatsapp/provider";
// (no error imports needed; we assert on string fragments)
import { gupshupWaProvider } from "../../../src/adapters/whatsapp/providers/gupshup";
import { twilioWaProvider } from "../../../src/adapters/whatsapp/providers/twilio";
import { recordInbound } from "../../../src/adapters/whatsapp/session-window";
import type { AdapterSendArgs, ChannelTemplate } from "../../../src/types";
import { createWaDb } from "./_d1";

function fakeProvider(opts: { send?: WaSendResult; throwOnSend?: Error } = {}): WaProvider & {
	calls: { send: number; uploadMedia: number };
} {
	const calls = { send: 0, uploadMedia: 0 };
	const provider: WaProvider & { calls: typeof calls } = {
		name: "meta" as const,
		calls,
		async send(): Promise<WaSendResult> {
			calls.send += 1;
			if (opts.throwOnSend) throw opts.throwOnSend;
			return opts.send ?? { providerId: "wamid.fake" };
		},
		async uploadMedia() {
			calls.uploadMedia += 1;
			return { mediaId: "mid_fake", mimeType: "image/png" };
		},
		async parseWebhook(): Promise<WaProviderEvent[]> {
			return [];
		},
		async verifySignature() {
			return true;
		},
		handleVerificationChallenge() {
			return null;
		},
	};
	return provider;
}

function args(
	template: ChannelTemplate<WhatsAppPayload>,
	address = "+919999999999",
): AdapterSendArgs<WhatsAppPayload> {
	return {
		userId: "u1",
		notificationId: "pre-market-brief",
		channel: "whatsapp",
		address,
		template,
		payload: {},
		deliveryId: "d1",
		mode: "live",
	};
}

const transactionalTpl: WhatsAppTemplateRef = {
	name: "pre_market_brief_v2",
	language: "en",
	category: "transactional",
};
const marketingTpl: WhatsAppTemplateRef = { ...transactionalTpl, category: "marketing" };

describe("whatsappAdapter() — opt-in + phone validation", () => {
	it("rejects malformed phone numbers", async () => {
		const db = createWaDb();
		const adapter = whatsappAdapter({ provider: fakeProvider(), db });
		const r = await adapter.send(args({ template: transactionalTpl }, "919999999999"));
		expect(r.status).toBe("failed");
		expect(r.error).toContain("not E.164");
	});

	it("rejects sends when opt-in is missing", async () => {
		const db = createWaDb();
		const adapter = whatsappAdapter({ provider: fakeProvider(), db });
		const r = await adapter.send(args({ template: transactionalTpl }));
		expect(r.status).toBe("failed");
		expect(r.error).toContain("opt-in proof required");
	});

	it("sends successfully when opted in", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const provider = fakeProvider();
		const adapter = whatsappAdapter({ provider, db });
		const r = await adapter.send(args({ template: transactionalTpl }));
		expect(r.status).toBe("sent");
		expect(r.providerId).toBe("wamid.fake");
		expect(provider.calls.send).toBe(1);
	});
});

describe("whatsappAdapter() — 24h session window", () => {
	it("refuses to send a session message outside the window without a template", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const adapter = whatsappAdapter({ provider: fakeProvider(), db });
		const r = await adapter.send(
			args({
				/* no template */
			}),
		);
		expect(r.status).toBe("failed");
		expect(r.error).toContain("24h");
	});

	it("permits a session message inside the window without a template", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		await recordInbound({ db }, { userId: "u1", at: Date.now() });
		const provider = fakeProvider();
		const adapter = whatsappAdapter({ provider, db });
		const r = await adapter.send(args({}));
		// Inside window + no template → adapter calls provider.send (which our
		// fake accepts) → sent. The "outside-24h" early-return must NOT fire.
		expect(r.status).toBe("sent");
		expect(provider.calls.send).toBe(1);
	});
});

describe("whatsappAdapter() — DND + marketing pause", () => {
	it("invokes dndCheck only for marketing templates and skips on true", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const dnd = vi.fn().mockResolvedValue(true);
		const adapter = whatsappAdapter({ provider: fakeProvider(), db, dndCheck: dnd });
		const r = await adapter.send(args({ template: marketingTpl }));
		expect(dnd).toHaveBeenCalledWith("+919999999999");
		expect(r.status).toBe("failed");
		expect(r.error).toContain("dnd-india");
	});

	it("does NOT invoke dndCheck for transactional templates", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const dnd = vi.fn().mockResolvedValue(true);
		const adapter = whatsappAdapter({ provider: fakeProvider(), db, dndCheck: dnd });
		await adapter.send(args({ template: transactionalTpl }));
		expect(dnd).not.toHaveBeenCalled();
	});

	it("refuses marketing sends when the pause registry is paused", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const pauseRegistry = new MarketingPauseRegistry();
		await pauseRegistry.pause("test");
		const adapter = whatsappAdapter({ provider: fakeProvider(), db, pauseRegistry });
		const r = await adapter.send(args({ template: marketingTpl }));
		expect(r.status).toBe("failed");
		expect(r.error).toContain("marketing");
	});

	it("transactional sends are NOT blocked by the pause registry", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const pauseRegistry = new MarketingPauseRegistry();
		await pauseRegistry.pause("test");
		const adapter = whatsappAdapter({ provider: fakeProvider(), db, pauseRegistry });
		const r = await adapter.send(args({ template: transactionalTpl }));
		expect(r.status).toBe("sent");
	});
});

describe("whatsappAdapter() — inbound STOP handling", () => {
	it("revokes opt-in + invokes optOutHook when an inbound STOP arrives", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const optOutHook = vi.fn().mockResolvedValue(undefined);
		const provider = fakeProvider();
		// Override parseWebhook to inject an inbound STOP.
		provider.parseWebhook = async () => [
			{
				kind: "inbound" as const,
				message: { from: "+919999999999", text: "STOP", at: Date.now() },
			},
		];
		const adapter = whatsappAdapter({
			provider,
			db,
			optOutHook,
			userIdFromPhone: async () => "u1",
		});
		await adapter.parseWebhook!(new Request("https://example.com/wh", { method: "POST" }));
		expect(optOutHook).toHaveBeenCalledWith("u1", "whatsapp", null, "inbound-stop");
	});

	it("does NOT revoke on a non-stop inbound message", async () => {
		const db = createWaDb();
		await recordOptIn({ db }, { userId: "u1", phoneE164: "+919999999999", method: "x" });
		const optOutHook = vi.fn().mockResolvedValue(undefined);
		const provider = fakeProvider();
		provider.parseWebhook = async () => [
			{
				kind: "inbound" as const,
				message: { from: "+919999999999", text: "thanks!", at: Date.now() },
			},
		];
		const adapter = whatsappAdapter({
			provider,
			db,
			optOutHook,
			userIdFromPhone: async () => "u1",
		});
		await adapter.parseWebhook!(new Request("https://example.com/wh", { method: "POST" }));
		expect(optOutHook).not.toHaveBeenCalled();
	});
});

describe("whatsappAdapter() — quality-rating pause", () => {
	it("flips the marketing-pause flag on a 'low' quality alert", async () => {
		const db = createWaDb();
		const pauseRegistry = new MarketingPauseRegistry();
		const provider = fakeProvider();
		provider.parseWebhook = async () => [
			{ kind: "quality" as const, alert: { level: "low" as const, at: Date.now() } },
		];
		const adapter = whatsappAdapter({ provider, db, pauseRegistry });
		await adapter.parseWebhook!(new Request("https://example.com/wh", { method: "POST" }));
		expect(pauseRegistry.isPaused()).toBe(true);
	});

	it("ignores 'high' quality alerts", async () => {
		const db = createWaDb();
		const pauseRegistry = new MarketingPauseRegistry();
		const provider = fakeProvider();
		provider.parseWebhook = async () => [
			{ kind: "quality" as const, alert: { level: "high" as const, at: Date.now() } },
		];
		const adapter = whatsappAdapter({ provider, db, pauseRegistry });
		await adapter.parseWebhook!(new Request("https://example.com/wh", { method: "POST" }));
		expect(pauseRegistry.isPaused()).toBe(false);
	});
});

describe("provider stubs", () => {
	it("twilioWaProvider throws on every call", async () => {
		const p = twilioWaProvider({ accountSid: "x", authToken: "y", fromNumber: "+1" });
		await expect(p.send({ toE164: "+1", sessionText: "x" })).rejects.toThrow(/not implemented/i);
		await expect(p.uploadMedia({ bytes: new Uint8Array(0), mimeType: "x/y" })).rejects.toThrow();
	});

	it("gupshupWaProvider throws on every call", async () => {
		const p = gupshupWaProvider({ apiKey: "x", appName: "y" });
		await expect(p.send({ toE164: "+1", sessionText: "x" })).rejects.toThrow(/not implemented/i);
	});
});
