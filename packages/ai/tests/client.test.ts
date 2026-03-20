import { describe, it, expect, vi } from 'vitest'
import { ai } from '../src/client'
import type { AiBinding } from '../src/types'

/** Create a mock AI binding that records calls and returns configured responses */
function createMockBinding(response: unknown = { response: 'Hello!' }): AiBinding & { calls: Array<{ model: string; inputs: Record<string, unknown>; options?: Record<string, unknown> }> } {
  const calls: Array<{ model: string; inputs: Record<string, unknown>; options?: Record<string, unknown> }> = []
  return {
    calls,
    async run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>) {
      calls.push({ model, inputs, options })
      return response
    },
  }
}

describe('ai()', () => {
  describe('binding validation', () => {
    it('throws BindingNotFoundError when binding is null', () => {
      expect(() => ai(null as unknown as AiBinding)).toThrow('AI')
    })

    it('throws BindingNotFoundError when binding is undefined', () => {
      expect(() => ai(undefined as unknown as AiBinding)).toThrow('AI')
    })

    it('creates a client when binding is valid', () => {
      const binding = createMockBinding()
      const client = ai(binding)
      expect(client).toBeDefined()
      expect(typeof client.run).toBe('function')
    })
  })

  describe('run()', () => {
    it('passes model and inputs to the binding', async () => {
      const binding = createMockBinding()
      const client = ai(binding)

      await client.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(binding.calls).toHaveLength(1)
      expect(binding.calls[0].model).toBe('@cf/meta/llama-3.1-8b-instruct')
      expect(binding.calls[0].inputs).toEqual({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    })

    it('returns data and model in the result', async () => {
      const binding = createMockBinding({ response: 'World!' })
      const client = ai(binding)

      const result = await client.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.data).toEqual({ response: 'World!' })
      expect(result.model).toBe('@cf/meta/llama-3.1-8b-instruct')
    })

    it('handles text generation models', async () => {
      const binding = createMockBinding({ response: 'Generated text' })
      const client = ai(binding)

      const result = await client.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.data).toEqual({ response: 'Generated text' })
    })

    it('handles text embedding models', async () => {
      const embeddingResponse = { shape: [1, 768], data: [[0.1, 0.2, 0.3]] }
      const binding = createMockBinding(embeddingResponse)
      const client = ai(binding)

      const result = await client.run('@cf/baai/bge-base-en-v1.5', {
        text: ['hello world'],
      })

      expect(result.data).toEqual(embeddingResponse)
    })

    it('handles image classification models', async () => {
      const classificationResponse = [
        { label: 'cat', score: 0.95 },
        { label: 'dog', score: 0.03 },
      ]
      const binding = createMockBinding(classificationResponse)
      const client = ai(binding)

      const result = await client.run('@cf/microsoft/resnet-50', {
        image: new Uint8Array([1, 2, 3]),
      })

      expect(result.data).toEqual(classificationResponse)
    })

    it('passes gateway options to the binding', async () => {
      const binding = createMockBinding()
      const client = ai(binding)

      await client.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello' }],
      }, {
        gateway: { id: 'my-gateway', skipCache: true, cacheTtl: 300 },
      })

      expect(binding.calls[0].options).toEqual({
        gateway: { id: 'my-gateway', skipCache: true, cacheTtl: 300 },
      })
    })

    it('passes signal option to the binding', async () => {
      const binding = createMockBinding()
      const client = ai(binding)
      const controller = new AbortController()

      await client.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello' }],
      }, {
        signal: controller.signal,
      })

      expect(binding.calls[0].options).toHaveProperty('signal')
    })

    it('passes no options when none are provided', async () => {
      const binding = createMockBinding()
      const client = ai(binding)

      await client.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(binding.calls[0].options).toEqual({})
    })

    it('propagates errors from the binding', async () => {
      const binding: AiBinding = {
        async run() {
          throw new Error('Model not found')
        },
      }
      const client = ai(binding)

      await expect(
        client.run('@cf/nonexistent/model', {}),
      ).rejects.toThrow('Model not found')
    })

    it('handles prompt-based input', async () => {
      const binding = createMockBinding({ response: 'Completed prompt' })
      const client = ai(binding)

      await client.run('@cf/meta/llama-3.1-8b-instruct', {
        prompt: 'Complete this:',
      })

      expect(binding.calls[0].inputs).toEqual({ prompt: 'Complete this:' })
    })

    it('handles extra model parameters', async () => {
      const binding = createMockBinding()
      const client = ai(binding)

      await client.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        temperature: 0.7,
        top_p: 0.9,
      })

      expect(binding.calls[0].inputs).toEqual({
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100,
        temperature: 0.7,
        top_p: 0.9,
      })
    })

    it('handles translation model input', async () => {
      const binding = createMockBinding({ translated_text: 'Hola mundo' })
      const client = ai(binding)

      const result = await client.run('@cf/meta/m2m100-1.2b', {
        text: 'Hello world',
        source_lang: 'en',
        target_lang: 'es',
      })

      expect(result.data).toEqual({ translated_text: 'Hola mundo' })
    })

    it('handles summarization model input', async () => {
      const binding = createMockBinding({ summary: 'Short version' })
      const client = ai(binding)

      const result = await client.run('@cf/facebook/bart-large-cnn', {
        input_text: 'Very long text that needs summarization...',
        max_length: 50,
      })

      expect(result.data).toEqual({ summary: 'Short version' })
    })
  })
})
