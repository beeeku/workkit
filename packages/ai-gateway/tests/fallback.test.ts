import { ConfigError, ValidationError } from "@workkit/errors";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway";

function mockHttp(body: Record<string, unknown>, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	});
}

describe("runFallback() — CF Universal Endpoint", () => {
	it("POSTs to the universal endpoint (no provider suffix)", async () => {
		const fetchMock = mockHttp({
			content: [{ type: "text", text: "ok" }],
			usage: { input_tokens: 2, output_tokens: 3 },
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: {
				anthropic: { type: "anthropic", apiKey: "ak" },
				openai: { type: "openai", apiKey: "ok" },
			},
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await gw.runFallback!(
			[
				{ provider: "anthropic", model: "claude-sonnet-4-6" },
				{ provider: "openai", model: "gpt-4o" },
			],
			{ prompt: "hi" },
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.ai.cloudflare.com/v1/ACCT/GW");
	});

	it("sends the expected array body with per-provider endpoint/headers/query", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: {
				anthropic: { type: "anthropic", apiKey: "ak" },
				openai: { type: "openai", apiKey: "ok" },
			},
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await gw.runFallback!(
			[
				{ provider: "anthropic", model: "claude-sonnet-4-6" },
				{ provider: "openai", model: "gpt-4o" },
			],
			{ messages: [{ role: "user", content: "hi" }] },
		);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body) as Array<Record<string, unknown>>;
		expect(body).toHaveLength(2);

		expect(body[0].provider).toBe("anthropic");
		expect(body[0].endpoint).toBe("v1/messages");
		const h0 = body[0].headers as Record<string, string>;
		expect(h0["x-api-key"]).toBe("ak");
		expect(h0["anthropic-version"]).toBe("2023-06-01");
		const q0 = body[0].query as Record<string, unknown>;
		expect(q0.model).toBe("claude-sonnet-4-6");
		expect(q0.messages).toEqual([{ role: "user", content: "hi" }]);

		expect(body[1].provider).toBe("openai");
		expect(body[1].endpoint).toBe("chat/completions");
		const h1 = body[1].headers as Record<string, string>;
		expect(h1.authorization).toBe("Bearer ok");
		const q1 = body[1].query as Record<string, unknown>;
		expect(q1.model).toBe("gpt-4o");
	});

	it("returns AiOutput with the provider whose response shape matched", async () => {
		const fetchMock = mockHttp({
			choices: [{ message: { content: "hello from gpt" } }],
			usage: { prompt_tokens: 5, completion_tokens: 7 },
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: {
				anthropic: { type: "anthropic", apiKey: "ak" },
				openai: { type: "openai", apiKey: "ok" },
			},
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		const result = await gw.runFallback!(
			[
				{ provider: "anthropic", model: "claude-sonnet-4-6" },
				{ provider: "openai", model: "gpt-4o" },
			],
			{ prompt: "hi" },
		);

		expect(result.provider).toBe("openai");
		expect(result.model).toBe("gpt-4o");
		expect(result.text).toBe("hello from gpt");
		expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
	});

	it("identifies provider from config type, not from the provider key substring", async () => {
		// Response shape is OpenAI but the provider key doesn't contain "openai".
		const fetchMock = mockHttp({ choices: [{ message: { content: "ok" } }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: {
				claude: { type: "anthropic", apiKey: "ak" },
				gpt: { type: "openai", apiKey: "ok" },
			},
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "claude",
		});

		const result = await gw.runFallback!(
			[
				{ provider: "claude", model: "claude-sonnet-4-6" },
				{ provider: "gpt", model: "gpt-4o" },
			],
			{ prompt: "hi" },
		);

		expect(result.provider).toBe("gpt");
		expect(result.model).toBe("gpt-4o");
	});

	it("injects cf-aig-* headers", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "ak" } },
			cfGateway: {
				accountId: "ACCT",
				gatewayId: "GW",
				authToken: "tok",
				cacheTtl: 60,
			},
			defaultProvider: "anthropic",
		});

		await gw.runFallback!(
			[{ provider: "anthropic", model: "claude-sonnet-4-6" }],
			{ prompt: "hi" },
		);

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers["cf-aig-authorization"]).toBe("Bearer tok");
		expect(headers["cf-aig-cache-ttl"]).toBe("60");
	});

	it("throws ConfigError when cfGateway is not configured", async () => {
		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "ak" } },
			defaultProvider: "anthropic",
		});

		await expect(
			gw.runFallback!([{ provider: "anthropic", model: "claude-sonnet-4-6" }], { prompt: "hi" }),
		).rejects.toThrow(ConfigError);
	});

	it("throws ValidationError on empty entries", async () => {
		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "ak" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await expect(gw.runFallback!([], { prompt: "hi" })).rejects.toThrow(ValidationError);
	});

	it("throws ValidationError on unknown provider key", async () => {
		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "ak" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await expect(
			gw.runFallback!([{ provider: "missing", model: "x" }], { prompt: "hi" }),
		).rejects.toThrow(ValidationError);
	});

	it("aborts the fetch when options.timeout elapses", async () => {
		const fetchMock = vi.fn().mockImplementation(
			(_url: string, init: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					init.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "ak" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await expect(
			gw.runFallback!(
				[{ provider: "anthropic", model: "claude-sonnet-4-6" }],
				{ prompt: "hi" },
				{ timeout: 20 },
			),
		).rejects.toThrow();

		const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
		expect(signal.aborted).toBe(true);
	});

	it("rejects workers-ai / custom providers in fallback entries", async () => {
		const gw = createGateway({
			providers: {
				anthropic: { type: "anthropic", apiKey: "ak" },
				ai: { type: "workers-ai", binding: { run: vi.fn() } },
			},
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await expect(
			gw.runFallback!([{ provider: "ai", model: "@cf/x" }], { prompt: "hi" }),
		).rejects.toThrow(ValidationError);
	});
});
