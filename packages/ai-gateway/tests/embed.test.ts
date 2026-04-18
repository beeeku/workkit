import { ServiceUnavailableError, ValidationError } from "@workkit/errors";
import { describe, expect, it, vi } from "vitest";
import { withCache } from "../src/cache";
import { createGateway } from "../src/gateway";
import { withRetry } from "../src/retry";
import type { CacheStorage } from "../src/types";

function createMockStorage(): CacheStorage & { _store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		_store: store,
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	};
}

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

describe("gateway.embed() — withCache", () => {
	it("caches embedding responses by (model, input) with a dedicated namespace", async () => {
		const run = vi.fn().mockResolvedValue({ shape: [1, 3], data: [[0.1, 0.2, 0.3]] });
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});
		const storage = createMockStorage();
		const cached = withCache(gw, { storage, ttl: 60 });

		const first = await cached.embed!("@cf/baai/bge-base-en-v1.5", { text: "hi" });
		const second = await cached.embed!("@cf/baai/bge-base-en-v1.5", { text: "hi" });

		expect(run).toHaveBeenCalledTimes(1); // 2nd call hit cache
		expect(second.vectors).toEqual(first.vectors);
		// Embedding cache uses its own key namespace (prevents collision with run/).
		const keys = [...storage._store.keys()];
		expect(keys.every((k) => k.startsWith("ai-embed-cache:"))).toBe(true);
	});
});

describe("gateway.embed() — withRetry", () => {
	it("retries retryable embed errors and succeeds", async () => {
		let calls = 0;
		const gw = createGateway({
			providers: {
				ai: {
					type: "workers-ai",
					binding: {
						run: vi.fn(async () => {
							calls++;
							if (calls === 1) throw new ServiceUnavailableError("boom");
							return { shape: [1, 1], data: [[0.9]] };
						}),
					},
				},
			},
			defaultProvider: "ai",
		});

		const result = await withRetry(gw, { maxAttempts: 2 }).embed!("m", { text: "hi" });

		expect(calls).toBe(2);
		expect(result.vectors).toEqual([[0.9]]);
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
		const embed = vi.fn().mockResolvedValue({
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
