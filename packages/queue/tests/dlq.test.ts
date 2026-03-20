import { describe, it, expect, beforeEach } from 'vitest'
import { createDLQProcessor } from '../src/dlq'
import { createMockMessage, createMockBatch, resetMessageIdCounter } from './helpers/mock-queue'

type UserEvent = { type: 'created' | 'updated'; userId: string }

describe('createDLQProcessor()', () => {
	beforeEach(() => {
		resetMessageIdCounter()
	})

	it('processes each dead letter message', async () => {
		const processed: UserEvent[] = []
		const handler = createDLQProcessor<UserEvent>({
			async process(message) {
				processed.push(message.body)
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'updated', userId: '2' }),
		]
		const batch = createMockBatch('dlq', messages)

		await handler(batch as any, {} as any)

		expect(processed).toEqual([
			{ type: 'created', userId: '1' },
			{ type: 'updated', userId: '2' },
		])
	})

	it('provides metadata about the dead letter', async () => {
		const metadataReceived: any[] = []
		const handler = createDLQProcessor<UserEvent>({
			async process(message, metadata) {
				metadataReceived.push(metadata)
			},
		})

		const msg = createMockMessage<UserEvent>(
			{ type: 'created', userId: '1' },
			{ attempts: 5 },
		)
		const batch = createMockBatch('dlq', [msg])

		await handler(batch as any, {} as any)

		expect(metadataReceived).toHaveLength(1)
		expect(metadataReceived[0].attempts).toBe(5)
		expect(metadataReceived[0].queue).toBe('dlq')
		expect(metadataReceived[0].messageId).toBe(msg.id)
	})

	it('acks messages after processing', async () => {
		const handler = createDLQProcessor<UserEvent>({
			async process() {},
		})

		const msg = createMockMessage<UserEvent>({ type: 'created', userId: '1' })
		const batch = createMockBatch('dlq', [msg])

		await handler(batch as any, {} as any)

		expect(msg._acked).toBe(true)
	})

	it('retries messages that fail processing', async () => {
		const handler = createDLQProcessor<UserEvent>({
			async process() {
				throw new Error('DLQ processing failed')
			},
		})

		const msg = createMockMessage<UserEvent>({ type: 'created', userId: '1' })
		const batch = createMockBatch('dlq', [msg])

		await handler(batch as any, {} as any)

		expect(msg._retried).toBe(true)
	})

	it('calls onError when processing fails', async () => {
		const errors: unknown[] = []
		const handler = createDLQProcessor<UserEvent>({
			async process() {
				throw new Error('DLQ boom')
			},
			onError(error) {
				errors.push(error)
			},
		})

		const msg = createMockMessage<UserEvent>({ type: 'created', userId: '1' })
		const batch = createMockBatch('dlq', [msg])

		await handler(batch as any, {} as any)

		expect(errors).toHaveLength(1)
	})

	it('handles empty batch', async () => {
		const handler = createDLQProcessor<UserEvent>({
			async process() {},
		})

		const batch = createMockBatch<UserEvent>('dlq', [])
		await handler(batch as any, {} as any)
	})

	it('acks on success even when onSuccess is provided', async () => {
		const successes: string[] = []
		const handler = createDLQProcessor<UserEvent>({
			async process(message) {
				successes.push(message.body.userId)
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'created', userId: '2' }),
		]
		const batch = createMockBatch('dlq', messages)

		await handler(batch as any, {} as any)

		expect(successes).toEqual(['1', '2'])
		expect(messages[0]._acked).toBe(true)
		expect(messages[1]._acked).toBe(true)
	})

	it('continues processing other messages when one fails', async () => {
		const processed: string[] = []
		const handler = createDLQProcessor<UserEvent>({
			async process(message) {
				if (message.body.userId === '2') throw new Error('fail')
				processed.push(message.body.userId)
			},
		})

		const messages = [
			createMockMessage<UserEvent>({ type: 'created', userId: '1' }),
			createMockMessage<UserEvent>({ type: 'created', userId: '2' }),
			createMockMessage<UserEvent>({ type: 'created', userId: '3' }),
		]
		const batch = createMockBatch('dlq', messages)

		await handler(batch as any, {} as any)

		expect(processed).toEqual(['1', '3'])
		expect(messages[0]._acked).toBe(true)
		expect(messages[1]._retried).toBe(true)
		expect(messages[2]._acked).toBe(true)
	})
})
