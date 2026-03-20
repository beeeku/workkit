interface MockMessage {
	body: unknown;
	contentType?: string;
}

/**
 * In-memory Queue mock for unit testing.
 */
export function createMockQueue(): Queue & { _messages: MockMessage[] } {
	const messages: MockMessage[] = [];

	return {
		_messages: messages,

		async send(message: unknown, options?: { contentType?: string }): Promise<void> {
			messages.push({
				body: message,
				contentType: options?.contentType,
			});
		},

		async sendBatch(batch: Array<{ body: unknown; contentType?: string }>): Promise<void> {
			for (const item of batch) {
				messages.push({
					body: item.body,
					contentType: item.contentType,
				});
			}
		},
	} as any;
}
