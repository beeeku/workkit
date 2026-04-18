import { ConfigError, ValidationError, WorkkitError } from "@workkit/errors";
import type { RetryStrategy } from "@workkit/errors";

export class ToolValidationError extends ValidationError {
	constructor(toolName: string, issues: Array<{ path: PropertyKey[]; message: string }>) {
		super(
			`tool "${toolName}" rejected input`,
			issues.map((i) => ({
				path: i.path.map(String),
				message: i.message,
			})),
		);
	}
}

export class ToolNameCollisionError extends ConfigError {
	constructor(name: string, source: "self" | "handoff") {
		super(
			`tool name "${name}" is registered more than once (source: ${source}). Tool names must be unique within an agent and across handoff targets.`,
		);
	}
}

export class HandoffCycleError extends WorkkitError {
	readonly code = "WORKKIT_AGENT_HANDOFF_CYCLE" as const;
	readonly statusCode = 500;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	constructor(agentName: string, hopLimit: number, agentPath: readonly string[]) {
		super(
			`handoff cycle detected: agent "${agentName}" entered ${hopLimit + 1}× (path: ${agentPath.join(" → ")})`,
			{ context: { agentName, hopLimit, agentPath: [...agentPath] } },
		);
	}
}

export class BudgetExceededError extends WorkkitError {
	readonly code = "WORKKIT_AGENT_BUDGET" as const;
	readonly statusCode = 429;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	constructor(kind: "max_steps" | "max_tokens", limit: number) {
		super(`agent budget exceeded: ${kind} >= ${limit}`, { context: { kind, limit } });
	}
}
