import { BindingNotFoundError } from "@workkit/errors";
import type {
	QueueSendBatchOptions,
	QueueSendOptions,
	TypedMessageSendRequest,
	TypedQueue,
} from "@workkit/types";
import type { TypedQueueProducer } from "./types";

/**
 * Create a typed queue producer from a Cloudflare Queue binding.
 *
 * @example
 * ```ts
 * const events = queue<UserEvent>(env.USER_EVENTS)
 * await events.send({ type: 'created', userId: '123' })
 * ```
 */
export function queue<Body>(binding: TypedQueue<Body>): TypedQueueProducer<Body> {
	if (binding == null) {
		throw new BindingNotFoundError("Queue binding is null or undefined", {
			context: { bindingType: "Queue" },
		});
	}

	return {
		async send(body: Body, options?: QueueSendOptions): Promise<void> {
			await binding.send(body, options);
		},

		async sendBatch(
			messages: Iterable<TypedMessageSendRequest<Body>>,
			options?: QueueSendBatchOptions,
		): Promise<void> {
			await binding.sendBatch(messages, options);
		},

		get raw(): TypedQueue<Body> {
			return binding;
		},
	};
}
