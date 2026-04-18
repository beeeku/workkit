import { ServiceUnavailableError } from "@workkit/errors";
import { buildAnthropicBody } from "./providers/anthropic";
import { buildOpenAiBody } from "./providers/openai";
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

	// Workers AI stream has no underlying fetch to abort on cancel.
	return transformSse(raw, noop, (event, emit) => {
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
	const body = { ...buildAnthropicBody(model, input, options?.responseFormat, options?.toolOptions), stream: true };
	const { signal, abort, dispose } = linkedAbort(options?.signal);

	const response = await fetch(`${baseUrl}/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": providerConfig.apiKey,
			"anthropic-version": "2023-06-01",
			...cfGatewayHeaders(cfGateway),
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok || !response.body) {
		const errorBody = await response.text().catch(() => "unknown error");
		dispose();
		throw new ServiceUnavailableError(`anthropic-stream (${response.status})`, {
			context: { status: response.status, model, body: errorBody },
		});
	}

	let finalUsage: TokenUsage | undefined;
	return transformSse(
		response.body,
		abort,
		(event, emit, finish) => {
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
		},
		dispose,
	);
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
	const body = { ...buildOpenAiBody(model, input, options?.responseFormat, options?.toolOptions), stream: true };
	const { signal, abort, dispose } = linkedAbort(options?.signal);

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${providerConfig.apiKey}`,
			...cfGatewayHeaders(cfGateway),
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok || !response.body) {
		const errorBody = await response.text().catch(() => "unknown error");
		dispose();
		throw new ServiceUnavailableError(`openai-stream (${response.status})`, {
			context: { status: response.status, model, body: errorBody },
		});
	}

	let finalUsage: TokenUsage | undefined;
	return transformSse(
		response.body,
		abort,
		(event, emit, finish) => {
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
		},
		dispose,
	);
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
	onCancel: () => void,
	translate: (event: SseEvent, emit: EmitFn, finish: FinishFn) => void,
	onFinish: () => void = noop,
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

					// SSE spec allows either "\n\n" or "\r\n\r\n" as record separator.
					while (true) {
						const boundary = findRecordBoundary(buffer);
						if (!boundary) break;
						const record = buffer.slice(0, boundary.index);
						buffer = buffer.slice(boundary.index + boundary.length);
						const parsed = parseSseRecord(record);
						if (parsed) translate(parsed, emit, finish);
					}
				}
				const remaining = parseSseRecord(buffer);
				if (remaining) translate(remaining, emit, finish);
				controller.enqueue(finishEvent ?? { type: "done" });
				controller.close();
			} catch (err) {
				// Release the source reader before erroring the output stream so
				// the lock doesn't linger awaiting GC.
				reader.cancel().catch(noop);
				controller.error(err);
			} finally {
				onFinish();
			}
		},
		cancel() {
			// Abort the upstream fetch so we don't keep downloading tokens the
			// consumer has already walked away from. Swallow cancel errors.
			onCancel();
			reader.cancel().catch(noop);
			onFinish();
		},
	});
}

/**
 * Build an AbortController whose signal is linked to an optional external
 * signal (aborts cascade in). `abort()` aborts our signal; if the external
 * signal is already aborted, our signal starts aborted too.
 *
 * `dispose()` removes our listener from the external signal — callers must
 * invoke it when the stream finishes (normally or via error) so the listener
 * doesn't leak on long-lived external signals.
 */
function linkedAbort(external: AbortSignal | undefined): {
	signal: AbortSignal;
	abort: () => void;
	dispose: () => void;
} {
	const controller = new AbortController();
	let dispose: () => void = noop;
	if (external) {
		if (external.aborted) {
			controller.abort(external.reason);
		} else {
			const onExternal = () => controller.abort(external.reason);
			external.addEventListener("abort", onExternal, { once: true });
			dispose = () => external.removeEventListener("abort", onExternal);
		}
	}
	return {
		signal: controller.signal,
		abort: () => {
			if (!controller.signal.aborted)
				controller.abort(new DOMException("stream cancelled", "AbortError"));
		},
		dispose,
	};
}

function parseSseRecord(record: string): SseEvent | undefined {
	if (!record.trim()) return undefined;
	let event: string | undefined;
	const dataLines: string[] = [];
	// Split on either "\n" or "\r\n" line terminators.
	for (const rawLine of record.split(/\r?\n/)) {
		const line = rawLine;
		if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
	}
	if (dataLines.length === 0) return undefined;
	return { event, data: dataLines.join("\n") };
}

function findRecordBoundary(buffer: string): { index: number; length: number } | undefined {
	const lf = buffer.indexOf("\n\n");
	const crlf = buffer.indexOf("\r\n\r\n");
	// Use whichever boundary appears first.
	if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
	if (lf !== -1) return { index: lf, length: 2 };
	return undefined;
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
