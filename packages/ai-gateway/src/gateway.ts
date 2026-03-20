import {
  ConfigError,
  ServiceUnavailableError,
  ValidationError,
  TimeoutError,
} from '@workkit/errors'
import type {
  AiInput,
  AiOutput,
  Gateway,
  GatewayConfig,
  ProviderConfig,
  ProviderMap,
  RunOptions,
} from './types'

/**
 * Execute a request against a specific provider.
 * Each provider type has its own execution logic.
 */
async function executeProvider(
  providerName: string,
  providerConfig: ProviderConfig,
  model: string,
  input: AiInput,
  options?: RunOptions,
): Promise<AiOutput> {
  const signal = options?.signal

  switch (providerConfig.type) {
    case 'workers-ai': {
      try {
        const raw = await providerConfig.binding.run(model, input)
        return {
          text: typeof raw === 'string' ? raw : extractText(raw),
          raw,
          usage: extractUsage(raw),
          provider: providerName,
          model,
        }
      } catch (err) {
        throw new ServiceUnavailableError(`workers-ai`, {
          cause: err,
          context: { provider: providerName, model },
        })
      }
    }

    case 'openai': {
      const baseUrl = providerConfig.baseUrl ?? 'https://api.openai.com/v1'
      const body = buildOpenAiBody(model, input)

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${providerConfig.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        })

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'unknown error')
          throw new ServiceUnavailableError(`openai (${response.status})`, {
            context: { provider: providerName, model, status: response.status, body: errorBody },
          })
        }

        const raw = await response.json() as Record<string, unknown>
        return {
          text: extractOpenAiText(raw),
          raw,
          usage: extractOpenAiUsage(raw),
          provider: providerName,
          model,
        }
      } catch (err) {
        if (err instanceof ServiceUnavailableError) throw err
        if (signal?.aborted) {
          throw new TimeoutError(`openai request for ${model}`, options?.timeout, {
            cause: err,
            context: { provider: providerName, model },
          })
        }
        throw new ServiceUnavailableError('openai', {
          cause: err,
          context: { provider: providerName, model },
        })
      }
    }

    case 'anthropic': {
      const baseUrl = providerConfig.baseUrl ?? 'https://api.anthropic.com/v1'
      const body = buildAnthropicBody(model, input)

      try {
        const response = await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': providerConfig.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal,
        })

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'unknown error')
          throw new ServiceUnavailableError(`anthropic (${response.status})`, {
            context: { provider: providerName, model, status: response.status, body: errorBody },
          })
        }

        const raw = await response.json() as Record<string, unknown>
        return {
          text: extractAnthropicText(raw),
          raw,
          usage: extractAnthropicUsage(raw),
          provider: providerName,
          model,
        }
      } catch (err) {
        if (err instanceof ServiceUnavailableError) throw err
        if (signal?.aborted) {
          throw new TimeoutError(`anthropic request for ${model}`, options?.timeout, {
            cause: err,
            context: { provider: providerName, model },
          })
        }
        throw new ServiceUnavailableError('anthropic', {
          cause: err,
          context: { provider: providerName, model },
        })
      }
    }

    case 'custom': {
      try {
        return await providerConfig.run(model, input)
      } catch (err) {
        throw new ServiceUnavailableError(`custom provider "${providerName}"`, {
          cause: err,
          context: { provider: providerName, model },
        })
      }
    }
  }
}

// --- Helpers for building request bodies ---

function buildOpenAiBody(model: string, input: AiInput): Record<string, unknown> {
  if ('messages' in input) {
    return { model, messages: input.messages }
  }
  if ('prompt' in input) {
    return { model, messages: [{ role: 'user', content: input.prompt }] }
  }
  return { model, ...input }
}

function buildAnthropicBody(model: string, input: AiInput): Record<string, unknown> {
  if ('messages' in input) {
    // Anthropic requires system messages to be separate
    const systemMsg = input.messages.find((m) => m.role === 'system')
    const nonSystem = input.messages.filter((m) => m.role !== 'system')
    const body: Record<string, unknown> = {
      model,
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 1024,
    }
    if (systemMsg) {
      body.system = systemMsg.content
    }
    return body
  }
  if ('prompt' in input) {
    return {
      model,
      messages: [{ role: 'user', content: input.prompt }],
      max_tokens: 1024,
    }
  }
  return { model, max_tokens: 1024, ...input }
}

