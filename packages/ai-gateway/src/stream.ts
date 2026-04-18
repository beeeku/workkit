import { ServiceUnavailableError } from "@workkit/errors";
import type {
	AiInput,
	AnthropicProviderConfig,
	CfGatewayConfig,
	GatewayStreamEvent,
	OpenAiProviderConfig,
	ProviderConfig,
	RunOptions,
	TokenUsage,
	WorkersAiProviderConfig,
} from "./types";

/**
 * Run a streaming request against a provider and return a unified
 * `ReadableStream<GatewayStreamEvent>`.
 *
 * Per-provider stream wire formats are translated into the shared event shape:
 *  - `{ type: "text", delta }` for generated tokens
 *  - `{ type: "done", usage?, raw? }` exactly once at the end of the stream
 *
 * Tool-use events are not emitted in this pass (see roadmap).
 */
export async function streamProvider(
	providerConfig: ProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
	baseUrlResolver: (
		provider: "openai" | "anthropic",
		explicit: string | undefined,
	) => string,
	cfGatewayHeaders: (cf: CfGatewayConfig | undefined) => Record<string, string>,
): Promise<ReadableStream<GatewayStreamEvent>> {
	switch (providerConfig.type) {
		case "workers-ai":
			return streamWorkersAi(providerConfig, model, input, options);
		case "anthropic":
			return streamAnthropic(providerConfig, model, input, options, cfGateway, baseUrlResolver, cfGatewayHeaders);
		case "openai":
			return streamOpenAi(providerConfig, model, input, options, cfGateway, baseUrlResolver, cfGatewayHeaders);
		case "custom":
			throw new ServiceUnavailableError("custom providers do not support streaming", {
				context: { provider: "custom" },
			});
	}
}

// ─── Workers AI ──────────────────────────────────────────────

async function streamWorkersAi(
	providerConfig: WorkersAiProviderConfig,
	model: string,
	input: AiInput,
	_options: RunOptions | undefined,
): Promise<ReadableStream<GatewayStreamEvent>> {
	const raw = (await providerConfig.binding.run(model, {
		...(input as Record<string, unknown>),
		stream: true,
	})) as unknown;

	if (!(raw instanceof ReadableStream)) {
		// Non-streaming response: emit a single text event followed by done.
		const text = typeof raw === "string" ? raw : extractWorkersAiText(raw);
		return singleEventStream(text);
	}

	return transformSse(raw, (event, emit) => {
		if (event.data === "[DONE]") return;
		const obj = tryParseJson(event.data);
		const delta = typeof obj?.response === "string" ? obj.response : undefined;
		if (delta) emit({ type: "text", delta });
	});
}

function extractWorkersAiText(raw: unknown): string {
	if (raw && typeof raw === "object") {
		const obj = raw as Record<string, unknown>;
		if (typeof obj.response === "string") return obj.response;
	}
	return "";
}

// ─── Anthropic ──────────────────────────────────────────────

async function streamAnthropic(
	providerConfig: AnthropicProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
	baseUrlResolver: (
		provider: "openai" | "anthropic",
		explicit: string | undefined,
	) => string,
	cfGatewayHeaders: (cf: CfGatewayConfig | undefined) => Record<string, string>,
): Promise<ReadableStream<GatewayStreamEvent>> {
	const baseUrl = baseUrlResolver("anthropic", providerConfig.baseUrl);
	const body = anthropicStreamBody(model, input);

	const response = await fetch(`${baseUrl}/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": providerConfig.apiKey,
			"anthropic-version": "2023-06-01",
			...cfGatewayHeaders(cfGateway),
		},
		body: JSON.stringify(body),
		signal: options?.signal,
	});

	if (!response.ok || !response.body) {
		const errorBody = await response.text().catch(() => "unknown error");
		throw new ServiceUnavailableError(`anthropic-stream (${response.status})`, {
			context: { status: response.status, model, body: errorBody },
		});
	}

	let finalUsage: TokenUsage | undefined;
	return transformSse(response.body, (event, emit, finish) => {
		const obj = tryParseJson(event.data);
		if (!obj) return;
		const t = obj.type;
		if (t === "content_block_delta") {
			const delta = obj.delta as Record<string, unknown> | undefined;
			if (delta?.type === "text_delta" && typeof delta.text === "string") {
				emit({ type: "text", delta: delta.text });
			}
		} else if (t === "message_delta") {
			const usage = obj.usage as Record<string, unknown> | undefined;
			if (usage && typeof usage.output_tokens === "number") {
				finalUsage = {
					inputTokens: 0,
					outputTokens: usage.output_tokens,
				};
			}
		} else if (t === "message_stop") {
			finish({ type: "done", usage: finalUsage });
		}
	});
}

function anthropicStreamBody(model: string, input: AiInput): Record<string, unknown> {
	// Match buildAnthropicBody's message shaping but simpler — streaming callers
	// rarely use responseFormat/tools here; follow-up PRs extend this.
	if ("messages" in input && Array.isArray((input as { messages: unknown }).messages)) {
		const msgs = (input as { messages: Array<{ role: string; content: string }> }).messages;
		const systemMsg = msgs.find((m) => m.role === "system");
		const nonSystem = msgs.filter((m) => m.role !== "system");
		const body: Record<string, unknown> = {
			model,
			messages: nonSystem,
			max_tokens: 1024,
			stream: true,
		};
		if (systemMsg) body.system = systemMsg.content;
		return body;
	}
	if ("prompt" in input) {
		return {
			model,
			messages: [{ role: "user", content: (input as { prompt: string }).prompt }],
			max_tokens: 1024,
			stream: true,
		};
	}
	return { model, max_tokens: 1024, stream: true, ...(input as Record<string, unknown>) };
}

// ─── OpenAI ──────────────────────────────────────────────────

async function streamOpenAi(
	providerConfig: OpenAiProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
	baseUrlResolver: (
		provider: "openai" | "anthropic",
		explicit: string | undefined,
	) => string,
	cfGatewayHeaders: (cf: CfGatewayConfig | undefined) => Record<string, string>,
): Promise<ReadableStream<GatewayStreamEvent>> {
	const baseUrl = baseUrlResolver("openai", providerConfig.baseUrl);
	const body = openAiStreamBody(model, input);

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${providerConfig.apiKey}`,
			...cfGatewayHeaders(cfGateway),
		},
		body: JSON.stringify(body),
		signal: options?.signal,
	});

	if (!response.ok || !response.body) {
		const errorBody = await response.text().catch(() => "unknown error");
		throw new ServiceUnavailableError(`openai-stream (${response.status})`, {
			context: { status: response.status, model, body: errorBody },
		});
	}

	let finalUsage: TokenUsage | undefined;
	return transformSse(response.body, (event, emit, finish) => {
		if (event.data === "[DONE]") {
			finish({ type: "done", usage: finalUsage });
			return;
		}
		const obj = tryParseJson(event.data);
		if (!obj) return;

		const choices = obj.choices as Array<Record<string, unknown>> | undefined;
		const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
		if (typeof delta?.content === "string" && delta.content.length > 0) {
			emit({ type: "text", delta: delta.content });
		}

		const usage = obj.usage as Record<string, unknown> | undefined;
		if (usage) {
			finalUsage = {
				inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
				outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
			};
		}
	});
}

