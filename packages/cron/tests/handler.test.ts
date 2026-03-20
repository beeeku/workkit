import { describe, it, expect, vi } from 'vitest'
import { createCronHandler } from '../src/handler'
import { createMockEvent, createMockCtx } from './helpers/mock'

type TestEnv = { DB: string }

describe('createCronHandler()', () => {
  it('returns a function', () => {
    const handler = createCronHandler({ tasks: {} })
    expect(typeof handler).toBe('function')
  })

  it('calls the matching task handler', async () => {
    const spy = vi.fn()
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'my-task': {
          schedule: '0 * * * *',
          handler: spy,
        },
      },
    })

    const event = createMockEvent('0 * * * *')
    const env = { DB: 'test' } as TestEnv
    const ctx = createMockCtx()

    await handler(event, env, ctx)
    expect(spy).toHaveBeenCalledWith(event, env, ctx)
  })

  it('calls multiple matching tasks', async () => {
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'task-a': { schedule: '0 * * * *', handler: spy1 },
        'task-b': { schedule: '0 * * * *', handler: spy2 },
      },
    })

    const event = createMockEvent('0 * * * *')
    await handler(event, { DB: 'test' }, createMockCtx())

    expect(spy1).toHaveBeenCalledOnce()
    expect(spy2).toHaveBeenCalledOnce()
  })

  it('does not call non-matching task handlers', async () => {
    const matchSpy = vi.fn()
    const noMatchSpy = vi.fn()
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'match': { schedule: '0 * * * *', handler: matchSpy },
        'no-match': { schedule: '*/5 * * * *', handler: noMatchSpy },
      },
    })

    await handler(createMockEvent('0 * * * *'), { DB: 'test' }, createMockCtx())

    expect(matchSpy).toHaveBeenCalledOnce()
    expect(noMatchSpy).not.toHaveBeenCalled()
  })

  it('calls onNoMatch when no task matches', async () => {
    const onNoMatch = vi.fn()
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'my-task': { schedule: '0 * * * *', handler: vi.fn() },
      },
      onNoMatch,
    })

    const event = createMockEvent('*/30 * * * *')
    const env = { DB: 'test' } as TestEnv
    const ctx = createMockCtx()

    await handler(event, env, ctx)
    expect(onNoMatch).toHaveBeenCalledWith(event, env, ctx)
  })

  it('does not throw when no task matches and no onNoMatch', async () => {
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'my-task': { schedule: '0 * * * *', handler: vi.fn() },
      },
    })

    await expect(
      handler(createMockEvent('*/30 * * * *'), { DB: 'test' }, createMockCtx()),
    ).resolves.toBeUndefined()
  })

  it('applies middleware to all task handlers', async () => {
    const order: string[] = []
    const handler = createCronHandler<TestEnv>({
      middleware: [
        (next, taskName) => async (event, env, ctx) => {
          order.push(`before:${taskName}`)
          await next(event, env, ctx)
          order.push(`after:${taskName}`)
        },
      ],
      tasks: {
        'my-task': {
          schedule: '0 * * * *',
          handler: async () => { order.push('handler') },
        },
      },
    })

    await handler(createMockEvent('0 * * * *'), { DB: 'test' }, createMockCtx())

    expect(order).toEqual(['before:my-task', 'handler', 'after:my-task'])
  })

  it('applies multiple middleware in order', async () => {
    const order: string[] = []
    const handler = createCronHandler<TestEnv>({
      middleware: [
        (next) => async (event, env, ctx) => {
          order.push('mw1-before')
          await next(event, env, ctx)
          order.push('mw1-after')
        },
        (next) => async (event, env, ctx) => {
          order.push('mw2-before')
          await next(event, env, ctx)
          order.push('mw2-after')
        },
      ],
      tasks: {
        't': {
          schedule: '0 * * * *',
          handler: async () => { order.push('handler') },
        },
      },
    })

    await handler(createMockEvent('0 * * * *'), { DB: 'test' }, createMockCtx())

    expect(order).toEqual([
      'mw1-before', 'mw2-before', 'handler', 'mw2-after', 'mw1-after',
    ])
  })

  it('propagates task handler errors', async () => {
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'fail': {
          schedule: '0 * * * *',
          handler: async () => { throw new Error('task failed') },
        },
      },
    })

    await expect(
      handler(createMockEvent('0 * * * *'), { DB: 'test' }, createMockCtx()),
    ).rejects.toThrow('task failed')
  })

  it('handles async task handlers', async () => {
    const result: string[] = []
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'async-task': {
          schedule: '0 * * * *',
          handler: async () => {
            await new Promise(r => setTimeout(r, 10))
            result.push('done')
          },
        },
      },
    })

    await handler(createMockEvent('0 * * * *'), { DB: 'test' }, createMockCtx())
    expect(result).toEqual(['done'])
  })

  it('handles sync task handlers', async () => {
    const result: string[] = []
    const handler = createCronHandler<TestEnv>({
      tasks: {
        'sync-task': {
          schedule: '0 * * * *',
          handler: () => { result.push('done') },
        },
      },
    })

    await handler(createMockEvent('0 * * * *'), { DB: 'test' }, createMockCtx())
    expect(result).toEqual(['done'])
  })
})
