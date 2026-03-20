import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createConsumer, createBatchConsumer } from '../src/consumer'
import { createMockMessage, createMockBatch, resetMessageIdCounter } from './helpers/mock-queue'

type UserEvent = { type: 'created' | 'updated' | 'deleted'; userId: string }

describe('createConsumer()', () => {
	beforeEach(() => {
		resetMessageIdCounter()
	})

	it('processes each message in a batch', async () => {
		const processed: UserEvent[] = []
		const handler = createConsumer<UserEvent>({
			async process(message) {
				processed.push(message.body)
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(processed).toEqual([
			{ type: 'created', userId: '1' },
			{ type: 'updated', userId: '2' },
		])
	})

	it('acks messages on successful processing', async () => {
		const handler = createConsumer<UserEvent>({
			async process() {
				// success
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._acked).toBe(true)
		expect(messages[1]._acked).toBe(true)
	})

	it('retries messages on processing failure', async () => {
		const handler = createConsumer<UserEvent>({
			async process(message) {
				if (message.body.userId === '2') throw new Error('fail')
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._acked).toBe(true)
		expect(messages[1]._retried).toBe(true)
	})

	it('respects maxRetries and acks after exceeding', async () => {
		const handler = createConsumer<UserEvent>({
			async process() {
				throw new Error('always fails')
			},
			maxRetries: 3,
		})

		const msg = createMockMessage<UserEvent>(
			{ type: 'created', userId: '1' },
			{ attempts: 4 },
		)
		const batch = createMockBatch('test-queue', [msg])

		await handler(batch as any, {} as any)

		// Exceeded maxRetries — should ack (discard)
		expect(msg._acked).toBe(true)
		expect(msg._retried).toBe(false)
	})

	it('retries when under maxRetries', async () => {
		const handler = createConsumer<UserEvent>({
			async process() {
				throw new Error('fails')
			},
			maxRetries: 3,
		})

		const msg = createMockMessage<UserEvent>(
			{ type: 'created', userId: '1' },
			{ attempts: 2 },
		)
		const batch = createMockBatch('test-queue', [msg])

		await handler(batch as any, {} as any)

		expect(msg._retried).toBe(true)
		expect(msg._acked).toBe(false)
	})

	it('sends to dead letter queue after maxRetries', async () => {
		const dlqProducer = {
			_sent: [] as any[],
			async send(body: any) { dlqProducer._sent.push(body) },
			async sendBatch() {},
		}

		const handler = createConsumer<UserEvent>({
			async process() {
				throw new Error('always fails')
			},
			maxRetries: 2,
			deadLetterQueue: dlqProducer as any,
		})

		const msg = createMockMessage<UserEvent>(
			{ type: 'created', userId: '1' },
			{ attempts: 3 },
		)
		const batch = createMockBatch('test-queue', [msg])

		await handler(batch as any, {} as any)

		expect(msg._acked).toBe(true)
		expect(dlqProducer._sent).toHaveLength(1)
		expect(dlqProducer._sent[0]).toEqual({ type: 'created', userId: '1' })
	})

	it('calls onError callback when processing fails', async () => {
		const errors: { error: unknown; messageId: string }[] = []
		const handler = createConsumer<UserEvent>({
			async process() {
				throw new Error('boom')
			},
			onError(error, message) {
				errors.push({ error, messageId: message.id })
			},
		})

		const msg = createMockMessage<UserEvent>({ type: 'created', userId: '1' })
		const batch = createMockBatch('test-queue', [msg])

		await handler(batch as any, {} as any)

		expect(errors).toHaveLength(1)
		expect(errors[0].error).toBeInstanceOf(Error)
	})

	it('handles empty batch gracefully', async () => {
		const handler = createConsumer<UserEvent>({
			async process() {},
		})

		const batch = createMockBatch<UserEvent>('test-queue', [])
		await handler(batch as any, {} as any)
		// No error thrown
	})

	it('processes messages concurrently when concurrency > 1', async () => {
		const order: string[] = []
		const handler = createConsumer<UserEvent>({
			async process(message) {
				if (message.body.userId === '1') {
					await new Promise(r => setTimeout(r, 20))
				}
				order.push(message.body.userId)
			},
			concurrency: 2,
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'created', userId: '2' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		// With concurrency, message 2 should finish before message 1
		expect(order).toEqual(['2', '1'])
	})
})

describe('createConsumer() — filtering', () => {
	beforeEach(() => {
		resetMessageIdCounter()
	})

	it('only processes messages matching the filter', async () => {
		const processed: UserEvent[] = []
		const handler = createConsumer<UserEvent>({
			filter: (msg) => msg.body.type === 'created',
			async process(message) {
				processed.push(message.body)
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
			createMockMessage<UserEvent>({ type: 'created', userId: '3' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(processed).toHaveLength(2)
		expect(processed[0].userId).toBe('1')
		expect(processed[1].userId).toBe('3')
	})

	it('acks filtered-out messages by default', async () => {
		const handler = createConsumer<UserEvent>({
			filter: (msg) => msg.body.type === 'created',
			async process() {},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'updated', userId: '1' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._acked).toBe(true)
	})

	it('retries filtered-out messages when onFiltered is "retry"', async () => {
		const handler = createConsumer<UserEvent>({
			filter: (msg) => msg.body.type === 'created',
			onFiltered: 'retry',
			async process() {},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'updated', userId: '1' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._retried).toBe(true)
		expect(messages[0]._acked).toBe(false)
	})
})

describe('createBatchConsumer()', () => {
	beforeEach(() => {
		resetMessageIdCounter()
	})

	it('processes the entire batch at once', async () => {
		let receivedBodies: UserEvent[] = []
		const handler = createBatchConsumer<UserEvent>({
			async processBatch(messages) {
				receivedBodies = messages.map(m => m.body)
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(receivedBodies).toEqual([
			{ type: 'created', userId: '1' },
			{ type: 'updated', userId: '2' },
		])
	})

	it('acks all on success', async () => {
		const handler = createBatchConsumer<UserEvent>({
			async processBatch() {},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._acked).toBe(true)
		expect(messages[1]._acked).toBe(true)
	})

	it('retries all on failure when retryAll is true', async () => {
		const handler = createBatchConsumer<UserEvent>({
			async processBatch() {
				throw new Error('batch failed')
			},
			retryAll: true,
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._retried).toBe(true)
		expect(messages[1]._retried).toBe(true)
	})

	it('retries all on failure by default', async () => {
		const handler = createBatchConsumer<UserEvent>({
			async processBatch() {
				throw new Error('batch failed')
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._retried).toBe(true)
	})

	it('acks all on failure when retryAll is false', async () => {
		const handler = createBatchConsumer<UserEvent>({
			async processBatch() {
				throw new Error('batch failed')
			},
			retryAll: false,
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(messages[0]._acked).toBe(true)
	})

	it('calls onError on batch failure', async () => {
		const errors: unknown[] = []
		const handler = createBatchConsumer<UserEvent>({
			async processBatch() {
				throw new Error('batch boom')
			},
			onError(error) {
				errors.push(error)
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
		]
		const batch = createMockBatch('test-queue', messages)

		await handler(batch as any, {} as any)

		expect(errors).toHaveLength(1)
		expect(errors[0]).toBeInstanceOf(Error)
	})

	it('handles empty batch', async () => {
		const handler = createBatchConsumer<UserEvent>({
			async processBatch() {},
		})

		const batch = createMockBatch<UserEvent>('test-queue', [])
		await handler(batch as any, {} as any)
	})
})
