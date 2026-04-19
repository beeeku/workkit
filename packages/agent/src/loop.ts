import type { ChatMessage, GatewayToolCall, RunOptions, TokenUsage } from "@workkit/ai-gateway";
import { OffPaletteToolError, ToolValidationError } from "./errors";
import type { AgentEvent } from "./events";
import { HANDOFF_HOP_LIMIT } from "./handoff";
import { toJsonSchema } from "./schema";
import { runStep } from "./stream-step";
import { runTool } from "./tool";
import type {
	Agent,
	AgentHooks,
	Message,
	RunContext,
	StopReason,
	StopWhen,
	Tool,
	ToolCtx,
} from "./types";

export interface InternalAgentDef {
	name: string;
	model: string;
	provider: import("@workkit/ai-gateway").Gateway;
	instructions?: string;
	tools: Tool[];
	stopWhen: Required<StopWhen>;
	hooks: AgentHooks;
	strictTools: boolean;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
	if (!b) return a;
	const totalA = a.totalTokens ?? a.inputTokens + a.outputTokens;
	const totalB = b.totalTokens ?? b.inputTokens + b.outputTokens;
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		totalTokens: totalA + totalB,
	};
}

function toChatMessages(messages: Message[], instructions?: string): ChatMessage[] {
	const out: ChatMessage[] = [];
	if (instructions) out.push({ role: "system", content: instructions });
	for (const m of messages) {
		if (m.role === "tool") {
			// Provider abstraction: most providers use role:"tool" + tool_call_id;
			// our gateway abstraction takes ChatMessage as role:"system|user|assistant".
			// For now we serialize tool results into a user-tagged note. Providers
			// that natively understand role:"tool" can be plumbed in a follow-up.
			out.push({
				role: "user",
				content: `[tool ${m.tool_name} (id=${m.tool_call_id})${m.isError ? " ERROR" : ""}] ${m.content}`,
			});
			continue;
		}
		out.push({ role: m.role, content: m.content });
	}
	return out;
}

export interface RunStepResult {
	messages: Message[];
	usage: TokenUsage;
	currentAgent: Agent | InternalAgentDef;
	stopReason: StopReason | null;
	events: AgentEvent[];
}

type AgentResolver = (name: string) => InternalAgentDef | undefined;

export interface RunLoopArgs {
	agent: InternalAgentDef;
	messages: Message[];
	context: RunContext;
	resolveAgent: AgentResolver;
	emit?: (event: AgentEvent) => void;
}

