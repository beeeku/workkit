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

async function collect(stream: ReadableStream<GatewayStreamEvent>): Promise<GatewayStreamEvent[]> {
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

		const texts = events
			.filter((e) => e.type === "text")
			.map((e) => (e as { delta: string }).delta);
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

	it("injects toolOptions into the binding payload on streaming calls", async () => {
		const run = vi.fn().mockResolvedValue(sseStream(["data: [DONE]\n\n"]));
		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		await collect(
			await gw.stream!(
				"@cf/meta/llama-3.3-70b-instruct-fp8-fast",
				{ messages: [{ role: "user", content: "VIX?" }] },
				{
					toolOptions: {
						tools: [
							{
								name: "get_macro_indicators",
								description: "Get macro indicators",
								parameters: { type: "object", properties: {} },
							},
						],
						toolChoice: "auto",
					},
				},
			),
		);

		const called = run.mock.calls[0][1];
		expect(called.stream).toBe(true);
		expect(called.tools).toEqual([
			{
				type: "function",
				function: {
					name: "get_macro_indicators",
					description: "Get macro indicators",
					parameters: { type: "object", properties: {} },
				},
			},
		]);
		expect(called.tool_choice).toBe("auto");
	});

	it("emits tool_use events for Llama's flat tool_calls on the stream", async () => {
		const toolCall = JSON.stringify({
			response: "",
			tool_calls: [{ name: "get_macro_indicators", arguments: { indicator: "VIX" } }],
		});
		const bindingStream = sseStream([`data: ${toolCall}\n\n`, "data: [DONE]\n\n"]);
		const run = vi.fn().mockResolvedValue(bindingStream);

		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		const events = await collect(
			await gw.stream!("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
				messages: [{ role: "user", content: "q" }],
			}),
		);

		const toolEvents = events.filter((e) => e.type === "tool_use") as Array<
			Extract<GatewayStreamEvent, { type: "tool_use" }>
		>;
		expect(toolEvents).toHaveLength(1);
		expect(toolEvents[0].name).toBe("get_macro_indicators");
		expect(toolEvents[0].input).toEqual({ indicator: "VIX" });
		expect(typeof toolEvents[0].id).toBe("string");
	});

	it("dedupes tool_calls with the same id across repeated SSE frames", async () => {
		const body = JSON.stringify({
			response: "",
			tool_calls: [{ id: "call_X", name: "f", arguments: { a: 1 } }],
		});
		const bindingStream = sseStream([`data: ${body}\n\n`, `data: ${body}\n\n`, "data: [DONE]\n\n"]);
		const run = vi.fn().mockResolvedValue(bindingStream);

		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		const events = await collect(
			await gw.stream!("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt: "q" }),
		);

		const toolEvents = events.filter((e) => e.type === "tool_use");
		expect(toolEvents).toHaveLength(1);
	});

	it("does NOT dedupe un-id'd tool_calls across frames (each fires with a unique fallback id)", async () => {
		// Regression guard: Llama often omits `id`. Two legitimately distinct
		// un-id'd calls (same name, different arguments) across frames must both
		// fire. Dedupe must only apply when the provider supplied an id.
		const frame1 = JSON.stringify({
			response: "",
			tool_calls: [{ name: "lookup", arguments: { q: "VIX" } }],
		});
		const frame2 = JSON.stringify({
			response: "",
			tool_calls: [{ name: "lookup", arguments: { q: "DXY" } }],
		});
		const bindingStream = sseStream([
			`data: ${frame1}\n\n`,
			`data: ${frame2}\n\n`,
			"data: [DONE]\n\n",
		]);
		const run = vi.fn().mockResolvedValue(bindingStream);

		const gw = createGateway({
			providers: { ai: { type: "workers-ai", binding: { run } } },
			defaultProvider: "ai",
		});

		const events = await collect(
			await gw.stream!("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt: "q" }),
		);

		const toolEvents = events.filter((e) => e.type === "tool_use") as Array<
			Extract<GatewayStreamEvent, { type: "tool_use" }>
		>;
		expect(toolEvents).toHaveLength(2);
		expect(toolEvents[0].input).toEqual({ q: "VIX" });
		expect(toolEvents[1].input).toEqual({ q: "DXY" });
		// Fallback ids are distinct so downstream tool-call threading doesn't collide.
		expect(toolEvents[0].id).not.toBe(toolEvents[1].id);
	});
});