function openAiStreamBody(model: string, input: AiInput): Record<string, unknown> {
	if ("messages" in input && Array.isArray((input as { messages: unknown }).messages)) {
		const msgs = (input as { messages: Array<{ role: string; content: string }> }).messages;
		return {
			model,
			messages: msgs.map(({ role, content }) => ({ role, content })),
			stream: true,
		};
	}
	if ("prompt" in input) {
		return {
			model,
			messages: [{ role: "user", content: (input as { prompt: string }).prompt }],
			stream: true,
		};
	}
	return { model, stream: true, ...(input as Record<string, unknown>) };
}

// ─── SSE parser + helpers ────────────────────────────────────

interface SseEvent {
	event?: string;
	data: string;
}

type EmitFn = (event: GatewayStreamEvent) => void;
type FinishFn = (event: GatewayStreamEvent) => void;

/**
 * Parse an SSE-formatted byte stream into a stream of `GatewayStreamEvent`s
 * via a per-event translator. The translator may call `emit` for any number
 * of events; the wrapper guarantees exactly one `done` event at the end.
 *
 * If the translator calls `finish(...)`, that event is used as the final
 * `done`. Otherwise a synthetic `{ type: "done" }` is appended.
 */
function transformSse(
	source: ReadableStream<Uint8Array>,
	translate: (event: SseEvent, emit: EmitFn, finish: FinishFn) => void,
): ReadableStream<GatewayStreamEvent> {
	const reader = source.getReader();

	return new ReadableStream<GatewayStreamEvent>({
		async start(controller) {
			const decoder = new TextDecoder();
			let buffer = "";
			let finishEvent: GatewayStreamEvent | undefined;

			const emit: EmitFn = (e) => controller.enqueue(e);
			const finish: FinishFn = (e) => {
				finishEvent = e;
			};

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					let idx: number;
					while ((idx = buffer.indexOf("\n\n")) !== -1) {
						const record = buffer.slice(0, idx);
						buffer = buffer.slice(idx + 2);
						const parsed = parseSseRecord(record);
						if (parsed) translate(parsed, emit, finish);
					}
				}
				const remaining = parseSseRecord(buffer);
				if (remaining) translate(remaining, emit, finish);
				controller.enqueue(finishEvent ?? { type: "done" });
				controller.close();
			} catch (err) {
				controller.error(err);
			}
		},
		cancel() {
			// Swallow cancel errors — consumer already walked away.
			reader.cancel().catch(noop);
		},
	});
}

function parseSseRecord(record: string): SseEvent | undefined {
	if (!record.trim()) return undefined;
	let event: string | undefined;
	const dataLines: string[] = [];
	for (const line of record.split("\n")) {
		if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
	}
	if (dataLines.length === 0) return undefined;
	return { event, data: dataLines.join("\n") };
}

function tryParseJson(s: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(s) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function noop(): void {
	return;
}

function singleEventStream(text: string): ReadableStream<GatewayStreamEvent> {
	return new ReadableStream<GatewayStreamEvent>({
		start(controller) {
			if (text) controller.enqueue({ type: "text", delta: text });
			controller.enqueue({ type: "done" });
			controller.close();
		},
	});
}
