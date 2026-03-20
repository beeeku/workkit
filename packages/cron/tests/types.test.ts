import { describe, it, expectTypeOf } from 'vitest'
import type {
  CronTask,
  CronTaskHandler,
  CronTaskMap,
  CronMiddleware,
  CronHandlerOptions,
  CronHandler,
  ParsedCron,
  CronField,
  LockOptions,
  LockKV,
  LockResult,
  RetryOptions,
  ErrorReporter,
} from '../src/types'
import type { ScheduledEvent, ExecutionContext } from '@workkit/types'

describe('type definitions', () => {
  it('CronTaskHandler accepts correct args', () => {
    expectTypeOf<CronTaskHandler<{ DB: string }>>().toBeCallableWith(
      {} as ScheduledEvent,
      { DB: 'test' },
      {} as ExecutionContext,
    )
  })

  it('CronTaskHandler returns void or Promise<void>', () => {
    expectTypeOf<CronTaskHandler>().returns.toEqualTypeOf<void | Promise<void>>()
  })

  it('CronTask has schedule and handler', () => {
    expectTypeOf<CronTask>().toHaveProperty('schedule')
    expectTypeOf<CronTask>().toHaveProperty('handler')
  })

  it('CronTaskMap is a record of CronTask', () => {
    expectTypeOf<CronTaskMap>().toMatchTypeOf<Record<string, CronTask>>()
  })

  it('CronMiddleware wraps a handler', () => {
    expectTypeOf<CronMiddleware>().toBeCallableWith(
      (() => {}) as CronTaskHandler,
      'task-name',
    )
  })

  it('CronHandler is an async function', () => {
    expectTypeOf<CronHandler>().returns.toEqualTypeOf<Promise<void>>()
  })

  it('ParsedCron has five fields', () => {
    expectTypeOf<ParsedCron>().toHaveProperty('minute')
    expectTypeOf<ParsedCron>().toHaveProperty('hour')
    expectTypeOf<ParsedCron>().toHaveProperty('dayOfMonth')
    expectTypeOf<ParsedCron>().toHaveProperty('month')
    expectTypeOf<ParsedCron>().toHaveProperty('dayOfWeek')
  })

  it('CronField is a Set<number>', () => {
    expectTypeOf<CronField>().toEqualTypeOf<Set<number>>()
  })

  it('LockOptions has optional ttl', () => {
    expectTypeOf<LockOptions>().toMatchTypeOf<{ ttl?: number }>()
  })

  it('LockKV has get, put, delete', () => {
    expectTypeOf<LockKV>().toHaveProperty('get')
    expectTypeOf<LockKV>().toHaveProperty('put')
    expectTypeOf<LockKV>().toHaveProperty('delete')
  })

  it('LockResult has acquired and release', () => {
    expectTypeOf<LockResult>().toHaveProperty('acquired')
    expectTypeOf<LockResult>().toHaveProperty('release')
  })

  it('CronHandlerOptions accepts env generic', () => {
    type Env = { DB: string }
    expectTypeOf<CronHandlerOptions<Env>>().toHaveProperty('tasks')
    expectTypeOf<CronHandlerOptions<Env>>().toHaveProperty('middleware')
    expectTypeOf<CronHandlerOptions<Env>>().toHaveProperty('onNoMatch')
  })
})
