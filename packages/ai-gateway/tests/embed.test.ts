import { ValidationError } from "@workkit/errors";
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

describe("gateway.embed() — Workers AI", () => {
	it("wraps binding.run response into EmbedOutput", async () => {
		const run = vi.fn().mockResolvedValue({
			shape: [2, 3],
			data: [
				[0.1, 0.2, 0.3],
				[0.4, 0.5, 0.6],
			],
		});
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		const result = await gw.embed!("@cf/baai/bge-base-en-v1.5", { text: ["hi", "there"] });

		expect(run).toHaveBeenCalledWith("@cf/baai/bge-base-en-v1.5", { text: ["hi", "there"] });
		expect(result.vectors).toEqual([
			[0.1, 0.2, 0.3],
			[0.4, 0.5, 0.6],
		]);
		expect(result.provider).toBe("ai");
		expect(result.model).toBe("@cf/baai/bge-base-en-v1.5");
	});

	it("normalizes single-string input to an array", async () => {
		const run = vi.fn().mockResolvedValue({ shape: [1, 3], data: [[0.1, 0.2, 0.3]] });
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		const result = await gw.embed!("@cf/baai/bge-base-en-v1.5", { text: "hi" });

		expect(run.mock.calls[0][1]).toEqual({ text: ["hi"] });
		expect(result.vectors).toHaveLength(1);
	});
});

describe("gateway.embed() — OpenAI", () => {
	it("POSTs to /embeddings and translates the response", async () => {
		const fetchMock = mockHttp({
			data: [
				{ embedding: [0.1, 0.2], index: 0 },
				{ embedding: [0.3, 0.4], index: 1 },
			],
			usage: { prompt_tokens: 8 },
		});
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const result = await gw.embed!("text-embedding-3-small", { text: ["hi", "there"] });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/embeddings");
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body).toEqual({ model: "text-embedding-3-small", input: ["hi", "there"] });
		expect(result.vectors).toEqual([
			[0.1, 0.2],
			[0.3, 0.4],
		]);
		expect(result.usage).toEqual({ inputTokens: 8 });
	});

	it("routes through CF AI Gateway when cfGateway is set", async () => {
		const fetchMock = mockHttp({ data: [{ embedding: [0.1], index: 0 }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "openai",
		});

		await gw.embed!("text-embedding-3-small", { text: "hi" });

		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://gateway.ai.cloudflare.com/v1/ACCT/GW/openai/embeddings",
		);
	});
});

describe("gateway.embed() — Anthropic + custom", () => {
	it("throws ValidationError for Anthropic (no embeddings endpoint)", async () => {
		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		await expect(gw.embed!("x", { text: "hi" })).rejects.toThrow(ValidationError);
	});

	it("delegates to custom provider embed() when present", async () => {
		const embed = vi
			.fn()
			.mockResolvedValue({
				vectors: [[0.5]],
				raw: {},
				provider: "custom",
				model: "x",
			});
		const gw = createGateway({
			providers: {
				custom: {
					type: "custom",
					run: vi.fn(),
					embed,
				},
			},
			defaultProvider: "custom",
		});

		const result = await gw.embed!("x", { text: "hi" });

		expect(embed).toHaveBeenCalledWith("x", { text: "hi" });
		expect(result.vectors).toEqual([[0.5]]);
	});

	it("throws ValidationError for custom provider without embed()", async () => {
		const gw = createGateway({
			providers: {
				custom: { type: "custom", run: vi.fn() },
			},
			defaultProvider: "custom",
		});

		await expect(gw.embed!("x", { text: "hi" })).rejects.toThrow(ValidationError);
	});
});