describe("gateway.stream() — Anthropic", () => {
	it("captures input_tokens from message_start and output_tokens from message_delta", async () => {
		const fetchMock = mockHttpStream([
			'event: message_start\ndata: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":17,"output_tokens":0}}}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		const events = await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));
		const done = events[events.length - 1] as {
			type: "done";
			usage?: { inputTokens: number; outputTokens: number };
		};
		expect(done.usage).toEqual({ inputTokens: 17, outputTokens: 42 });
	});

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
		const fetchMock = mockHttpStream(['event: message_stop\ndata: {"type":"message_stop"}\n\n']);
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

describe("gateway.stream() — Anthropic tool_use", () => {
	it("accumulates input_json_delta and emits a tool_use event at content_block_stop", async () => {
		const fetchMock = mockHttpStream([
			'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\":"}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"SF\\"}"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		const events = await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));
		const toolUse = events.find((e) => e.type === "tool_use") as
			| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
			| undefined;

		expect(toolUse).toBeDefined();
		expect(toolUse!.id).toBe("toolu_1");
		expect(toolUse!.name).toBe("get_weather");
		expect(toolUse!.input).toEqual({ location: "SF" });
	});

	it("emits text and tool_use events in stream order", async () => {
		const fetchMock = mockHttpStream([
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"thinking"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"f","input":{}}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\":1}"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		const events = await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));
		const types = events.map((e) => e.type);
		expect(types).toEqual(["text", "tool_use", "done"]);
	});

	it("emits multiple tool_use events for multiple tool blocks", async () => {
		const fetchMock = mockHttpStream([
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"a","input":{}}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"b","input":{}}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"y\\":2}"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		const events = await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));
		const toolUses = events.filter((e) => e.type === "tool_use") as Array<{
			type: "tool_use";
			id: string;
			name: string;
			input: Record<string, unknown>;
		}>;

		expect(toolUses).toHaveLength(2);
		expect(toolUses[0].id).toBe("toolu_1");
		expect(toolUses[0].input).toEqual({});
		expect(toolUses[1].id).toBe("toolu_2");
		expect(toolUses[1].input).toEqual({ y: 2 });
	});

	it("emits tool_use with empty input when accumulated JSON is malformed", async () => {
		const fetchMock = mockHttpStream([
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"f","input":{}}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{broken"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { anthropic: { type: "anthropic", apiKey: "k" } },
			defaultProvider: "anthropic",
		});

		const events = await collect(await gw.stream!("claude-sonnet-4-6", { prompt: "hi" }));
		const toolUse = events.find((e) => e.type === "tool_use") as
			| { type: "tool_use"; id: string; input: Record<string, unknown> }
			| undefined;
		expect(toolUse?.id).toBe("toolu_1");
		expect(toolUse?.input).toEqual({});
	});
});

describe("gateway.stream() — OpenAI tool_use", () => {
	it("accumulates tool_calls arguments across deltas and emits a tool_use event", async () => {
		const fetchMock = mockHttpStream([
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"loc"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\\":\\"SF\\"}"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
			"data: [DONE]\n\n",
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const events = await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));
		const toolUse = events.find((e) => e.type === "tool_use") as
			| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
			| undefined;

		expect(toolUse).toBeDefined();
		expect(toolUse!.id).toBe("call_1");
		expect(toolUse!.name).toBe("get_weather");
		expect(toolUse!.input).toEqual({ location: "SF" });
	});

	it("emits tool_use for each call index in a multi-call stream", async () => {
		const fetchMock = mockHttpStream([
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"a","arguments":"{}"}},{"index":1,"id":"call_2","function":{"name":"b","arguments":"{\\"y\\":2}"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
			"data: [DONE]\n\n",
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const events = await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));
		const toolUses = events.filter((e) => e.type === "tool_use") as Array<{
			type: "tool_use";
			id: string;
			name: string;
			input: Record<string, unknown>;
		}>;

		expect(toolUses).toHaveLength(2);
		expect(toolUses[0].id).toBe("call_1");
		expect(toolUses[1].id).toBe("call_2");
		expect(toolUses[1].input).toEqual({ y: 2 });
	});

	it("emits pending tool_use events at stream end if finish_reason is missing", async () => {
		const fetchMock = mockHttpStream([
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"f","arguments":"{}"}}]}}]}\n\n',
			"data: [DONE]\n\n",
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const events = await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));
		const toolUse = events.find((e) => e.type === "tool_use");
		expect(toolUse).toBeDefined();
	});

	it("emits tool_use with empty input when arguments JSON is malformed", async () => {
		const fetchMock = mockHttpStream([
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"f","arguments":"{broken"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
			"data: [DONE]\n\n",
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const events = await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));
		const toolUse = events.find((e) => e.type === "tool_use") as
			| { type: "tool_use"; input: Record<string, unknown> }
			| undefined;
		expect(toolUse?.input).toEqual({});
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
		const fetchMock = mockHttpStream(['event: message_stop\ndata: {"type":"message_stop"}\n\n']);
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

	it("parses SSE records separated by \\r\\n\\r\\n as well as \\n\\n", async () => {
		const fetchMock = mockHttpStream([
			'data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\n',
			'data: {"choices":[{"delta":{"content":"B"}}]}\r\n\r\n',
			"data: [DONE]\r\n\r\n",
		]);
		globalThis.fetch = fetchMock;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const events = await collect(await gw.stream!("gpt-4o", { prompt: "hi" }));
		const text = events
			.filter((e) => e.type === "text")
			.map((e) => (e as { delta: string }).delta)
			.join("");
		expect(text).toBe("AB");
	});

	it("removes the abort listener from the external signal on normal completion", async () => {
		const fetchMock = mockHttpStream(["data: [DONE]\n\n"]);
		globalThis.fetch = fetchMock;

		// Count listeners via our own counter wrapped around add/removeEventListener.
		const controller = new AbortController();
		let listenerCount = 0;
		const realAdd = controller.signal.addEventListener.bind(controller.signal);
		const realRemove = controller.signal.removeEventListener.bind(controller.signal);
		controller.signal.addEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject,
			opts?: AddEventListenerOptions | boolean,
		) => {
			if (type === "abort") listenerCount++;
			return realAdd(type, listener, opts);
		}) as typeof controller.signal.addEventListener;
		controller.signal.removeEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject,
			opts?: EventListenerOptions | boolean,
		) => {
			if (type === "abort") listenerCount--;
			return realRemove(type, listener, opts);
		}) as typeof controller.signal.removeEventListener;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		await collect(await gw.stream!("gpt-4o", { prompt: "hi" }, { signal: controller.signal }));

		expect(listenerCount).toBe(0);
	});

	it("aborts the underlying fetch when the consumer cancels the event stream", async () => {
		let capturedSignal: AbortSignal | undefined;
		const fetchMock = vi.fn().mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
			capturedSignal = init.signal;
			return Promise.resolve({
				ok: true,
				status: 200,
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						const enc = new TextEncoder();
						controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'));
						// Don't close — wait for cancel.
					},
				}),
			});
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const gw = createGateway({
			providers: { openai: { type: "openai", apiKey: "k" } },
			defaultProvider: "openai",
		});

		const stream = await gw.stream!("gpt-4o", { prompt: "hi" });
		const reader = stream.getReader();
		await reader.read(); // consume one token
		await reader.cancel();

		expect(capturedSignal?.aborted).toBe(true);
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
