import type { TypedMessageBatch } from "@workkit/types";
import { RetryAction, isRetryDelayAction } from "./retry";
import type {
	BatchConsumerOptions,
	ConsumerHandler,
	ConsumerMessage,
	ConsumerOptions,
} from "./types";

/**
 * Create a per-message consumer handler for Cloudflare Workers Queues.
 *
 * @example
 * ```ts
 * const handler = createConsumer<UserEvent>({
 *   async process(message) {
 *     await handleUserEvent(message.body)
 *   },
 *   maxRetries: 3,
 * })
 *
 * export default {
 *   async queue(batch, env) {
 *     await handler(batch, env)
 *   }
 * }
 * ```
 */
export function createConsumer<Body>(options: ConsumerOptions<Body>): ConsumerHandler<Body> {
	const {
		process,
		filter,
		onFiltered = "ack",
		maxRetries,
		deadLetterQueue,
		onError,
		concurrency = 1,
	} = options;

	return async (batch: TypedMessageBatch<Body>, _env: unknown): Promise<void> => {
		const messages = batch.messages as unknown as ConsumerMessage<Body>[];

		const processMessage = async (message: ConsumerMessage<Body>) => {
			// Apply filter
			if (filter && !filter(message)) {
				if (onFiltered === "retry") {
					message.retry();
				} else {
					message.ack();
				}
				return;
			}

			// Check maxRetries
			if (maxRetries != null && message.attempts > maxRetries) {
				// Exceeded retries — send to DLQ or ack
				if (deadLetterQueue) {
					await deadLetterQueue.send(message.body);
				}
				message.ack();
				return;
			}

			try {
				const result = await process(message);

				// Handle retry action returns
				if (result === RetryAction.RETRY) {
					message.retry();
				} else if (result === RetryAction.ACK) {
					message.ack();
				} else if (result === RetryAction.DEAD_LETTER) {
					if (deadLetterQueue) {
						await deadLetterQueue.send(message.body);
					}
					message.ack();
				} else if (isRetryDelayAction(result)) {
					message.retry({ delaySeconds: result.delaySeconds });
				} else {
					// void return = success
					message.ack();
				}
			} catch (error) {
				if (onError) {
					await onError(error, message);
				}

				// Check if we've exceeded maxRetries on error
				if (maxRetries != null && message.attempts >= maxRetries) {
					if (deadLetterQueue) {
						await deadLetterQueue.send(message.body);
					}
					message.ack();
				} else {
					message.retry();
				}
			}
		};

		if (concurrency <= 1) {
			// Sequential processing
			for (const message of messages) {
				await processMessage(message);
			}
		} else {
			// Concurrent processing with limit
			const chunks: ConsumerMessage<Body>[][] = [];
			for (let i = 0; i < messages.length; i += concurrency) {
				chunks.push(messages.slice(i, i + concurrency));
			}
			for (const chunk of chunks) {
				await Promise.all(chunk.map(processMessage));
			}
		}
	};
}

/**
 * Create a batch consumer handler for Cloudflare Workers Queues.
 *
 * @example
 * ```ts
 * const handler = createBatchConsumer<UserEvent>({
 *   async processBatch(messages) {
 *     const events = messages.map(m => m.body)
 *     await bulkInsert(events)
 *   },
 *   retryAll: true,
 * })
 * ```
 */
export function createBatchConsumer<Body>(
	options: BatchConsumerOptions<Body>,
): ConsumerHandler<Body> {
	const { processBatch, retryAll = true, onError } = options;

	return async (batch: TypedMessageBatch<Body>, _env: unknown): Promise<void> => {
		const messages = batch.messages as unknown as ConsumerMessage<Body>[];

		try {
			await processBatch(messages);

			// Success — ack all
			for (const msg of messages) {
				msg.ack();
			}
		} catch (error) {
			if (onError) {
				onError(error);
			}

			if (retryAll) {
				for (const msg of messages) {
					msg.retry();
				}
			} else {
				// Don't retry — ack all (discard)
				for (const msg of messages) {
					msg.ack();
				}
			}
		}
	};
}
