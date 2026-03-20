import { describe, it, expect, beforeEach } from 'vitest'
import { createConsumer } from '../src/consumer'
import { RetryAction } from '../src/retry'
import { createMockMessage, createMockBatch, resetMessageIdCounter } from './helpers/mock-queue'

type TaskEvent = { taskId: string; action: string }

describe('RetryAction enum', () => {
	it('has RETRY value', () => {
		expect(RetryAction.RETRY).toBe('retry')
	})

	it('has ACK value', () => {
		expect(RetryAction.ACK).toBe('ack')
	})

	it('has DEAD_LETTER value', () => {
		expect(RetryAction.DEAD_LETTER).toBe('dead_letter')
	})
})

describe('RetryAction.RETRY_DELAY()', () => {
	it('creates a retry delay action', () => {
		const action = RetryAction.RETRY_DELAY(30)
		expect(action).toEqual({ action: 'retry', delaySeconds: 30 })
	})

	it('creates delay action with different values', () => {
		const action = RetryAction.RETRY_DELAY(60)
		expect(action.delaySeconds).toBe(60)
	})
})

describe('createConsumer with RetryAction', () => {
	beforeEach(() => {
		resetMessageIdCounter()
	})

	it('retries message when process returns RETRY', async () => {
		const handler = createConsumer<TaskEvent>({
			async process() {
				return RetryAction.RETRY
			},
		})

		const msg = createMockMessage<TaskEvent>({ taskId: '1', action: 'run' })
		const batch = createMockBatch('tasks', [msg])

		await handler(batch as any, {} as any)

		expect(msg._retried).toBe(true)
		expect(msg._acked).toBe(false)
	})

	it('acks message when process returns ACK', async () => {
		const handler = createConsumer<TaskEvent>({
			async process() {
				return RetryAction.ACK
			},
		})

		const msg = createMockMessage<TaskEvent>({ taskId: '1', action: 'run' })
		const batch = createMockBatch('tasks', [msg])

		await handler(batch as any, {} as any)

		expect(msg._acked).toBe(true)
		expect(msg._retried).toBe(false)
	})

	it('retries with delay when process returns RETRY_DELAY', async () => {
		const handler = createConsumer<TaskEvent>({
			async process() {
				return RetryAction.RETRY_DELAY(45)
			},
		})

		const msg = createMockMessage<TaskEvent>({ taskId: '1', action: 'run' })
		const batch = createMockBatch('tasks', [msg])

		await handler(batch as any, {} as any)

		expect(msg._retried).toBe(true)
		expect(msg._retryOptions).toEqual({ delaySeconds: 45 })
	})

	it('sends to DLQ when process returns DEAD_LETTER', async () => {
		const dlqProducer = {
			_sent: [] as any[],
			async send(body: any) { dlqProducer._sent.push(body) },
			async sendBatch() {},
		}

		const handler = createConsumer<TaskEvent>({
			async process() {
				return RetryAction.DEAD_LETTER
			},
			deadLetterQueue: dlqProducer as any,
		})

		const msg = createMockMessage<TaskEvent>({ taskId: '1', action: 'run' })
		const batch = createMockBatch('tasks', [msg])

		await handler(batch as any, {} as any)

		expect(msg._acked).toBe(true)
		expect(dlqProducer._sent).toHaveLength(1)
	})

	it('acks when DEAD_LETTER returned but no DLQ configured', async () => {
		const handler = createConsumer<TaskEvent>({
			async process() {
				return RetryAction.DEAD_LETTER
			},
		})

		const msg = createMockMessage<TaskEvent>({ taskId: '1', action: 'run' })
		const batch = createMockBatch('tasks', [msg])

		await handler(batch as any, {} as any)

		expect(msg._acked).toBe(true)
	})

	it('acks when process returns void (success)', async () => {
		const handler = createConsumer<TaskEvent>({
			async process() {
				// no return = success
			},
		})

		const msg = createMockMessage<TaskEvent>({ taskId: '1', action: 'run' })
		const batch = createMockBatch('tasks', [msg])

		await handler(batch as any, {} as any)

		expect(msg._acked).toBe(true)
	})
})
