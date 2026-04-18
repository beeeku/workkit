import { ConfigError, ServiceUnavailableError, ValidationError } from "@workkit/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway";
import type { AiInput, AiOutput, CustomProviderConfig, Gateway } from "../src/types";

// --- Mock helpers ---

function createMockWorkersAi(response: unknown = { response: "Hello from Workers AI" }) {
	return {
		run: vi.fn().mockResolvedValue(response),
	};
}

function createMockCustomProvider(result?: Partial<AiOutput>) {
	const defaultResult: AiOutput = {
		text: "Custom response",
		raw: { text: "Custom response" },
		provider: "custom",
		model: "test-model",
		...result,
	};
	return vi.fn().mockResolvedValue(defaultResult);
}

describe("createGateway()", () => {
	it("throws ConfigError with no providers", () => {
		expect(() => createGateway({ providers: {}, defaultProvider: "none" })).toThrow(ConfigError);
	});

	it("throws ConfigError without default provider", () => {
		expect(() =>
			createGateway({
				providers: { ai: { type: "workers-ai", binding: createMockWorkersAi() } },
				defaultProvider: "",
			}),
		).toThrow(ConfigError);
	});

	it("throws ConfigError when default provider not in providers map", () => {
		expect(() =>
			createGateway({
				providers: { ai: { type: "workers-ai", binding: createMockWorkersAi() } },
				defaultProvider: "nonexistent",
			}),
		).toThrow(ConfigError);
	});

	it("creates gateway with valid config", () => {
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: createMockWorkersAi() } },
			defaultProvider: "ai",
		});
		expect(gw).toBeDefined();
		expect(typeof gw.run).toBe("function");
		expect(typeof gw.providers).toBe("function");
		expect(typeof gw.defaultProvider).toBe("function");
	});
});

describe("providers()", () => {
	it("returns list of provider names", () => {
		const gw = createGateway({
			providers: {
				ai: { type: "workers-ai", binding: createMockWorkersAi() },
				openai: { type: "openai", apiKey: "test-key" },
			},
			defaultProvider: "ai",
		});
		expect(gw.providers()).toEqual(["ai", "openai"]);
	});
});

describe("defaultProvider()", () => {
	it("returns default provider name", () => {
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: createMockWorkersAi() } },
			defaultProvider: "ai",
		});
		expect(gw.defaultProvider()).toBe("ai");
	});
});

describe("run() — Workers AI", () => {
	let gw: Gateway;
	let mockAi: ReturnType<typeof createMockWorkersAi>;

	beforeEach(() => {
		mockAi = createMockWorkersAi();
		gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: mockAi } },
			defaultProvider: "ai",
		});
	});

	it("throws ValidationError for empty model name", async () => {
		await expect(gw.run("", { prompt: "test" })).rejects.toThrow(ValidationError);
	});

	it("calls Workers AI binding with model and input", async () => {
		const input: AiInput = { prompt: "Hello" };
		await gw.run("@cf/meta/llama-3.1-8b-instruct", input);
		expect(mockAi.run).toHaveBeenCalledWith("@cf/meta/llama-3.1-8b-instruct", input);
	});

	it("returns AiOutput with provider and model", async () => {
		const result = await gw.run("@cf/meta/llama", { prompt: "Hi" });
		expect(result.provider).toBe("ai");
		expect(result.model).toBe("@cf/meta/llama");
		expect(result.text).toBe("Hello from Workers AI");
		expect(result.raw).toEqual({ response: "Hello from Workers AI" });
	});

	it("extracts text from response field", async () => {
		mockAi.run.mockResolvedValueOnce({ response: "extracted text" });
		const result = await gw.run("model", { prompt: "Hi" });
		expect(result.text).toBe("extracted text");
	});

	it("extracts text from text field", async () => {
		mockAi.run.mockResolvedValueOnce({ text: "text field" });
		const result = await gw.run("model", { prompt: "Hi" });
		expect(result.text).toBe("text field");
	});

	it("handles string response", async () => {
		mockAi.run.mockResolvedValueOnce("plain string response");
		const result = await gw.run("model", { prompt: "Hi" });
		expect(result.text).toBe("plain string response");
	});

	it("wraps binding errors in ServiceUnavailableError", async () => {
		mockAi.run.mockRejectedValueOnce(new Error("binding failed"));
		await expect(gw.run("model", { prompt: "Hi" })).rejects.toThrow(ServiceUnavailableError);
	});

	it("uses default provider when no provider specified", async () => {
		await gw.run("model", { prompt: "Hi" });
		expect(mockAi.run).toHaveBeenCalled();
	});
});

