import type { CloudflareLoadContext, LoaderFunctionArgs, ActionFunctionArgs } from '../src/types'

/**
 * Creates a mock CloudflareLoadContext for testing.
 */
export function createMockContext(
  env: Record<string, unknown> = {},
  overrides: Partial<{
    cf: IncomingRequestCfProperties
    waitUntilFns: Array<Promise<unknown>>
  }> = {},
): CloudflareLoadContext {
  const waitUntilFns: Array<Promise<unknown>> = overrides.waitUntilFns ?? []

  return {
    cloudflare: {
      env,
      cf: overrides.cf,
      ctx: {
        waitUntil: (promise: Promise<unknown>) => {
          waitUntilFns.push(promise)
        },
        passThroughOnException: () => {},
      } as ExecutionContext,
    },
  }
}

/**
 * Creates mock LoaderFunctionArgs for testing.
 */
export function createMockLoaderArgs(
  overrides: Partial<{
    url: string
    params: Record<string, string | undefined>
    env: Record<string, unknown>
    cf: IncomingRequestCfProperties
    headers: Record<string, string>
  }> = {},
): LoaderFunctionArgs {
  return {
    request: new Request(overrides.url ?? 'https://example.com/test', {
      headers: overrides.headers,
    }),
    params: overrides.params ?? {},
    context: createMockContext(overrides.env ?? {}, { cf: overrides.cf }),
  }
}

/**
 * Creates mock ActionFunctionArgs for testing.
 */
export function createMockActionArgs(
  overrides: Partial<{
    url: string
    method: string
    params: Record<string, string | undefined>
    env: Record<string, unknown>
    body: unknown
    contentType: string
    headers: Record<string, string>
  }> = {},
): ActionFunctionArgs {
  const contentType = overrides.contentType ?? 'application/json'
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    ...overrides.headers,
  }

  let requestBody: string | undefined
  if (overrides.body !== undefined) {
    if (contentType.includes('application/json')) {
      requestBody = JSON.stringify(overrides.body)
    } else if (typeof overrides.body === 'string') {
      requestBody = overrides.body
    }
  }

  return {
    request: new Request(overrides.url ?? 'https://example.com/test', {
      method: overrides.method ?? 'POST',
      headers,
      body: requestBody,
    }),
    params: overrides.params ?? {},
    context: createMockContext(overrides.env ?? {}),
  }
}

/**
 * Creates a minimal Standard Schema validator for testing.
 * Avoids needing zod as a dependency.
 */
export function createStringValidator(opts?: { min?: number }) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test' as const,
      validate: (value: unknown) => {
        if (typeof value !== 'string') {
          return {
            issues: [{ message: 'Expected string', path: [] }],
          }
        }
        if (opts?.min !== undefined && value.length < opts.min) {
          return {
            issues: [{ message: `String must be at least ${opts.min} characters`, path: [] }],
          }
        }
        return { value }
      },
    },
  }
}

/**
 * Creates a number validator following Standard Schema.
 */
export function createNumberValidator(opts?: { min?: number; max?: number }) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test' as const,
      validate: (value: unknown) => {
        if (typeof value !== 'number' || isNaN(value)) {
          return {
            issues: [{ message: 'Expected number', path: [] }],
          }
        }
        if (opts?.min !== undefined && value < opts.min) {
          return {
            issues: [{ message: `Number must be >= ${opts.min}`, path: [] }],
          }
        }
        if (opts?.max !== undefined && value > opts.max) {
          return {
            issues: [{ message: `Number must be <= ${opts.max}`, path: [] }],
          }
        }
        return { value }
      },
    },
  }
}

/**
 * Creates an object validator following Standard Schema.
 */
export function createObjectValidator<T extends Record<string, { '~standard': { version: 1; vendor: string; validate: (value: unknown) => any } }>>(
  shape: T,
) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test' as const,
      validate: (value: unknown) => {
        if (typeof value !== 'object' || value === null) {
          return {
            issues: [{ message: 'Expected object', path: [] }],
          }
        }

        const issues: Array<{ message: string; path: Array<{ key: string }> }> = []
        const result: Record<string, unknown> = {}

        for (const [key, validator] of Object.entries(shape)) {
          const fieldValue = (value as Record<string, unknown>)[key]
          const fieldResult = validator['~standard'].validate(fieldValue)

          if ('issues' in fieldResult && fieldResult.issues) {
            for (const issue of fieldResult.issues) {
              issues.push({
                message: issue.message,
                path: [{ key }, ...(issue.path ?? [])],
              })
            }
          } else {
            result[key] = fieldResult.value
          }
        }

        if (issues.length > 0) return { issues }
        return { value: result }
      },
    },
  }
}

/**
 * Creates a mock email validator following Standard Schema.
 */
export function createEmailValidator() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test' as const,
      validate: (value: unknown) => {
        if (typeof value !== 'string') {
          return { issues: [{ message: 'Expected string', path: [] }] }
        }
        if (!value.includes('@')) {
          return { issues: [{ message: 'Invalid email', path: [] }] }
        }
        return { value }
      },
    },
  }
}
