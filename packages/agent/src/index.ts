// Tool factory
export { tool } from "./tool";
export type { DefineToolOptions } from "./tool";

// Agent
export { defineAgent } from "./agent";

// Handoff
export { handoff, HANDOFF_HOP_LIMIT, assertNoToolCollisions } from "./handoff";
export type { HandoffOptions } from "./handoff";

// Errors
export {
	BudgetExceededError,
	HandoffCycleError,
	ToolNameCollisionError,
	ToolValidationError,
} from "./errors";

// Schema bridge
export { toJsonSchema } from "./schema";

// Public types
export type {
	Agent,
	AgentEvent,
	AgentHooks,
	DefineAgentOptions,
	Message,
	RunArgs,
	RunContext,
	RunResult,
	StopReason,
	StopWhen,
	Tool,
	ToolCtx,
} from "./types";
