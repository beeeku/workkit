import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ChatMessage, Gateway, GatewayToolCall, TokenUsage } from "@workkit/ai-gateway";
import type { AgentEvent } from "./events";

export type Message =
	| (ChatMessage & { role: "system" | "user" | "assistant"; tool_calls?: GatewayToolCall[] })
	| { role: "tool"; tool_call_id: string; tool_name: string; content: string; isError?: boolean };

export type StopReason = "max_steps" | "max_tokens" | "stop" | "abort" | "error";

export interface RunContext {
	/** User-supplied opaque context, propagated to tool handlers and hooks. */
	user?: Record<string, unknown>;
	/** Cancellation. Propagated to provider calls and tool handlers. */
	signal?: AbortSignal;
	/** Names of agents the loop has entered, in order. Read-only at consume time. */
	agentPath: readonly string[];
	/** Cumulative usage across all steps so far. */
	usage: TokenUsage;
}

export interface StopWhen {
	/** Hard ceiling on model calls. Default: 10. Required to be > 0. */
	maxSteps?: number;
	/** Cumulative token budget. Loop stops once exceeded after a step. */
	maxTokens?: number;
}

export interface OnErrorDecision {
	abort?: boolean;
}

export interface AgentHooks {
	beforeModel?(ctx: RunContext): void | Promise<void>;
	afterTool?(call: GatewayToolCall, result: string, ctx: RunContext): void | Promise<void>;
	onError?(
		err: { kind: "tool" | "provider" | "hook"; toolName?: string; error: unknown },
		ctx: RunContext,
	): undefined | OnErrorDecision | Promise<undefined | OnErrorDecision>;
}

export interface ToolCtx extends RunContext {
	/** Tool-call id from the provider. */
	id: string;
	/** Logger surface — opt-in caller-provided; falls back to no-op. */
	logger?: { info: (msg: string, meta?: Record<string, unknown>) => void };
}

export interface Tool<TInput = unknown, TOutput = unknown> {
	readonly name: string;
	readonly description: string;
	readonly input: StandardSchemaV1<TInput>;
	readonly output?: StandardSchemaV1<TOutput>;
	readonly handler: (input: TInput, ctx: ToolCtx) => Promise<TOutput>;
	/** Per-tool timeout (ms). Default 30_000. */
	readonly timeoutMs: number;
	/** Marker for synthetic handoff tools. */
	readonly kind: "tool" | "handoff";
	/** For handoff tools — target agent name. */
	readonly handoffTarget?: string;
}

export interface DefineAgentOptions {
	name: string;
	model: string;
	provider: Gateway;
	instructions?: string;
	tools?: Tool[];
	stopWhen?: StopWhen;
	hooks?: AgentHooks;
}

export interface RunArgs {
	messages: Message[];
	context?: Partial<Pick<RunContext, "user">> & { signal?: AbortSignal };
}

export interface RunResult {
	text: string;
	messages: Message[];
	usage: TokenUsage;
	stopReason: StopReason;
}

export interface Agent {
	readonly name: string;
	readonly model: string;
	readonly tools: ReadonlyArray<Tool>;
	run(args: RunArgs): Promise<RunResult>;
	stream(args: RunArgs): AsyncIterable<AgentEvent>;
}

export type { AgentEvent } from "./events";
export type { ChatMessage, Gateway, GatewayToolCall, TokenUsage } from "@workkit/ai-gateway";
