import { type ErrorInjection, createErrorInjector } from "./error-injection";
import { type MockOperations, createOperationTracker } from "./observable";

interface MockMessage {
	body: unknown;
	contentType?: string;
}

/**
 * In-memory Queue mock for unit testing.
 */
export function createMockQueue(): Queue & { _messages: MockMessage[] } & MockOperations & ErrorInjection {
	const messages: MockMessage[] = [];
	const tracker = createOperationTracker();
	const injector = createErrorInjector();

	return {
		_messages: messages,
		get operations() {
			return tracker.operations;
		},
		reads: tracker.reads.bind(tracker),
		writes: tracker.writes.bind(tracker),
		deletes: tracker.deletes.bind(tracker),
		reset: tracker.reset.bind(tracker),
		failAfter: injector.failAfter.bind(injector),
		failOn: injector.failOn.bind(injector),
		withLatency: injector.withLatency.bind(injector),
		clearInjections: injector.clearInjections.bind(injector),

		async send(message: unknown, options?: { contentType?: string }): Promise<void> {
			await injector._check();
			tracker._record("write");
			messages.push({
				body: message,
				contentType: options?.contentType,
			});
		},

		async sendBatch(batch: Array<{ body: unknown; contentType?: string }>): Promise<void> {
			await injector._check();
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
