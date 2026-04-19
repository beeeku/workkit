import { ServiceUnavailableError } from "@workkit/errors";
import { buildAnthropicBody } from "./providers/anthropic";
import { buildOpenAiBody } from "./providers/openai";
import { applyToolsWorkersAi } from "./providers/workers-ai";
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
 *  - `{ type: "tool_use", id, name, input }` when a tool call completes
 *    (Anthropic `input_json_delta` accumulation; OpenAI `tool_calls` deltas)
 *  - `{ type: "done", usage?, raw? }` exactly once at the end of the stream
 */
export async function streamProvider(
	providerConfig: ProviderConfig,
	model: string,
	input: AiInput,
	options: RunOptions | undefined,
	cfGateway: CfGatewayConfig | undefined,
	baseUrlResolver: (provider: "openai" | "anthropic", explicit: string | undefined) => string,
	cfGatewayHeaders: (cf: CfGatewayConfig | undefined) => Record<string, string>,
): Promise<ReadableStream<GatewayStreamEvent>> {
	switch (providerConfig.type) {
		case "workers-ai":
			return streamWorkersAi(providerConfig, model, input, options);
		case "anthropic":
			return streamAnthropic(
				providerConfig,
				model,
				input,
				options,
				cfGateway,
				baseUrlResolver,
				cfGatewayHeaders,
			);
		case "openai":
			return streamOpenAi(
				providerConfig,
				model,
				input,
				options,
				cfGateway,
				baseUrlResolver,
				cfGatewayHeaders,
			);
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
	options: RunOptions | undefined,
): Promise<ReadableStream<GatewayStreamEvent>> {
	// Thread toolOptions into the payload so Llama sees the tool list on the
	// streaming path too. Non-streaming already does this in executeWorkersAi.
	const withTools = applyToolsWorkersAi(input, options?.toolOptions);
	const raw = (await providerConfig.binding.run(model, {
		...withTools,
		stream: true,
	})) as unknown;

	if (!(raw instanceof ReadableStream)) {
		// Non-streaming response: emit a single text event followed by done.
		const text = typeof raw === "string" ? raw : extractWorkersAiText(raw);
		return singleEventStream(text);
	}

	// Workers AI stream has no underlying fetch to abort on cancel.
	const emittedProviderIds = new Set<string>();
	let fallbackIdCounter = 0;
	return transformSse(raw, noop, (event, emit) => {
		if (event.data === "[DONE]") return;
		const obj = tryParseJson(event.data);
		const delta = typeof obj?.response === "string" ? obj.response : undefined;
		if (delta) emit({ type: "text", delta });

		// Llama on Workers AI streams emits tool_calls as fully-formed objects
		// (not delta-fragmented like OpenAI). Dedupe only when the provider
		// supplied an id — otherwise two legitimately distinct un-id'd calls
		// (same name, different arguments) would be silently collapsed.
		// `fallbackIdCounter` is stream-scoped so IDs stay unique across frames.
		const rawCalls = obj?.tool_calls as Array<Record<string, unknown>> | undefined;
		if (!Array.isArray(rawCalls) || rawCalls.length === 0) return;
		for (const rc of rawCalls) {
			const name = typeof rc.name === "string" ? rc.name : undefined;
			if (!name) continue;
			let id: string;
			if (typeof rc.id === "string") {
				if (emittedProviderIds.has(rc.id)) continue;
				emittedProviderIds.add(rc.id);
				id = rc.id;
			} else {
				id = `call_${fallbackIdCounter++}`;
			}
			const args =
				rc.arguments && typeof rc.arguments === "object"
					? (rc.arguments as Record<string, unknown>)
					: typeof rc.arguments === "string"
						? safeJsonParse(rc.arguments)
						: {};
			emit({ type: "tool_use", id, name, input: args });
		}
	});
}

function safeJsonParse(s: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(s);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
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
	baseUrlResolver: (provider: "openai" | "anthropic", explicit: string | undefined) => string,
	cfGatewayHeaders: (cf: CfGatewayConfig | undefined) => Record<string, string>,
): Promise<ReadableStream<GatewayStreamEvent>> {
	const baseUrl = baseUrlResolver("anthropic", providerConfig.baseUrl);
	const body = {
		...buildAnthropicBody(model, input, options?.responseFormat, options?.toolOptions),
		stream: true,
	};
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
	// Per-index accumulator for tool_use content blocks. Entries are seeded on
	// content_block_start and drained on content_block_stop.
	const toolBlocks = new Map<number, { id: string; name: string; argsText: string }>();

	return transformSse(
		response.body,
		abort,
		(event, emit, finish) => {
			const obj = tryParseJson(event.data);
			if (!obj) return;
			const t = obj.type;
			const index = typeof obj.index === "number" ? obj.index : undefined;

			if (t === "content_block_start" && index !== undefined) {
				const block = obj.content_block as Record<string, unknown> | undefined;
				if (
					block?.type === "tool_use" &&
					typeof block.id === "string" &&
					typeof block.name === "string"
				) {
					toolBlocks.set(index, { id: block.id, name: block.name, argsText: "" });
				}
			} else if (t === "content_block_delta" && index !== undefined) {
				const delta = obj.delta as Record<string, unknown> | undefined;
				if (delta?.type === "text_delta" && typeof delta.text === "string") {
					emit({ type: "text", delta: delta.text });
				} else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
					const pending = toolBlocks.get(index);
					if (pending) pending.argsText += delta.partial_json;
				}
			} else if (t === "content_block_stop" && index !== undefined) {
				const pending = toolBlocks.get(index);
				if (pending) {
					toolBlocks.delete(index);
					emit({
						type: "tool_use",
						id: pending.id,
						name: pending.name,
						input: parseToolArgs(pending.argsText),
					});
				}
			} else if (t === "message_start") {
				// Anthropic surfaces input_tokens on the initial message_start frame.
				const message = obj.message as Record<string, unknown> | undefined;
				const usage = message?.usage as Record<string, unknown> | undefined;
				if (usage && typeof usage.input_tokens === "number") {
					finalUsage = {
						inputTokens: usage.input_tokens,
						outputTokens: finalUsage?.outputTokens ?? 0,
					};
				}
			} else if (t === "message_delta") {
				const usage = obj.usage as Record<string, unknown> | undefined;
				if (usage && typeof usage.output_tokens === "number") {
					finalUsage = {
						inputTokens: finalUsage?.inputTokens ?? 0,
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
	baseUrlResolver: (provider: "openai" | "anthropic", explicit: string | undefined) => string,
	cfGatewayHeaders: (cf: CfGatewayConfig | undefined) => Record<string, string>,
): Promise<ReadableStream<GatewayStreamEvent>> {
	const baseUrl = baseUrlResolver("openai", providerConfig.baseUrl);
	const body = {
		...buildOpenAiBody(model, input, options?.responseFormat, options?.toolOptions),
		stream: true,
	};
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
	// Per-call-index accumulator. OpenAI splits tool_calls arguments across
	// deltas; id/name arrive on the first delta, arguments are appended.
	const toolCalls = new Map<number, { id?: string; name?: string; argsText: string }>();

	const flushToolCalls = (emit: EmitFn) => {
		for (const [, call] of toolCalls) {
			if (!call.id || !call.name) continue;
			emit({
				type: "tool_use",
				id: call.id,
				name: call.name,
				input: parseToolArgs(call.argsText),
			});
		}
		toolCalls.clear();
	};

	return transformSse(
		response.body,
		abort,
		(event, emit, finish) => {
			if (event.data === "[DONE]") {
				flushToolCalls(emit);
				finish({ type: "done", usage: finalUsage });
				return;
			}
			const obj = tryParseJson(event.data);
			if (!obj) return;

			const choices = obj.choices as Array<Record<string, unknown>> | undefined;
			const choice = choices?.[0];
			const delta = choice?.delta as Record<string, unknown> | undefined;

			if (typeof delta?.content === "string" && delta.content.length > 0) {
				emit({ type: "text", delta: delta.content });
			}

			const rawToolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
			if (Array.isArray(rawToolCalls)) {
				for (const raw of rawToolCalls) {
					const idx = typeof raw.index === "number" ? raw.index : 0;
					const pending = toolCalls.get(idx) ?? { argsText: "" };
					if (typeof raw.id === "string") pending.id = raw.id;
					const fn = raw.function as Record<string, unknown> | undefined;
					if (fn && typeof fn.name === "string") pending.name = fn.name;
					if (fn && typeof fn.arguments === "string") pending.argsText += fn.arguments;
					toolCalls.set(idx, pending);
				}
			}

			if (choice?.finish_reason === "tool_calls") {
				flushToolCalls(emit);
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

/**
 * Parse accumulated tool-call arguments. Providers stream `arguments` as a
 * JSON string built up across deltas; if the final string isn't valid JSON
 * (provider bug, truncation, etc.), fall back to an empty object rather
 * than failing the entire stream.
 */
function parseToolArgs(text: string): Record<string, unknown> {
	if (!text) return {};
	try {
		const parsed = JSON.parse(text) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
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
