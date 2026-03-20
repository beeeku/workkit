import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withLogging } from '../src/logging'
import type { AiInput, AiOutput, Gateway, LoggingConfig } from '../src/types'

// --- Mock helpers ---

function createMockGateway(result?: Partial<AiOutput>): Gateway & { runMock: ReturnType<typeof vi.fn> } {
  const defaultResult: AiOutput = {
    text: 'Response',
    raw: { text: 'Response' },
    provider: 'test',
    model: 'test-model',
    ...result,
  }
  const runMock = vi.fn().mockResolvedValue(defaultResult)
  return {
    runMock,
    run: runMock,
    providers: () => ['test'],
    defaultProvider: () => 'test',
  }
}

function createFailingGateway(error: Error): Gateway & { runMock: ReturnType<typeof vi.fn> } {
  const runMock = vi.fn().mockRejectedValue(error)
  return {
    runMock,
    run: runMock,
    providers: () => ['test'],
    defaultProvider: () => 'test',
  }
}

describe('withLogging()', () => {
  it('creates a logged gateway', () => {
    const gw = createMockGateway()
    const logged = withLogging(gw, {})
    expect(logged).toBeDefined()
    expect(typeof logged.run).toBe('function')
  })

  it('proxies providers() to underlying gateway', () => {
    const gw = createMockGateway()
    const logged = withLogging(gw, {})
    expect(logged.providers()).toEqual(['test'])
  })

  it('proxies defaultProvider() to underlying gateway', () => {
    const gw = createMockGateway()
    const logged = withLogging(gw, {})
    expect(logged.defaultProvider()).toBe('test')
  })
})

describe('onRequest callback', () => {
  it('fires before gateway call', async () => {
    const gw = createMockGateway()
    const onRequest = vi.fn()
    const logged = withLogging(gw, { onRequest })

    await logged.run('gpt-4', { prompt: 'Hello' })
    expect(onRequest).toHaveBeenCalledWith('gpt-4', { prompt: 'Hello' })
  })

  it('fires even when gateway throws', async () => {
    const gw = createFailingGateway(new Error('fail'))
    const onRequest = vi.fn()
    const logged = withLogging(gw, { onRequest })

    await expect(logged.run('model', { prompt: 'test' })).rejects.toThrow()
    expect(onRequest).toHaveBeenCalled()
  })

  it('receives messages input correctly', async () => {
    const gw = createMockGateway()
    const onRequest = vi.fn()
    const logged = withLogging(gw, { onRequest })

    const input: AiInput = {
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Hi' },
      ],
    }
    await logged.run('model', input)
    expect(onRequest).toHaveBeenCalledWith('model', input)
  })
})

describe('onResponse callback', () => {
  it('fires after successful gateway call', async () => {
    const gw = createMockGateway({ text: 'Hello!' })
    const onResponse = vi.fn()
    const logged = withLogging(gw, { onResponse })

    await logged.run('gpt-4', { prompt: 'Hello' })
    expect(onResponse).toHaveBeenCalledOnce()
  })

  it('receives model, output, and duration', async () => {
    const gw = createMockGateway({ text: 'Result' })
    const onResponse = vi.fn()
    const logged = withLogging(gw, { onResponse })

    await logged.run('gpt-4', { prompt: 'test' })

    const [model, output, duration] = onResponse.mock.calls[0]
    expect(model).toBe('gpt-4')
    expect(output.text).toBe('Result')
    expect(typeof duration).toBe('number')
    expect(duration).toBeGreaterThanOrEqual(0)
  })

  it('does not fire when gateway throws', async () => {
    const gw = createFailingGateway(new Error('fail'))
    const onResponse = vi.fn()
    const logged = withLogging(gw, { onResponse })

    await expect(logged.run('model', { prompt: 'test' })).rejects.toThrow()
    expect(onResponse).not.toHaveBeenCalled()
  })
})

describe('onError callback', () => {
  it('fires when gateway throws', async () => {
    const error = new Error('provider failed')
    const gw = createFailingGateway(error)
    const onError = vi.fn()
    const logged = withLogging(gw, { onError })

    await expect(logged.run('gpt-4', { prompt: 'test' })).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith('gpt-4', error)
  })

  it('still rethrows the error after callback', async () => {
    const gw = createFailingGateway(new Error('fail'))
    const onError = vi.fn()
    const logged = withLogging(gw, { onError })

    await expect(logged.run('model', { prompt: 'test' })).rejects.toThrow('fail')
  })

  it('does not fire on success', async () => {
    const gw = createMockGateway()
    const onError = vi.fn()
    const logged = withLogging(gw, { onError })

    await logged.run('model', { prompt: 'test' })
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('all callbacks together', () => {
  it('fires onRequest then onResponse on success', async () => {
    const gw = createMockGateway()
    const order: string[] = []
    const logged = withLogging(gw, {
      onRequest: () => order.push('request'),
      onResponse: () => order.push('response'),
      onError: () => order.push('error'),
    })

    await logged.run('model', { prompt: 'test' })
    expect(order).toEqual(['request', 'response'])
  })

  it('fires onRequest then onError on failure', async () => {
    const gw = createFailingGateway(new Error('fail'))
    const order: string[] = []
    const logged = withLogging(gw, {
      onRequest: () => order.push('request'),
      onResponse: () => order.push('response'),
      onError: () => order.push('error'),
    })

    await expect(logged.run('model', { prompt: 'test' })).rejects.toThrow()
    expect(order).toEqual(['request', 'error'])
  })

  it('works with no callbacks configured', async () => {
    const gw = createMockGateway()
    const logged = withLogging(gw, {})
    const result = await logged.run('model', { prompt: 'test' })
    expect(result.text).toBe('Response')
  })
})

describe('passthrough behavior', () => {
  it('returns the exact same result as the underlying gateway', async () => {
    const expectedResult: AiOutput = {
      text: 'Exact result',
      raw: { data: 'raw' },
      usage: { inputTokens: 100, outputTokens: 50 },
      provider: 'test',
      model: 'gpt-4',
    }
    const gw = createMockGateway(expectedResult)
    const logged = withLogging(gw, {
      onRequest: vi.fn(),
      onResponse: vi.fn(),
    })

    const result = await logged.run('gpt-4', { prompt: 'test' })
    expect(result).toEqual(expectedResult)
  })

  it('passes options through to underlying gateway', async () => {
    const gw = createMockGateway()
    const logged = withLogging(gw, {})

    await logged.run('model', { prompt: 'test' }, { provider: 'override' })
    expect(gw.runMock).toHaveBeenCalledWith('model', { prompt: 'test' }, { provider: 'override' })
  })
})
