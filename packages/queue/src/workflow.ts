import type { TypedMessageBatch } from "@workkit/types";
import type { ConsumerHandler, ConsumerMessage, WorkflowOptions } from "./types";

/**
 * Create a workflow consumer that executes linear step chains with context carrythrough.
 *
 * Each step receives the message body and accumulated context, returning
 * partial context that is merged forward to subsequent steps. On failure,
 * completed steps are rolled back in reverse order.
 *
 * @example
 * ```ts
 * const handler = createWorkflow<OrderEvent, { validated?: boolean; charged?: boolean }>({
 *   steps: [
 *     {
 *       name: "validate",
 *       async process(body, ctx) { return { validated: true } },
 *       async rollback(body, ctx) { await unreserve(body.orderId) },
 *     },
 *     {
 *       name: "charge",
 *       async process(body, ctx) { return { charged: true } },
 *       async rollback(body, ctx) { await refund(body.orderId) },
 *     },
 *   ],
 *   async onComplete(body, ctx) { await notify(body.orderId) },
 * })
 * ```
 */
export function createWorkflow<Body, Context = Record<string, unknown>>(
	options: WorkflowOptions<Body, Context>,
): ConsumerHandler<Body> {
	const { steps, onComplete, onError } = options;

	return async (batch: TypedMessageBatch<Body>, _env: unknown): Promise<void> => {
		const messages = batch.messages as unknown as ConsumerMessage<Body>[];

		for (const message of messages) {
			const body = message.body;
			let context = {} as Context;
			let completedStepCount = 0;
			let failed = false;

			try {
				for (const step of steps) {
					const partial = await step.process(body, context);
					context = { ...context, ...partial };
					completedStepCount++;
				}
			} catch (error) {
				failed = true;
				const failedStepName = steps[completedStepCount]?.name ?? "unknown";

				// Call onError callback
				if (onError) {
					await onError(error, failedStepName, body);
				}

				// Rollback completed steps in reverse order
				for (let i = completedStepCount - 1; i >= 0; i--) {
					const step = steps[i]!;
					if (step.rollback) {
						await step.rollback(body, context);
					}
				}

				// Retry the message
				message.retry();
			}

			if (!failed) {
				if (onComplete) {
					await onComplete(body, context);
				}
				message.ack();
			}
		}
	};
}
