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

describe("Anthropic prompt caching — cacheControl on messages", () => {
	it("rewrites a user message with cacheControl into a cache_control content block", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", {
			messages: [{ role: "user", content: "long context here", cacheControl: "ephemeral" }],
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>;
		expect(body.messages).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "long context here",
						cache_control: { type: "ephemeral" },
					},
				],
			},
		]);
	});

	it("leaves uncached messages as plain strings", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", {
			messages: [
				{ role: "user", content: "static context", cacheControl: "ephemeral" },
				{ role: "assistant", content: "ack" },
				{ role: "user", content: "fresh question" },
			],
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
			messages: Array<{ role: string; content: unknown }>;
		};
		expect(body.messages[0].content).toEqual([
			{ type: "text", text: "static context", cache_control: { type: "ephemeral" } },
		]);
		expect(body.messages[1].content).toBe("ack");
		expect(body.messages[2].content).toBe("fresh question");
	});

	it("rewrites a cached system message into a system content-block array", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", {
			messages: [
				{ role: "system", content: "big system prompt", cacheControl: "ephemeral" },
				{ role: "user", content: "hi" },
			],
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>;
		expect(body.system).toEqual([
			{ type: "text", text: "big system prompt", cache_control: { type: "ephemeral" } },
		]);
	});

	it("keeps system as a string when not cached", async () => {
		const fetchMock = mockHttp({ content: [{ type: "text", text: "ok" }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		await gw.run("claude-sonnet-4-6", {
			messages: [
				{ role: "system", content: "plain system" },
				{ role: "user", content: "hi" },
			],
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>;
		expect(body.system).toBe("plain system");
	});

	it("OpenAI silently ignores cacheControl (content stays a string)", async () => {
		const fetchMock = mockHttp({ choices: [{ message: { content: "ok" } }] });
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		await gw.run("gpt-4o", {
			messages: [{ role: "user", content: "hi", cacheControl: "ephemeral" }],
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body) as {
			messages: Array<{ content: unknown; cacheControl?: string }>;
		};
		expect(body.messages[0].content).toBe("hi");
		expect(body.messages[0].cacheControl).toBeUndefined();
	});

	it("Workers AI silently ignores cacheControl", async () => {
		const run = vi.fn().mockResolvedValue({ response: "ok" });
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		await gw.run("@cf/meta/llama-3.1-8b-instruct", {
			messages: [{ role: "user", content: "hi", cacheControl: "ephemeral" }],
		});

		const input = run.mock.calls[0][1] as { messages: Array<{ content: unknown }> };
		expect(input.messages[0].content).toBe("hi");
	});
});
