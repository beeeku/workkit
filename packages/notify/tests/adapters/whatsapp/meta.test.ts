import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateNotApprovedError } from "../../../src/adapters/whatsapp/errors";
import { metaWaProvider } from "../../../src/adapters/whatsapp/providers/meta";

const ORIGINAL_FETCH = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

describe("metaWaProvider().send()", () => {
	it("posts a template body to Meta and returns the message id", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });
		const r = await p.send({
			toE164: "+919999999999",
			template: { name: "pre_market_brief_v2", language: "en", variables: ["NIFTY", "+1.2%"] },
		});
		expect(r.providerId).toBe("wamid.X");
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toContain("/PNID/messages");
		const body = JSON.parse((init as RequestInit).body as string);
		expect(body.to).toBe("+919999999999");
		expect(body.template.name).toBe("pre_market_brief_v2");
		expect(body.template.language.code).toBe("en");
		expect(body.template.components[0].parameters).toHaveLength(2);
	});

	it("posts a session text message when no template is supplied", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ messages: [{ id: "wamid.Y" }] }), { status: 200 }),
		);
		const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });
		await p.send({ toE164: "+91999", sessionText: "hello" });
		const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
		const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
		expect(body.type).toBe("text");
		expect(body.text.body).toBe("hello");
	});

	it("throws TemplateNotApprovedError on Meta error code 132000", async () => {
		(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "template not approved", code: 132000 } }), {
				status: 400,
			}),
		);
		const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });
		await expect(
			p.send({ toE164: "+91999", template: { name: "x", language: "en" } }),
		).rejects.toBeInstanceOf(TemplateNotApprovedError);
	});
});

describe("metaWaProvider().handleVerificationChallenge()", () => {
	const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });

	it("returns 200 with the challenge when verify_token matches", async () => {
		const req = new Request(
			"https://example.com/wh?hub.mode=subscribe&hub.challenge=42&hub.verify_token=secret",
		);
		const res = p.handleVerificationChallenge(req, "secret");
		expect(res?.status).toBe(200);
		expect(await res?.text()).toBe("42");
	});

	it("returns 403 when verify_token does not match", async () => {
		const req = new Request(
			"https://example.com/wh?hub.mode=subscribe&hub.challenge=42&hub.verify_token=wrong",
		);
		const res = p.handleVerificationChallenge(req, "secret");
		expect(res?.status).toBe(403);
	});

	it("returns null when not a GET subscribe handshake", async () => {
		const req = new Request("https://example.com/wh", { method: "POST" });
		expect(p.handleVerificationChallenge(req, "secret")).toBeNull();
	});
});

describe("metaWaProvider().verifySignature()", () => {
	const SECRET = "app_secret";
	const body = JSON.stringify({ entry: [] });

	async function buildSig(secret: string, raw: string): Promise<string> {
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
		return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	it("accepts a valid sha256= header", async () => {
		const expected = await buildSig(SECRET, body);
		const req = new Request("https://example.com/wh", {
			method: "POST",
			headers: { "x-hub-signature-256": `sha256=${expected}` },
			body,
		});
		const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });
		expect(await p.verifySignature(req, SECRET)).toBe(true);
	});

	it("rejects a missing header", async () => {
		const req = new Request("https://example.com/wh", { method: "POST", body });
		const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });
		expect(await p.verifySignature(req, SECRET)).toBe(false);
	});

	it("rejects a tampered signature", async () => {
		const expected = await buildSig(SECRET, body);
		// Flip the first hex char to a non-equal value. `slice(0,-1) + "0"` is
		// a no-op when the original sig already ends in "0".
		const flipped = (expected[0] === "0" ? "1" : "0") + expected.slice(1);
		const req = new Request("https://example.com/wh", {
			method: "POST",
			headers: { "x-hub-signature-256": `sha256=${flipped}` },
			body,
		});
		const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });
		expect(await p.verifySignature(req, SECRET)).toBe(false);
	});
});

describe("metaWaProvider().parseWebhook()", () => {
	const p = metaWaProvider({ accessToken: "tok", phoneNumberId: "PNID" });

	it("maps delivery statuses to delivery events", async () => {
		const body = JSON.stringify({
			entry: [
				{
					changes: [
						{
							field: "messages",
							value: {
								statuses: [
									{ id: "wamid.A", status: "delivered", timestamp: "1700000000" },
									{ id: "wamid.B", status: "read", timestamp: "1700000001" },
									{ id: "wamid.C", status: "failed", timestamp: "1700000002" },
								],
							},
						},
					],
				},
			],
		});
		const req = new Request("https://example.com/wh", { method: "POST", body });
		const events = await p.parseWebhook(req);
		expect(events).toHaveLength(3);
		const statuses = events.flatMap((e) => (e.kind === "delivery" ? [e.event.status] : []));
		expect(statuses).toEqual(["delivered", "read", "failed"]);
	});

	it("emits inbound events for incoming messages", async () => {
		const body = JSON.stringify({
			entry: [
				{
					changes: [
						{
							field: "messages",
							value: {
								messages: [
									{ from: "+919999999999", text: { body: "stop" }, timestamp: "1700000000" },
								],
							},
						},
					],
				},
			],
		});
		const req = new Request("https://example.com/wh", { method: "POST", body });
		const events = await p.parseWebhook(req);
		const inbound = events.find((e) => e.kind === "inbound");
		expect(inbound?.kind).toBe("inbound");
		if (inbound?.kind === "inbound") {
			expect(inbound.message.from).toBe("+919999999999");
			expect(inbound.message.text).toBe("stop");
		}
	});

	it("emits quality alerts for account_update events", async () => {
		const body = JSON.stringify({
			entry: [
				{
					changes: [
						{
							field: "account_update",
							value: { quality_score: { score: "low" } },
						},
					],
				},
			],
		});
		const req = new Request("https://example.com/wh", { method: "POST", body });
		const events = await p.parseWebhook(req);
		expect(events[0]?.kind).toBe("quality");
		if (events[0]?.kind === "quality") {
			expect(events[0].alert.level).toBe("low");
		}
	});

	it("returns [] on bad JSON", async () => {
		const req = new Request("https://example.com/wh", { method: "POST", body: "{not-json" });
		expect(await p.parseWebhook(req)).toEqual([]);
	});
});
