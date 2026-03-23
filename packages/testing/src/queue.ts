import { type MockOperations, createOperationTracker } from "./observable";

interface MockMessage {
	body: unknown;
	contentType?: string;
}

/**
 * In-memory Queue mock for unit testing.
 */
export function createMockQueue(): Queue & { _messages: MockMessage[] } & MockOperations {
	const messages: MockMessage[] = [];
	const tracker = createOperationTracker();

	return {
		_messages: messages,
		get operations() {
			return tracker.operations;
		},
		reads: tracker.reads.bind(tracker),
		writes: tracker.writes.bind(tracker),
		deletes: tracker.deletes.bind(tracker),
		reset: tracker.reset.bind(tracker),

		async send(message: unknown, options?: { contentType?: string }): Promise<void> {
			tracker._record("write");
			messages.push({
				body: message,
				contentType: options?.contentType,
			});
		},

		async sendBatch(batch: Array<{ body: unknown; contentType?: string }>): Promise<void> {
			tracker._record("write");
			for (const item of batch) {
				messages.push({
					body: item.body,
					contentType: item.contentType,
				});
			}
		},
	} as any;
}