describe("run() — Custom provider", () => {
	it("calls custom run function", async () => {
		const customRun = createMockCustomProvider();
		const gw = createGateway({
			providers: {
				custom: { type: "custom", run: customRun } as CustomProviderConfig,
			},
			defaultProvider: "custom",
		});

		const input: AiInput = { prompt: "Hello" };
		await gw.run("test-model", input);
		expect(customRun).toHaveBeenCalledWith("test-model", input);
	});

	it("returns result from custom provider", async () => {
		const customRun = createMockCustomProvider({ text: "Custom!" });
		const gw = createGateway({
			providers: {
				custom: { type: "custom", run: customRun } as CustomProviderConfig,
			},
			defaultProvider: "custom",
		});

		const result = await gw.run("model", { prompt: "test" });
		expect(result.text).toBe("Custom!");
	});

	it("wraps custom provider errors in ServiceUnavailableError", async () => {
		const customRun = vi.fn().mockRejectedValue(new Error("custom failed"));
		const gw = createGateway({
			providers: {
				custom: { type: "custom", run: customRun } as CustomProviderConfig,
			},
			defaultProvider: "custom",
		});

		await expect(gw.run("model", { prompt: "test" })).rejects.toThrow(ServiceUnavailableError);
	});
});

describe("run() — provider override", () => {
	it("uses specified provider instead of default", async () => {
		const mockAi = createMockWorkersAi();
		const customRun = createMockCustomProvider();
		const gw = createGateway({
			providers: {
				ai: { type: "workers-ai", binding: mockAi },
				custom: { type: "custom", run: customRun } as CustomProviderConfig,
			},
			defaultProvider: "ai",
		});

		await gw.run("model", { prompt: "test" }, { provider: "custom" });
		expect(customRun).toHaveBeenCalled();
		expect(mockAi.run).not.toHaveBeenCalled();
	});

	it("throws ConfigError for unknown provider override", async () => {
		const gw = createGateway({
			providers: {
				ai: { type: "workers-ai", binding: createMockWorkersAi() },
			},
			defaultProvider: "ai",
		});

		await expect(gw.run("model", { prompt: "test" }, { provider: "nonexistent" })).rejects.toThrow(
			ConfigError,
		);
	});
});

describe("run() — input formats", () => {
	let gw: Gateway;
	let mockAi: ReturnType<typeof createMockWorkersAi>;

	beforeEach(() => {
		mockAi = createMockWorkersAi();
		gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: mockAi } },
			defaultProvider: "ai",
		});
	});

	it("passes messages input directly", async () => {
		const input: AiInput = {
			messages: [
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "Hello" },
			],
		};
		await gw.run("model", input);
		expect(mockAi.run).toHaveBeenCalledWith("model", input);
	});

	it("passes prompt input directly", async () => {
		const input: AiInput = { prompt: "Hello world" };
		await gw.run("model", input);
		expect(mockAi.run).toHaveBeenCalledWith("model", input);
	});

	it("passes arbitrary input directly", async () => {
		const input: AiInput = { custom_field: "value" } as any;
		await gw.run("model", input);
		expect(mockAi.run).toHaveBeenCalledWith("model", input);
	});
});

