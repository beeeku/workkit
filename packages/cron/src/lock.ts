import type { ScheduledEvent, ExecutionContext } from '@workkit/types'
import type { CronTaskHandler, LockKV, LockOptions, LockResult } from './types'

/**
 * Attempt to acquire a distributed lock using KV.
 *
 * @param kv KV namespace to use for locking
 * @param key Lock key
 * @param options Lock configuration
 * @returns Lock result with acquired status and release function
 *
 * @remarks
 * This is a best-effort lock using KV eventual consistency. It reduces duplicate
 * execution but does NOT guarantee mutual exclusion. For strict locking, use
 * Durable Objects. Suitable for reducing redundant work in cron jobs where
 * occasional duplicate execution is acceptable.
 */
export async function acquireLock(
  kv: LockKV,
  key: string,
  options: LockOptions = {},
): Promise<LockResult> {
  const { ttl = 300, lockValue } = options
  const value = lockValue ?? `lock-${Date.now()}-${Math.random().toString(36).slice(2)}`

  // Check if lock exists
  const existing = await kv.get(key)
  if (existing !== null) {
    return {
      acquired: false,
      release: async () => {},
    }
  }

  // Acquire lock with TTL
  await kv.put(key, value, { expirationTtl: ttl })

  // Verify we got the lock (best-effort, KV doesn't support CAS)
  const stored = await kv.get(key)
  if (stored !== value) {
    return {
      acquired: false,
      release: async () => {},
    }
  }

  return {
    acquired: true,
    release: async () => {
      // Only release if we still hold it
      const current = await kv.get(key)
      if (current === value) {
        await kv.delete(key)
      }
    },
  }
}

/**
 * Wrap a cron task handler with distributed locking.
 * The handler only executes if the lock is successfully acquired.
 * The lock is always released after the handler completes (or fails).
 *
 * @param getKV Function to extract KV namespace from env
 * @param lockKey Key to use for the lock
 * @param options Lock configuration
 * @param handler The task handler to wrap
 * @returns A new handler that acquires a lock before executing
 *
 * @remarks
 * This is a best-effort lock using KV eventual consistency. It reduces duplicate
 * execution but does NOT guarantee mutual exclusion. For strict locking, use
 * Durable Objects. Suitable for reducing redundant work in cron jobs where
 * occasional duplicate execution is acceptable.
 */
export function withLock<E>(
  getKV: (env: E) => LockKV,
  lockKey: string,
  options: LockOptions,
  handler: CronTaskHandler<E>,
): CronTaskHandler<E> {
  return async (
    event: ScheduledEvent,
    env: E,
    ctx: ExecutionContext,
  ): Promise<void> => {
    const kv = getKV(env)
    const lock = await acquireLock(kv, lockKey, options)

    if (!lock.acquired) {
      return // Skip — another instance holds the lock
    }

    try {
      await handler(event, env, ctx)
    } finally {
      await lock.release()
    }
  }
}
