import { describe, it } from 'vitest'
import { expectTypeOf } from 'expect-type'
import type {
	TypedQueueProducer,
	ConsumerOptions,
	BatchConsumerOptions,
	ConsumerHandler,
	DLQMetadata,
	DLQProcessorOptions,
	RetryDelayAction,
} from '../src/types'

type UserEvent = { type: 'created' | 'updated'; userId: string }

describe('TypedQueueProducer type', () => {
	it('send() accepts the generic body type', () => {
		expectTypeOf<TypedQueueProducer<UserEvent>['send']>()
			.parameter(0)
			.toEqualTypeOf<UserEvent>()
	})

	it('sendBatch() accepts array of typed send requests', () => {
		expectTypeOf<TypedQueueProducer<UserEvent>['sendBatch']>()
			.parameter(0)
			.toMatchTypeOf<Iterable<{ body: UserEvent }>>()
	})

	it('raw property exposes the underlying queue', () => {
		expectTypeOf<TypedQueueProducer<UserEvent>['raw']>()
			.toBeObject()
	})
})

describe('ConsumerOptions type', () => {
	it('process function receives typed message', () => {
		type Opts = ConsumerOptions<UserEvent>
		expectTypeOf<Opts['process']>()
			.toBeFunction()
	})

	it('filter function receives typed message', () => {
		type Opts = ConsumerOptions<UserEvent>
		expectTypeOf<NonNullable<Opts['filter']>>()
			.toBeFunction()
	})

	it('maxRetries is optional number', () => {
		expectTypeOf<ConsumerOptions<UserEvent>['maxRetries']>()
			.toEqualTypeOf<number | undefined>()
	})

	it('onFiltered is optional ack or retry', () => {
		expectTypeOf<ConsumerOptions<UserEvent>['onFiltered']>()
			.toEqualTypeOf<'ack' | 'retry' | undefined>()
	})

	it('concurrency is optional number', () => {
		expectTypeOf<ConsumerOptions<UserEvent>['concurrency']>()
			.toEqualTypeOf<number | undefined>()
	})
})

describe('BatchConsumerOptions type', () => {
	it('processBatch function receives typed messages array', () => {
		type Opts = BatchConsumerOptions<UserEvent>
		expectTypeOf<Opts['processBatch']>()
			.toBeFunction()
	})

	it('retryAll is optional boolean', () => {
		expectTypeOf<BatchConsumerOptions<UserEvent>['retryAll']>()
			.toEqualTypeOf<boolean | undefined>()
	})
})

describe('ConsumerHandler type', () => {
	it('is a function that accepts batch and env', () => {
		expectTypeOf<ConsumerHandler<UserEvent>>()
			.toBeFunction()
	})

	it('returns a promise', () => {
		expectTypeOf<ConsumerHandler<UserEvent>>()
			.returns.toEqualTypeOf<Promise<void>>()
	})
})

describe('DLQMetadata type', () => {
	it('has queue string', () => {
		expectTypeOf<DLQMetadata['queue']>().toBeString()
	})

	it('has attempts number', () => {
		expectTypeOf<DLQMetadata['attempts']>().toBeNumber()
	})

	it('has messageId string', () => {
		expectTypeOf<DLQMetadata['messageId']>().toBeString()
	})

	it('has timestamp Date', () => {
		expectTypeOf<DLQMetadata['timestamp']>().toEqualTypeOf<Date>()
	})
})

describe('DLQProcessorOptions type', () => {
	it('process receives message and metadata', () => {
		type Opts = DLQProcessorOptions<UserEvent>
		expectTypeOf<Opts['process']>().toBeFunction()
	})
})

describe('RetryDelayAction type', () => {
	it('has action and delaySeconds', () => {
		expectTypeOf<RetryDelayAction['action']>().toEqualTypeOf<'retry'>()
		expectTypeOf<RetryDelayAction['delaySeconds']>().toBeNumber()
	})
})