// --- Helpers for extracting response data ---

function extractText(raw: unknown): string | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.response === 'string') return obj.response
    if (typeof obj.text === 'string') return obj.text
  }
  return undefined
}

function extractUsage(raw: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const usage = obj.usage as Record<string, unknown> | undefined
  if (!usage) return undefined
  const input = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
  const output = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
  if (input === 0 && output === 0) return undefined
  return { inputTokens: input, outputTokens: output }
}

function extractOpenAiText(raw: Record<string, unknown>): string | undefined {
  const choices = raw.choices as Array<Record<string, unknown>> | undefined
  if (!choices?.[0]) return undefined
  const message = choices[0].message as Record<string, unknown> | undefined
  return typeof message?.content === 'string' ? message.content : undefined
}

function extractOpenAiUsage(raw: Record<string, unknown>): { inputTokens: number; outputTokens: number } | undefined {
  const usage = raw.usage as Record<string, unknown> | undefined
  if (!usage) return undefined
  return {
    inputTokens: (usage.prompt_tokens as number) ?? 0,
    outputTokens: (usage.completion_tokens as number) ?? 0,
  }
}

function extractAnthropicText(raw: Record<string, unknown>): string | undefined {
  const content = raw.content as Array<Record<string, unknown>> | undefined
  if (!content?.[0]) return undefined
  return typeof content[0].text === 'string' ? content[0].text : undefined
}

function extractAnthropicUsage(raw: Record<string, unknown>): { inputTokens: number; outputTokens: number } | undefined {
  const usage = raw.usage as Record<string, unknown> | undefined
  if (!usage) return undefined
  return {
    inputTokens: (usage.input_tokens as number) ?? 0,
    outputTokens: (usage.output_tokens as number) ?? 0,
  }
}

/**
 * Create an AI gateway with named providers.
 *
 * The gateway provides a unified `run()` interface across all providers.
 * Use a router to automatically map model names to providers,
 * or specify the provider explicitly via `RunOptions`.
 *
 * @example
 * ```ts
 * const gateway = createGateway({
 *   providers: {
 *     'workers-ai': { type: 'workers-ai', binding: env.AI },
 *     'openai': { type: 'openai', apiKey: env.OPENAI_KEY },
 *   },
 *   defaultProvider: 'workers-ai',
 * })
 *
 * const result = await gateway.run('gpt-4', { prompt: 'Hello' }, { provider: 'openai' })
 * ```
 */
export function createGateway<P extends ProviderMap>(config: GatewayConfig<P>): Gateway {
  if (!config.providers || Object.keys(config.providers).length === 0) {
    throw new ConfigError('Gateway requires at least one provider', {
      context: { providers: Object.keys(config.providers ?? {}) },
    })
  }

  if (!config.defaultProvider) {
    throw new ConfigError('Gateway requires a default provider', {
      context: { defaultProvider: config.defaultProvider },
    })
  }

  if (!(config.defaultProvider in config.providers)) {
    throw new ConfigError(
      `Default provider "${config.defaultProvider}" not found in providers`,
      {
        context: {
          defaultProvider: config.defaultProvider,
          available: Object.keys(config.providers),
        },
      },
    )
  }

  const providerNames = Object.keys(config.providers)

  return {
    async run(model: string, input: AiInput, options?: RunOptions): Promise<AiOutput> {
      if (!model) {
        throw new ValidationError('Model name is required', [
          { path: 'model', message: 'Model name cannot be empty' },
        ])
      }

      const providerKey = options?.provider ?? config.defaultProvider
      const providerConfig = config.providers[providerKey]

      if (!providerConfig) {
        throw new ConfigError(`Provider "${providerKey}" not found`, {
          context: { provider: providerKey, available: providerNames },
        })
      }

      // Handle timeout via AbortSignal
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let signal = options?.signal
      if (options?.timeout && !signal) {
        const controller = new AbortController()
        signal = controller.signal
        timeoutId = setTimeout(() => controller.abort(), options.timeout)
      }

      try {
        return await executeProvider(
          providerKey,
          providerConfig,
          model,
          input,
          signal ? { ...options, signal } : options,
        )
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }
    },

    providers(): string[] {
      return providerNames
    },

    defaultProvider(): string {
      return config.defaultProvider
    },
  }
}
