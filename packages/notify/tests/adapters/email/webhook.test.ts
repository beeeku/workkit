import { describe, expect, it } from "vitest";
import { WebhookSignatureError } from "../../../src/adapters/email/errors";
import {
	isComplaint,
	isHardBounce,
	parseResendEvents,
	verifyResendSignature,
} from "../../../src/adapters/email/webhook";

describe("parseResendEvents()", () => {
	it("maps recognized event types to WebhookEvent shape", () => {
		const body = JSON.stringify([
			{ type: "email.delivered", created_at: "2026-04-18T05:00:00Z", data: { email_id: "id1" } },
			{ type: "email.bounced", created_at: "2026-04-18T05:00:01Z", data: { email_id: "id2" } },
			{ type: "email.opened", created_at: "2026-04-18T05:00:02Z", data: { email_id: "id3" } },
			{ type: "email.clicked", created_at: "2026-04-18T05:00:03Z", data: { email_id: "id4" } },
			{ type: "email.complained", created_at: "2026-04-18T05:00:04Z", data: { email_id: "id5" } },
		]);
		const events = parseResendEvents(body);
		expect(events.map((e) => e.status)).toEqual([
			"delivered",
			"bounced",
			"read",
			"read",
			"bounced",
		]);
		expect(events.every((e) => e.channel === "email")).toBe(true);
	});

	it("ignores events with no email_id", () => {
		expect(parseResendEvents(JSON.stringify([{ type: "email.delivered" }]))).toHaveLength(0);
	});

	it("returns [] on bad JSON (does not throw)", () => {
		expect(parseResendEvents("{not-json")).toEqual([]);
	});
});

describe("isComplaint() / isHardBounce()", () => {
	it("classifies complaints", () => {
		expect(isComplaint({ type: "email.complained" })).toBe(true);
		expect(isComplaint({ type: "email.bounced" })).toBe(false);
	});
	it("treats explicit hard sub-types as hard", () => {
		expect(isHardBounce({ type: "email.bounced", data: { bounce: { type: "hard" } } })).toBe(true);
		expect(isHardBounce({ type: "email.bounced", data: { bounce: { type: "permanent" } } })).toBe(
			true,
		);
		expect(isHardBounce({ type: "email.bounced", data: { bounce: { type: "transient" } } })).toBe(
			false,
		);
	});
	it("conservatively treats bounces with no sub-type as hard", () => {
		expect(isHardBounce({ type: "email.bounced" })).toBe(true);
	});
});

describe("verifyResendSignature()", () => {
	const id = "msg_001";
	const tsSec = Math.floor(Date.now() / 1000);
	const rawBody = JSON.stringify({ type: "email.delivered", data: { email_id: "id1" } });
	const SECRET = "whsec_aGVsbG93b3JsZA=="; // base64("helloworld")

	async function buildSig(): Promise<string> {
		const value = SECRET.slice("whsec_".length);
		const bin = atob(value);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		const key = await crypto.subtle.importKey(
			"raw",
			bytes,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const signed = `${id}.${tsSec}.${rawBody}`;
		const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
		return btoa(String.fromCharCode(...new Uint8Array(sig)));
	}

	function buildReq(headers: Record<string, string>): Request {
		return new Request("https://example.com/webhook", {
			method: "POST",
			headers,
			body: rawBody,
		});
	}

	it("accepts a valid space-separated signature within the replay window", async () => {
		const sig = await buildSig();
		const req = buildReq({
			"svix-id": id,
			"svix-timestamp": String(tsSec),
			"svix-signature": `v1,${sig}`,
		});
		await expect(verifyResendSignature(req, SECRET)).resolves.toMatchObject({ rawBody });
	});

	it("accepts a comma-separated multi-variant signature header", async () => {
		const sig = await buildSig();
		// Some forwarders concatenate variants with commas, e.g. `v1,<a>,v1,<b>`.
		const req = buildReq({
			"svix-id": id,
			"svix-timestamp": String(tsSec),
			"svix-signature": `v1,bogusbogusbogusbogusbogusbogusbogusbogusbogusbogus==,v1,${sig}`,
		});
		await expect(verifyResendSignature(req, SECRET)).resolves.toMatchObject({ rawBody });
	});

	it("rejects a tampered signature", async () => {
		const sig = await buildSig();
		const req = buildReq({
			"svix-id": id,
			"svix-timestamp": String(tsSec),
			"svix-signature": `v1,${sig.slice(0, -1)}A`,
		});
		await expect(verifyResendSignature(req, SECRET)).rejects.toBeInstanceOf(WebhookSignatureError);
	});

	it("rejects events outside the replay window", async () => {
		const sig = await buildSig();
		const old = String(tsSec - 10 * 60);
		const req = buildReq({
			"svix-id": id,
			"svix-timestamp": old,
			"svix-signature": `v1,${sig}`,
		});
		await expect(verifyResendSignature(req, SECRET)).rejects.toBeInstanceOf(WebhookSignatureError);
	});

	it("rejects requests missing required headers", async () => {
		await expect(verifyResendSignature(buildReq({}), SECRET)).rejects.toBeInstanceOf(
			WebhookSignatureError,
		);
	});

	it("wraps malformed-secret atob() in WebhookSignatureError", async () => {
		const sig = await buildSig();
		const req = buildReq({
			"svix-id": id,
			"svix-timestamp": String(tsSec),
			"svix-signature": `v1,${sig}`,
		});
		await expect(verifyResendSignature(req, "whsec_***not-base64***")).rejects.toBeInstanceOf(
			WebhookSignatureError,
		);
	});
});
