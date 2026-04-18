import { describe, expect, it } from "vitest";
import { WebhookSignatureError } from "../src/errors";
import {
	isComplaint,
	isHardBounce,
	parseResendEvents,
	verifyResendSignature,
} from "../src/webhook";

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
		const body = JSON.stringify([{ type: "email.delivered" }]);
		expect(parseResendEvents(body)).toHaveLength(0);
	});

	it("returns [] on bad JSON", () => {
		expect(parseResendEvents("{not-json")).toEqual([]);
	});
});

describe("isComplaint() / isHardBounce()", () => {
	it("recognises complaints", () => {
		expect(isComplaint({ type: "email.complained" })).toBe(true);
		expect(isComplaint({ type: "email.bounced" })).toBe(false);
	});

	it("treats explicit hard bounces as hard", () => {
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

	it("does not flag non-bounce events", () => {
		expect(isHardBounce({ type: "email.delivered" })).toBe(false);
	});
});

describe("verifyResendSignature()", () => {
	const id = "msg_001";
	const tsSec = Math.floor(Date.now() / 1000);
	const rawBody = JSON.stringify({ type: "email.delivered", data: { email_id: "id1" } });

	async function buildSignature(secretBase64WithPrefix: string): Promise<string> {
		const value = secretBase64WithPrefix.startsWith("whsec_")
			? secretBase64WithPrefix.slice("whsec_".length)
			: secretBase64WithPrefix;
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

	function buildRequest(headers: Record<string, string>): Request {
		return new Request("https://example.com/webhook", {
			method: "POST",
			headers,
			body: rawBody,
		});
	}

	const SECRET = "whsec_aGVsbG93b3JsZA=="; // base64("helloworld") with whsec_ prefix

	it("accepts a valid signature within the replay window", async () => {
		const sig = await buildSignature(SECRET);
		const req = buildRequest({
			"svix-id": id,
			"svix-timestamp": String(tsSec),
			"svix-signature": `v1,${sig}`,
			"content-type": "application/json",
		});
		await expect(verifyResendSignature(req, SECRET)).resolves.toMatchObject({
			rawBody,
		});
	});

	it("rejects a tampered signature", async () => {
		const sig = await buildSignature(SECRET);
		const req = buildRequest({
			"svix-id": id,
			"svix-timestamp": String(tsSec),
			"svix-signature": `v1,${sig.slice(0, -1)}A`,
		});
		await expect(verifyResendSignature(req, SECRET)).rejects.toBeInstanceOf(WebhookSignatureError);
	});

	it("rejects events outside the replay window", async () => {
		const sig = await buildSignature(SECRET);
		const old = String(tsSec - 10 * 60); // 10 minutes ago
		const req = buildRequest({
			"svix-id": id,
			"svix-timestamp": old,
			"svix-signature": `v1,${sig}`,
		});
		await expect(verifyResendSignature(req, SECRET)).rejects.toBeInstanceOf(WebhookSignatureError);
	});

	it("rejects requests missing required headers", async () => {
		const req = buildRequest({});
		await expect(verifyResendSignature(req, SECRET)).rejects.toBeInstanceOf(WebhookSignatureError);
	});
});