export async function runLoop(args: RunLoopArgs): Promise<{
	messages: Message[];
	usage: TokenUsage;
	stopReason: StopReason;
	finalText: string;
}> {
	let { messages } = args;
	const ctx = args.context;
	let usage: TokenUsage = { ...ZERO_USAGE, ...ctx.usage };
	let currentAgent: InternalAgentDef = args.agent;
	let agentPath: string[] = [...ctx.agentPath, currentAgent.name];
	const emit = args.emit ?? (() => {});

	let step = 0;
	let finalText = "";

	while (true) {
		if (ctx.signal?.aborted) {
			emit({ type: "done", stopReason: "abort", usage });
			return { messages, usage, stopReason: "abort", finalText };
		}
		if (step >= currentAgent.stopWhen.maxSteps) {
			emit({ type: "done", stopReason: "max_steps", usage });
			return { messages, usage, stopReason: "max_steps", finalText };
		}
		if (
			currentAgent.stopWhen.maxTokens > 0 &&
			(usage.totalTokens ?? usage.inputTokens + usage.outputTokens) >=
				currentAgent.stopWhen.maxTokens
		) {
			emit({ type: "done", stopReason: "max_tokens", usage });
			return { messages, usage, stopReason: "max_tokens", finalText };
		}

		emit({ type: "step-start", step, agent: currentAgent.name });

		try {
			await currentAgent.hooks.beforeModel?.({ ...ctx, agentPath, usage });
		} catch (error) {
			emit({ type: "error", error: { kind: "hook", message: errorMessage(error) } });
			throw error;
		}

		const runOptions: RunOptions = {
			signal: ctx.signal,
			toolOptions:
				currentAgent.tools.length > 0
					? {
							tools: currentAgent.tools.map((t) => ({
								name: t.name,
								description: t.description,
								parameters: toJsonSchema(t.input).schema,
							})),
							toolChoice: "auto",
						}
					: undefined,
		};

		let output: import("@workkit/ai-gateway").AiOutput;
		try {
			output = await runStep(
				currentAgent,
				{ messages: toChatMessages(messages, currentAgent.instructions) },
				runOptions,
				step,
				emit,
			);
		} catch (error) {
			emit({ type: "error", error: { kind: "provider", message: errorMessage(error) } });
			// Default behaviour: stopReason:"error", rethrow. Provider failures
			// silently swallowed would mask outages; require an explicit hook
			// opt-in via `{ abort: false }` to recover with stopReason:"stop".
			const decision = await currentAgent.hooks.onError?.(
				{ kind: "provider", error },
				{ ...ctx, agentPath, usage },
			);
			if (decision && decision.abort === false) {
				emit({ type: "done", stopReason: "stop", usage });
				return { messages, usage, stopReason: "stop", finalText };
			}
			emit({ type: "done", stopReason: "error", usage });
			throw error;
		}

		usage = addUsage(usage, output.usage);
		const text = output.text ?? "";
		finalText = text;

		const assistantMessage: Message = {
			role: "assistant",
			content: text,
			tool_calls: output.toolCalls,
		};
		messages = [...messages, assistantMessage];

		// `runStep` already emitted per-token `text-delta` events when streaming
		// (or a single synthesized one on the non-streaming path), so we don't
		// re-emit here.
		emit({ type: "step-complete", step, usage, assistant: assistantMessage });

		const toolCalls: GatewayToolCall[] = output.toolCalls ?? [];
		if (toolCalls.length === 0) {
			emit({ type: "done", stopReason: "stop", usage });
			return { messages, usage, stopReason: "stop", finalText };
		}

		// Strict mode: pre-scan the whole turn so no sibling tool executes if any
		// call is off-palette. Reject at the first off-palette call; never emit
		// `tool-start` for a rejected turn, so event pairs stay balanced.
		if (currentAgent.strictTools) {
			const paletteNames = new Set(currentAgent.tools.map((t) => t.name));
			const offPalette = toolCalls.find((c) => !paletteNames.has(c.name));
			if (offPalette) {
				emit({ type: "tool-rejected", call: offPalette, reason: "off-palette", step });
				emit({ type: "done", stopReason: "error", usage });
				throw new OffPaletteToolError(offPalette.name, Array.from(paletteNames));
			}
		}

		// Run tools (sequential — keeps order deterministic; parallel can come later).
		let switched = false;
		for (const call of toolCalls) {
			emit({ type: "tool-start", call, step });
			const tool = currentAgent.tools.find((t) => t.name === call.name);
			if (!tool) {
				const errMsg = `unknown tool: ${call.name}`;
				const toolMsg: Message = {
					role: "tool",
					tool_call_id: call.id,
					tool_name: call.name,
					content: errMsg,
					isError: true,
				};
				messages = [...messages, toolMsg];
				emit({ type: "tool-end", call, result: errMsg, isError: true, step });
				continue;
			}

			const toolCtx: ToolCtx = { ...ctx, agentPath, usage, id: call.id };
			let result: string;
			let isError = false;
			try {
				result = await runTool(tool, call.arguments, toolCtx);
			} catch (error) {
				isError = true;
				if (error instanceof ToolValidationError) {
					result = `[tool input invalid: ${error.message}]`;
				} else {
					result = `[tool error: ${errorMessage(error)}]`;
				}
				const decision = await currentAgent.hooks.onError?.(
					{ kind: "tool", toolName: tool.name, error },
					{ ...ctx, agentPath, usage },
				);
				if (decision?.abort) {
					const toolMsg: Message = {
						role: "tool",
						tool_call_id: call.id,
						tool_name: call.name,
						content: result,
						isError,
					};
					messages = [...messages, toolMsg];
					emit({ type: "tool-end", call, result, isError, step });
					emit({ type: "done", stopReason: "error", usage });
					throw error;
				}
			}

			const toolMsg: Message = {
				role: "tool",
				tool_call_id: call.id,
				tool_name: call.name,
				content: result,
				isError,
			};
			messages = [...messages, toolMsg];
			emit({ type: "tool-end", call, result, isError, step });

			try {
				await currentAgent.hooks.afterTool?.(call, result, { ...ctx, agentPath, usage });
			} catch (error) {
				emit({
					type: "error",
					error: { kind: "hook", toolName: tool.name, message: errorMessage(error) },
				});
				// afterTool failures don't abort the loop unless onError says so
				const decision = await currentAgent.hooks.onError?.(
					{ kind: "hook", toolName: tool.name, error },
					{ ...ctx, agentPath, usage },
				);
				if (decision?.abort) {
					emit({ type: "done", stopReason: "error", usage });
					throw error;
				}
			}

			if (tool.kind === "handoff" && tool.handoffTarget) {
				const target = args.resolveAgent(tool.handoffTarget);
				if (!target) {
					const msg = `handoff target "${tool.handoffTarget}" not registered`;
					emit({ type: "error", error: { kind: "config", message: msg } });
					// Replace the misleading "handing off to <target>" tool message
					// with a real error and stop the loop — leaving the model to
					// keep retrying an impossible handoff is worse than a clear stop.
					const lastIndex = messages.length - 1;
					const last = messages[lastIndex];
					if (last && last.role === "tool" && last.tool_call_id === call.id) {
						messages = [
							...messages.slice(0, lastIndex),
							{ ...last, content: `[handoff failed: ${msg}]`, isError: true },
						];
					}
					emit({ type: "done", stopReason: "error", usage });
					return { messages, usage, stopReason: "error", finalText };
				}
				{
					const occurrences = agentPath.filter((n) => n === target.name).length;
					if (occurrences >= HANDOFF_HOP_LIMIT) {
						const { HandoffCycleError } = await import("./errors");
						throw new HandoffCycleError(target.name, HANDOFF_HOP_LIMIT, agentPath);
					}
					emit({ type: "handoff", from: currentAgent.name, to: target.name, step });
					currentAgent = target;
					agentPath = [...agentPath, target.name];
					switched = true;
					break; // re-enter loop with new agent
				}
			}
		}

		step += 1;
		if (switched) continue;
	}
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
