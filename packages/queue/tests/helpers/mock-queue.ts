/**
 * In-memory mock implementations of Cloudflare Queue types for testing.
 */

export interface MockMessage<Body = unknown> {
	readonly id: string;
	readonly timestamp: Date;
	readonly body: Body;
	readonly attempts: number;
	_acked: boolean;
	_retried: boolean;
	_retryOptions?: { delaySeconds?: number };
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export interface MockMessageBatch<Body = unknown> {
	readonly queue: string;
	readonly messages: MockMessage<Body>[];
	ackAll(): void;
	retryAll(options?: { delaySeconds?: number }): void;
}

export interface MockQueueProducer<Body = unknown> {
	_sent: { body: Body; options?: { contentType?: string; delaySeconds?: number } }[];
	_batchSent: { body: Body; contentType?: string; delaySeconds?: number }[][];
	send(body: Body, options?: { contentType?: string; delaySeconds?: number }): Promise<void>;
	sendBatch(
		messages: Iterable<{ body: Body; contentType?: string; delaySeconds?: number }>,
		options?: { delaySeconds?: number },
	): Promise<void>;
}

let messageIdCounter = 0;

export function createMockMessage<Body>(
	body: Body,
	overrides?: Partial<{ id: string; timestamp: Date; attempts: number }>,
): MockMessage<Body> {
	const msg: MockMessage<Body> = {
		id: overrides?.id ?? `msg-${++messageIdCounter}`,
		timestamp: overrides?.timestamp ?? new Date(),
		body,
		attempts: overrides?.attempts ?? 1,
		_acked: false,
		_retried: false,
		_retryOptions: undefined,
		ack() {
			msg._acked = true;
		},
		retry(options) {
			msg._retried = true;
			msg._retryOptions = options;
		},
	};
	return msg;
}

export function createMockBatch<Body>(
	queueName: string,
	messages: MockMessage<Body>[],
): MockMessageBatch<Body> {
	return {
		queue: queueName,
		messages,
		ackAll() {
			for (const msg of messages) msg.ack();
		},
		retryAll(options) {
			for (const msg of messages) msg.retry(options);
		},
	};
}

export function createMockProducer<Body = unknown>(): MockQueueProducer<Body> {
	const producer: MockQueueProducer<Body> = {
		_sent: [],
		_batchSent: [],
		async send(body, options) {
			producer._sent.push({ body, options });
		},
		async sendBatch(messages, _options) {
			const batch = [...messages];
			producer._batchSent.push(batch);
		},
	};
	return producer;
}

export function resetMessageIdCounter() {
	messageIdCounter = 0;
}
