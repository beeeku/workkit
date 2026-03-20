import type { ScheduledEvent, ExecutionContext } from '@workkit/types'
import type { CronMiddleware, CronTaskHandler, ErrorReporter } from './types'
import { TimeoutError } from '@workkit/errors'

/**
 * Create a middleware that enforces a timeout on task execution.
 *
 * @param ms Maximum execution time in milliseconds
 * @returns Middleware that throws TimeoutError if the handler exceeds the timeout
 */
export function withTimeout<E = unknown>(ms: number): CronMiddleware<E> {
  return (handler: CronTaskHandler<E>, taskName: string): CronTaskHandler<E> => {
    return async (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void> => {
      let timeoutId: ReturnType<typeof setTimeout>
      let timedOut = false

      const timeoutPromise = new Promise<void>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true
          reject(new TimeoutError(`Cron task "${taskName}" timed out after ${ms}ms`))
        }, ms)
      })

      const handlerPromise = Promise.resolve(handler(event, env, ctx)).then(
        () => {
          clearTimeout(timeoutId!)
        },
        (err) => {
          clearTimeout(timeoutId!)
          throw err
        },
      )

      // Suppress unhandled rejection on the losing promise
      timeoutPromise.catch(() => {})

      await Promise.race([handlerPromise, timeoutPromise])
    }
  }
}

/**
 * Create a middleware that retries failed task executions.
 *
 * @param maxRetries Maximum number of retry attempts (not counting the initial attempt)
 * @param options Retry configuration
 * @returns Middleware that retries the handler on failure
 */
export function withRetry<E = unknown>(
  maxRetries: number,
  options: { baseDelay?: number; exponential?: boolean } = {},
): CronMiddleware<E> {
  const { baseDelay = 1000, exponential = true } = options

  return (handler: CronTaskHandler<E>, _taskName: string): CronTaskHandler<E> => {
    return async (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void> => {
      let lastError: unknown

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await handler(event, env, ctx)
          return
        } catch (error) {
          lastError = error
          if (attempt < maxRetries) {
            const delay = exponential
              ? baseDelay * Math.pow(2, attempt)
              : baseDelay
            await new Promise(resolve => setTimeout(resolve, delay))
          }
        }
      }

      throw lastError
    }
  }
}

/**
 * Create a middleware that reports errors from task execution.
 *
 * @param getQueue Function to extract the error queue/destination from env
 * @param reporter Optional custom error reporter. Defaults to console.error.
 * @returns Middleware that reports errors and rethrows them
 */
export function withErrorReporting<E = unknown>(
  getQueue: (env: E) => unknown,
  reporter?: ErrorReporter<E>,
): CronMiddleware<E> {
  return (handler: CronTaskHandler<E>, taskName: string): CronTaskHandler<E> => {
    return async (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void> => {
      try {
        await handler(event, env, ctx)
      } catch (error) {
        if (reporter) {
          await reporter(error, taskName, event, env)
        } else {
          // Default: log to console
          const queue = getQueue(env)
          console.error(`[cron:${taskName}] Task failed:`, error, { queue })
        }
        throw error
      }
    }
  }
}
