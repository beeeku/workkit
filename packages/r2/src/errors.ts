import {
  BindingNotFoundError,
  ConfigError,
  ValidationError,
  NotFoundError,
  TimeoutError,
  ServiceUnavailableError,
  InternalError,
} from '@workkit/errors'
import type { R2ErrorContext } from './types'

export type { R2ErrorContext }

/**
 * Assert that a value is an R2Bucket binding.
 * Throws BindingNotFoundError or ConfigError if invalid.
 */
export function assertR2Binding(binding: unknown): asserts binding is R2Bucket {
  if (!binding || typeof binding !== 'object') {
    throw new BindingNotFoundError('R2Bucket')
  }
  const obj = binding as Record<string, unknown>
  if (
    typeof obj.get !== 'function' ||
    typeof obj.put !== 'function' ||
    typeof obj.delete !== 'function' ||
    typeof obj.list !== 'function' ||
    typeof obj.head !== 'function'
  ) {
    throw new ConfigError(
      'Value does not appear to be an R2Bucket binding. ' +
        'Ensure it is configured in wrangler.toml under [[r2_buckets]].',
    )
  }
}

/**
 * Validate an R2 object key.
 * R2 keys can be up to 1024 bytes and must be non-empty.
 */
export function validateR2Key(key: string): void {
  if (!key || key.length === 0) {
    throw new ValidationError('R2 object key must be a non-empty string', [
      { path: ['key'], message: 'Key is empty', code: 'WORKKIT_R2_EMPTY_KEY' },
    ])
  }
  const byteLength = new TextEncoder().encode(key).length
  if (byteLength > 1024) {
    throw new ValidationError(
      `R2 object key exceeds maximum size of 1024 bytes (got ${byteLength} bytes)`,
      [
        {
          path: ['key'],
          message: `Key is ${byteLength} bytes, max is 1024`,
          code: 'WORKKIT_R2_KEY_TOO_LONG',
        },
      ],
    )
  }
}

/**
 * Wrap raw R2 errors into typed WorkkitError subclasses.
 * Always throws — return type is `never`.
 */
export function wrapR2Error(error: unknown, context: R2ErrorContext): never {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('timeout') || message.includes('timed out')) {
    throw new TimeoutError(`R2.${context.operation}`, undefined, {
      cause: error,
      context,
    })
  }

  if (
    message.includes('503') ||
    message.includes('service') ||
    message.includes('unavailable')
  ) {
    throw new ServiceUnavailableError('R2', {
      cause: error,
      context,
    })
  }

  if (message.includes('not found') || message.includes('404')) {
    throw new NotFoundError('R2 object', context.key, {
      cause: error,
      context,
    })
  }

  throw new InternalError(`R2.${context.operation} failed: ${message}`, {
    cause: error,
    context,
  })
}
