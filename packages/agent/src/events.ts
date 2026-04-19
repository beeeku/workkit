import type { GatewayToolCall, TokenUsage } from "@workkit/ai-gateway";
import type { Message, StopReason } from "./types";

export type AgentEvent =
	| { type: "step-start"; step: number; agent: string }
	| { type: "text-delta"; delta: string; step: number }
	| { type: "tool-start"; call: GatewayToolCall; step: number }
	| { type: "tool-end"; call: GatewayToolCall; result: string; isError: boolean; step: number }
	| { type: "handoff"; from: string; to: string; step: number }
	| { type: "step-complete"; step: number; usage: TokenUsage; assistant: Message }
	| { type: "tool-rejected"; call: GatewayToolCall; reason: "off-palette"; step: number }
	| {
			type: "error";
			error: { kind: "tool" | "provider" | "hook" | "config"; toolName?: string; message: string };
	  }
	| { type: "done"; stopReason: StopReason; usage: TokenUsage };
