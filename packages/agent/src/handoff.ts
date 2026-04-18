import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ToolNameCollisionError } from "./errors";
import type { Agent, Tool } from "./types";

const HANDOFF_PREFIX = "handoff_";
const DEFAULT_HOP_LIMIT = 3;

interface HandoffInput {
	reason?: string;
}

const handoffInputSchema: StandardSchemaV1<HandoffInput> = {
	"~standard": {
		version: 1,
		vendor: "@workkit/agent",
		validate: (value: unknown) => {
			if (value === undefined || value === null) return { value: {} };
			if (typeof value !== "object") {
				return { issues: [{ message: "handoff input must be an object", path: [] }] };
			}
			const obj = value as Record<string, unknown>;
			if (obj.reason !== undefined && typeof obj.reason !== "string") {
				return { issues: [{ message: "reason must be a string when supplied", path: ["reason"] }] };
			}
			return { value: { reason: typeof obj.reason === "string" ? obj.reason : undefined } };
		},
	},
};

export interface HandoffOptions {
	/** Free-form description shown to the model alongside the synthetic tool. */
	when?: string;
	description?: string;
}

/**
 * Create a synthetic handoff tool that, when called by the model, yields
 * control to `target`. The actual switch is performed by the loop based on
 * the tool's `kind` and `handoffTarget`.
 */
export function handoff(
	target: Pick<Agent, "name">,
	options: HandoffOptions = {},
): Tool<HandoffInput, string> {
	const description =
		options.description ??
		`Hand off to the "${target.name}" agent${options.when ? ` when: ${options.when}` : ""}.`;
	return {
		name: `${HANDOFF_PREFIX}${target.name}`,
		description,
		input: handoffInputSchema,
		handler: async (input) =>
			`handing off to ${target.name}${input.reason ? `: ${input.reason}` : ""}`,
		timeoutMs: 5_000,
		kind: "handoff",
		handoffTarget: target.name,
	};
}

export const HANDOFF_HOP_LIMIT = DEFAULT_HOP_LIMIT;

/**
 * Throws ToolNameCollisionError if any tool name appears more than once in
 * the union of own tools + handoff target tools (transitively shallow:
 * we only inspect direct targets, not their nested handoffs).
 */
export function assertNoToolCollisions(tools: ReadonlyArray<Tool>): void {
	const seen = new Map<string, "self" | "handoff">();
	for (const t of tools) {
		const source = t.kind === "handoff" ? "handoff" : "self";
		if (seen.has(t.name)) {
			throw new ToolNameCollisionError(t.name, source);
		}
		seen.set(t.name, source);
	}
}
