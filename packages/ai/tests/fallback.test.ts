import { describe, it, expect, vi } from 'vitest'
import { fallback } from '../src/fallback'
import type { AiBinding, FallbackEntry } from '../src/types'

type CallRecord = { model: string; inputs: Record<string, unknown> }

function createSequenceBinding(responses: Array<{ result?: unknown; error?: Error }>): AiBinding & { calls: CallRecord[] } {
  let callIndex = 0
  const calls: CallRecord[] = []
  return {
    calls,
    async run(model: string, inputs: Record<string, unknown>) {
      calls.push({ model, inputs })
      const entry = responses[callIndex++]
      if (!entry || entry.error) {
        throw entry?.error ?? new Error('Unknown error')
      }
      return entry.result
    },
  }
}

function createSuccessBinding(response: unknown = { response: 'OK' }): AiBinding & { calls: CallRecord[] } {
  return createSequenceBinding([{ result: response }])
}

describe('fallback()', () => {
  describe('binding validation', () => {
    it('throws BindingNotFoundError when binding is null', async () => {
      await expect(
        fallback(null as unknown as AiBinding, [{ model: 'a' }], {}),
      ).rejects.toThrow('AI')
    })

    it('throws BindingNotFoundError when binding is undefined', async () => {
      await expect(
        fallback(undefined as unknown as AiBinding, [{ model: 'a' }], {}),
      ).rejects.toThrow('AI')
    })
  })

  describe('empty model list', () => {
    it('throws ServiceUnavailableError with no models', async () => {
      const binding = createSuccessBinding()
      await expect(
        fallback(binding, [], {}),
      ).rejects.toThrow('no models provided')
    })
  })

  describe('first model succeeds', () => {
    it('returns the first model result', async () => {
      const binding = createSequenceBinding([
        { result: { response: 'From model A' } },
      ])

      const result = await fallback(binding, [
        { model: '@cf/meta/llama-3.1-70b-instruct' },
        { model: '@cf/meta/llama-3.1-8b-instruct' },
      ], {
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.data).toEqual({ response: 'From model A' })
      expect(result.model).toBe('@cf/meta/llama-3.1-70b-instruct')
      expect(result.attempts).toBe(1)
      expect(result.attempted).toEqual(['@cf/meta/llama-3.1-70b-instruct'])
    })

    it('only calls the first model', async () => {
      const binding = createSequenceBinding([
        { result: { response: 'OK' } },
      ])

      await fallback(binding, [
        { model: 'model-a' },
        { model: 'model-b' },
      ], {})

      expect(binding.calls).toHaveLength(1)
    })
  })

  describe('first fails, second succeeds', () => {
    it('falls back to the second model', async () => {
      const binding = createSequenceBinding([
        { error: new Error('Model A failed') },
        { result: { response: 'From model B' } },
      ])

      const result = await fallback(binding, [
        { model: 'model-a' },
        { model: 'model-b' },
      ], {
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.data).toEqual({ response: 'From model B' })
      expect(result.model).toBe('model-b')
      expect(result.attempts).toBe(2)
      expect(result.attempted).toEqual(['model-a', 'model-b'])
    })

    it('calls both models in order', async () => {
      const binding = createSequenceBinding([
        { error: new Error('fail') },
        { result: 'ok' },
      ])

      await fallback(binding, [
        { model: 'first' },
        { model: 'second' },
      ], {})

      expect(binding.calls).toHaveLength(2)
      expect(binding.calls[0].model).toBe('first')
      expect(binding.calls[1].model).toBe('second')
    })
  })

  describe('all models fail', () => {
    it('throws ServiceUnavailableError', async () => {
      const binding = createSequenceBinding([
        { error: new Error('A failed') },
        { error: new Error('B failed') },
        { error: new Error('C failed') },
      ])

      await expect(
        fallback(binding, [
          { model: 'a' },
          { model: 'b' },
          { model: 'c' },
        ], {}),
      ).rejects.toThrow('fallback chain exhausted')
    })

    it('includes model names in the error message', async () => {
      const binding = createSequenceBinding([
        { error: new Error('fail') },
        { error: new Error('fail') },
      ])

      await expect(
        fallback(binding, [
          { model: 'model-x' },
          { model: 'model-y' },
        ], {}),
      ).rejects.toThrow('model-x, model-y')
    })
  })

  describe('onFallback callback', () => {
    it('calls onFallback when a model fails and there is a next model', async () => {
      const binding = createSequenceBinding([
        { error: new Error('Model A error') },
        { result: { response: 'OK' } },
      ])

      const onFallback = vi.fn()

      await fallback(binding, [
        { model: 'model-a' },
        { model: 'model-b' },
      ], {}, { onFallback })

      expect(onFallback).toHaveBeenCalledOnce()
      expect(onFallback).toHaveBeenCalledWith(
        'model-a',
        expect.any(Error),
        'model-b',
      )
    })

    it('does not call onFallback when the last model fails', async () => {
      const binding = createSequenceBinding([
        { error: new Error('fail') },
      ])

      const onFallback = vi.fn()

      await expect(
        fallback(binding, [{ model: 'only-model' }], {}, { onFallback }),
      ).rejects.toThrow()

      expect(onFallback).not.toHaveBeenCalled()
    })

    it('calls onFallback for each intermediate failure', async () => {
      const binding = createSequenceBinding([
        { error: new Error('A fail') },
        { error: new Error('B fail') },
        { result: { response: 'OK' } },
      ])

      const onFallback = vi.fn()

      await fallback(binding, [
        { model: 'a' },
        { model: 'b' },
        { model: 'c' },
      ], {}, { onFallback })

      expect(onFallback).toHaveBeenCalledTimes(2)
    })
  })

  describe('three-model chain', () => {
    it('skips first two failures and uses third', async () => {
      const binding = createSequenceBinding([
        { error: new Error('fail 1') },
        { error: new Error('fail 2') },
        { result: { response: 'From C' } },
      ])

      const result = await fallback(binding, [
        { model: 'a' },
        { model: 'b' },
        { model: 'c' },
      ], {})

      expect(result.data).toEqual({ response: 'From C' })
      expect(result.model).toBe('c')
      expect(result.attempts).toBe(3)
      expect(result.attempted).toEqual(['a', 'b', 'c'])
    })
  })

  describe('single model chain', () => {
    it('succeeds with single model', async () => {
      const binding = createSequenceBinding([
        { result: { response: 'Solo' } },
      ])

      const result = await fallback(binding, [{ model: 'solo' }], {})

      expect(result.data).toEqual({ response: 'Solo' })
      expect(result.attempts).toBe(1)
    })

    it('fails with single model', async () => {
      const binding = createSequenceBinding([
        { error: new Error('Solo failed') },
      ])

      await expect(
        fallback(binding, [{ model: 'solo' }], {}),
      ).rejects.toThrow('fallback chain exhausted')
    })
  })

  describe('input passing', () => {
    it('passes the same inputs to each model', async () => {
      const binding = createSequenceBinding([
        { error: new Error('fail') },
        { result: 'ok' },
      ])

      const inputs = {
        messages: [{ role: 'user', content: 'Test' }],
        temperature: 0.5,
      }

      await fallback(binding, [
        { model: 'a' },
        { model: 'b' },
      ], inputs)

      expect(binding.calls[0].inputs).toEqual(inputs)
      expect(binding.calls[1].inputs).toEqual(inputs)
    })
  })
})
