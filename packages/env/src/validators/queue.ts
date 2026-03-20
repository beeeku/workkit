import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface QueueValidatorOptions {
	/** Custom error message when binding is missing or invalid */
	message?: string;
}

/**
 * Creates a Standard Schema validator for Queue bindings.
 *
 * @example
 * ```ts
 * import { queue } from '@workkit/env/validators'
 * const schema = { TASK_QUEUE: queue() }
 * ```
 */
export function queue(options?: QueueValidatorOptions): StandardSchemaV1<Queue, Queue> {
	return {
		"~standard": {
			version: 1,
			vendor: "workkit",
			validate(value): StandardSchemaV1.Result<Queue> {
				if (!isQueue(value)) {
					return {
						issues: [
							{
								message:
									options?.message ??
									"Expected a Queue binding. Ensure this binding is configured in wrangler.toml under [[queues.producers]].",
							},
						],
					};
				}
				return { value: value as Queue };
			},
		},
	};
}

function isQueue(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return typeof obj.send === "function" && typeof obj.sendBatch === "function";
}
