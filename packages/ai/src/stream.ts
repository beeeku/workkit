import { BindingNotFoundError, TimeoutError } from '@workkit/errors'
import type { AiBinding, TextGenerationInput, RunOptions } from './types'

/** Options for streaming AI responses */
export interface StreamOptions extends RunOptions {
  /** Timeout in milliseconds for the entire stream operation */
  timeout?: number
}

/**
 * Stream text generation from a Cloudflare Workers AI model.
 *
 * Returns a ReadableStream of text chunks suitable for Server-Sent Events.
 *
 * @param binding - The AI binding from the worker environment
 * @param model - The text generation model identifier
 * @param input - Text generation input (stream flag is set automatically)
 * @param options - Optional streaming configuration
 * @returns A ReadableStream of text chunks
 *
 * @example
 * ```ts
 * const stream = await streamAI(env.AI, '@cf/meta/llama-3.1-8b-instruct', {
 *   messages: [{ role: 'user', content: 'Write a story' }],
 * })
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/event-stream' },
 * })
 * ```
 */
export async function streamAI(
  binding: AiBinding,
  model: string,
  input: TextGenerationInput,
  options?: StreamOptions,
): Promise<ReadableStream<Uint8Array>> {
  if (!binding) {
    throw new BindingNotFoundError('AI')
  }

  const streamInput = { ...input, stream: true }

  const runOptions: Record<string, unknown> = {}
  if (options?.gateway) {
    runOptions.gateway = options.gateway
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const abortController = new AbortController()

  // Combine external signal with timeout signal
  if (options?.signal) {
    if (options.signal.aborted) {
      abortController.abort(options.signal.reason)
    } else {
      options.signal.addEventListener('abort', () => {
        abortController.abort(options.signal!.reason)
      })
    }
  }

  if (options?.timeout) {
    timeoutId = setTimeout(() => {
      abortController.abort(new TimeoutError('streamAI', options.timeout))
    }, options.timeout)
  }

  runOptions.signal = abortController.signal

  try {
    const response = await binding.run(model, streamInput, runOptions)

    // If the binding returns a ReadableStream, use it directly
    if (response instanceof ReadableStream) {
      // Wrap to clean up timeout on completion
      if (timeoutId !== undefined) {
        const reader = response.getReader()
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read()
              if (done) {
                clearTimeout(timeoutId)
                controller.close()
                return
              }
              controller.enqueue(value as Uint8Array)
            } catch (err) {
              clearTimeout(timeoutId)
              controller.error(err)
            }
          },
          cancel() {
            clearTimeout(timeoutId)
            reader.cancel()
          },
        })
      }
      return response as ReadableStream<Uint8Array>
    }

    // If the response is a string or object, wrap it in a ReadableStream
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }

    const text = typeof response === 'string'
      ? response
      : JSON.stringify(response)
    const encoder = new TextEncoder()

    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      },
    })
  } catch (err) {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
    throw err
  }
}
