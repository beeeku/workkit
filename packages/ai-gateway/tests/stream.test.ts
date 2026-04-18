import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../src/gateway";
import type { GatewayStreamEvent } from "../src/types";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
	const enc = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const c of chunks) controller.enqueue(enc.encode(c));
			controller.close();
		},
	});
}

function mockHttpStream(chunks: string[]): typeof fetch {
	return vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		body: sseStream(chunks),
	}) as unknown as typeof fetch;
}

async function collect(
	stream: ReadableStream<GatewayStreamEvent>,
): Promise<GatewayStreamEvent[]> {
	const events: GatewayStreamEvent[] = [];
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		events.push(value);
	}
	return events;
}

describe("gateway.stream() — Workers AI", () => {
	it("streams SSE response-field deltas and emits done at end", async () => {
		const bindingStream = sseStream([
			'data: {"response":"Hel"}\n\n',
			'data: {"response":"lo"}\n\n',
			"data: [DONE]\n\n",
		]);
		const run = vi.fn().mockResolvedValue(bindingStream);

		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		const events = await collect(await gw.stream!("@cf/m", { prompt: "hi" }));

		const texts = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta);
		expect(texts.join("")).toBe("Hello");

		const done = events.find((e) => e.type === "done");
		expect(done).toBeDefined();
		expect(events[events.length - 1]).toBe(done);
	});

	it("sets stream: true on the binding input", async () => {
		const run = vi.fn().mockResolvedValue(sseStream(["data: [DONE]\n\n"]));
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		await collect(await gw.stream!("@cf/m", { prompt: "hi" }));

		expect(run).toHaveBeenCalledTimes(1);
		expect(run.mock.calls[0][1]).toMatchObject({ prompt: "hi", stream: true });
	});
});

describe("gateway.stream() — Anthropic", () => {
	it("streams content_block_delta text and emits done with usage", async () => {
		const fetchMock = mockHttpStream([
			'event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}\n\n',
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		const events = await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));
		const texts = events
			.filter((e) => e.type === "text")
			.map((e) => (e as { delta: string }).delta);
		expect(texts.join("")).toBe("Hello world");

		const done = events[events.length - 1] as { type: "done"; usage?: { outputTokens: number } };
		expect(done.type).toBe("done");
		expect(done.usage?.outputTokens).toBe(4);
	});

	it("sets stream: true and anthropic-version on the request", async () => {
		const fetchMock = mockHttpStream([
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));

		const init = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as {
			headers: Record<string, string>;
			body: string;
		};
		expect(init.headers["anthropic-version"]).toBe("2023-06-01");
		expect(JSON.parse(init.body)).toMatchObject({ stream: true });
	});
});

describe("gateway.stream() — OpenAI", () => {
	it("streams choices[].delta.content and emits done", async () => {
		const fetchMock = mockHttpStream([
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
			'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
			"data: [DONE]\n\n",
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const events = await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));
		const texts = events
			.filter((e) => e.type === "text")
			.map((e) => (e as { delta: string }).delta);
		expect(texts.join("")).toBe("Hello");

		const done = events[events.length - 1] as {
			type: "done";
			usage?: { inputTokens: number; outputTokens: number };
		};
		expect(done.type).toBe("done");
		expect(done.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
	});

	it("sets stream: true on the body", async () => {
		const fetchMock = mockHttpStream(["data: [DONE]\n\n"]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));

		const init = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as {
			body: string;
		};
		expect(JSON.parse(init.body)).toMatchObject({ stream: true });
	});
});

describe("gateway.stream() — plumbing", () => {
	it("always emits exactly one done event as the last event", async () => {
		const fetchMock = mockHttpStream([
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		const events = await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));
		const doneCount = events.filter((e) => e.type === "done").length;
		expect(doneCount).toBe(1);
		expect(events[events.length - 1].type).toBe("done");
	});

	it("routes openai through CF AI Gateway when cfGateway is configured", async () => {
		const fetchMock = mockHttpStream(["data: [DONE]\n\n"]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			cfGateway: { accountId: "ACCT", gatewayId: "GW" },
			defaultProvider: "openai",
		});

		await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));

		const url = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
		expect(url).toBe("https://gateway.ai.cloudflare.com/v1/ACCT/GW/openai/chat/completions");
	});
});