describe("run() — multiple providers", () => {
	it("routes to correct provider", async () => {
		const mockAi = createMockWorkersAi();
		const customRun1 = createMockCustomProvider({ text: "Provider A" });
		const customRun2 = createMockCustomProvider({ text: "Provider B" });

		const gw = createGateway({
			providers: {
				ai: { type: "workers-ai", binding: mockAi },
				providerA: { type: "custom", run: customRun1 } as CustomProviderConfig,
				providerB: { type: "custom", run: customRun2 } as CustomProviderConfig,
			},
			defaultProvider: "ai",
		});

		const resultA = await gw.run("model", { prompt: "test" }, { provider: "providerA" });
		expect(resultA.text).toBe("Provider A");

		const resultB = await gw.run("model", { prompt: "test" }, { provider: "providerB" });
		expect(resultB.text).toBe("Provider B");
	});
});

// ─── CF AI Gateway routing ──────────────────────────────────

function mockHttp(body: Record<string, unknown>, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	});
}

describe("cfGateway — URL routing", () => {
	it("routes Anthropic through CF AI Gateway URL", async () => {
		const fetchMock = mockHttp({
			content: [{ type: "text", text: "ok" }],
			usage: { input_tokens: 1, output_tokens: 1 },
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", { prompt: "hi" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://gateway.ai.cloudflare.com/v1/ACCT/GW/anthropic/v1/messages",
		);
	});

	it("routes OpenAI through CF AI Gateway URL", async () => {
		const fetchMock = mockHttp({ choices: [{ message: { content: "ok" } }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "openai",
		});

		await gw.run("gpt-4o", { prompt: "hi" });

		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://gateway.ai.cloudflare.com/v1/ACCT/GW/openai/chat/completions",
		);
	});

	it("provider baseUrl overrides cfGateway", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: {
				anthropic: {
					type: "anthropic",
					apiKey: "k",
					baseUrl: "https://custom.example.com/v1",
				},
			},
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", { prompt: "hi" });

		expect(fetchMock.mock.calls[0][0]).toBe("https://custom.example.com/v1/messages");
	});

	it("falls back to provider default URL when cfGateway not set", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", { prompt: "hi" });

		expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
	});

	it("leaves Workers AI binding untouched by cfGateway", async () => {
		const mockAi = createMockWorkersAi();
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: mockAi } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "ai",
		});

		await gw.run("@cf/meta/llama-3.1-8b-instruct", { prompt: "hi" });

		expect(mockAi.run).toHaveBeenCalledTimes(1);
	});
});

describe("cfGateway — header injection", () => {
	it("injects cf-aig-authorization, cache-ttl, skip-cache when set", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			cfGateway: {
				accountId: "ACCT",
				gatewayId: "GW",
				authToken: "secret-token",
				cacheTtl: 3600,
				skipCache: true,
			},
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", { prompt: "hi" });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers["cf-aig-authorization"]).toBe("Bearer secret-token");
		expect(headers["cf-aig-cache-ttl"]).toBe("3600");
		expect(headers["cf-aig-skip-cache"]).toBe("true");
	});

	it("omits cf-aig-* headers when cfGateway not set", async () => {
		const fetchMock = mockHttp({ choices: [{ message: { content: "ok" } }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		await gw.run("gpt-4o", { prompt: "hi" });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers["cf-aig-authorization"]).toBeUndefined();
		expect(headers["cf-aig-cache-ttl"]).toBeUndefined();
		expect(headers["cf-aig-skip-cache"]).toBeUndefined();
	});

	it("omits optional cf-aig-* headers when not individually set", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", { prompt: "hi" });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers["cf-aig-authorization"]).toBeUndefined();
		expect(headers["cf-aig-cache-ttl"]).toBeUndefined();
		expect(headers["cf-aig-skip-cache"]).toBeUndefined();
	});
});
