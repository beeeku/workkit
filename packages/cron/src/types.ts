import type { ScheduledEvent, ExecutionContext } from '@workkit/types'

/** A single cron task definition */
export interface CronTask<E = unknown> {
  /** Cron expression (e.g. '0 * * * *') */
  schedule: string
  /** Task handler function */
  handler: CronTaskHandler<E>
}

/** Handler function for a cron task */
export interface CronTaskHandler<E = unknown> {
  (event: ScheduledEvent, env: E, ctx: ExecutionContext): void | Promise<void>
}

/** Map of task name to task definition */
export type CronTaskMap<E = unknown> = Record<string, CronTask<E>>

/** Middleware that wraps a cron task handler */
export interface CronMiddleware<E = unknown> {
  (
    handler: CronTaskHandler<E>,
    taskName: string,
  ): CronTaskHandler<E>
}

/** Options for createCronHandler */
export interface CronHandlerOptions<E = unknown> {
  /** Task definitions keyed by name */
  tasks: CronTaskMap<E>
  /** Middleware to apply to all tasks (applied in order) */
  middleware?: CronMiddleware<E>[]
  /** Called when no task matches the incoming cron expression */
  onNoMatch?: (event: ScheduledEvent, env: E, ctx: ExecutionContext) => void | Promise<void>
}

/** The scheduled handler returned by createCronHandler */
export interface CronHandler<E = unknown> {
  (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void>
}

/** Parsed cron expression fields */
export interface ParsedCron {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

/** A single cron field — set of allowed values */
export type CronField = Set<number>

/** Lock options for distributed locking */
export interface LockOptions {
  /** Lock TTL in seconds (default: 300) */
  ttl?: number
  /** Value to store in the lock key (default: auto-generated) */
  lockValue?: string
}

/** Minimal KV interface needed for locking */
export interface LockKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

/** Result of a lock acquisition attempt */
export interface LockResult {
  acquired: boolean
  release: () => Promise<void>
}

/** Retry options for withRetry middleware */
export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the initial attempt) */
  maxRetries: number
  /** Base delay in ms between retries (default: 1000) */
  baseDelay?: number
  /** Whether to use exponential backoff (default: true) */
  exponential?: boolean
}

/** Error reporting function */
export interface ErrorReporter<E = unknown> {
  (error: unknown, taskName: string, event: ScheduledEvent, env: E): void | Promise<void>
}
