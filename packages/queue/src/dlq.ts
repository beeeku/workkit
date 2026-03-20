import type { TypedMessageBatch } from "@workkit/types";
import type { ConsumerHandler, ConsumerMessage, DLQMetadata, DLQProcessorOptions } from "./types";

/**
 * Create a dead letter queue processor.
 *
 * Provides metadata about the original message (queue name, attempts, etc.)
 * alongside the message body for logging, alerting, or manual intervention.
 *
 * @example
 * ```ts
 * const dlqHandler = createDLQProcessor<UserEvent>({
 *   async process(message, metadata) {
 *     await alertOncall(message.body, metadata)
 *   },
 * })
 * ```
 */
export function createDLQProcessor<Body>(
	options: DLQProcessorOptions<Body>,
): ConsumerHandler<Body> {
	const { process, onError } = options;

	return async (batch: TypedMessageBatch<Body>, _env: unknown): Promise<void> => {
		const messages = batch.messages as unknown as ConsumerMessage<Body>[];

		for (const message of messages) {
			const metadata: DLQMetadata = {
				queue: batch.queue,
				attempts: message.attempts,
				messageId: message.id,
				timestamp: message.timestamp,
			};

			try {
				await process(message, metadata);
				message.ack();
			} catch (error) {
				if (onError) {
					onError(error, message);
				}
				message.retry();
			}
		}
	};
}
