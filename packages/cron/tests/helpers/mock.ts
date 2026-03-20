import type { ScheduledEvent, ExecutionContext } from '@workkit/types'
import type { LockKV } from '../../src/types'

export function createMockEvent(cron: string, scheduledTime?: number): ScheduledEvent {
  let retried = true
  return {
    cron,
    scheduledTime: scheduledTime ?? Date.now(),
    noRetry() {
      retried = false
    },
  }
}

export function createMockCtx(): ExecutionContext & { promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = []
  return {
    promises,
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise)
    },
    passThroughOnException() {},
    abort(_reason?: any) {},
  }
}

export function createMockKV(): LockKV & { _store: Map<string, { value: string; expiry?: number }> } {
  const store = new Map<string, { value: string; expiry?: number }>()

  return {
    _store: store,
    async get(key: string): Promise<string | null> {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiry && Date.now() > entry.expiry) {
        store.delete(key)
        return null
      }
      return entry.value
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      const expiry = options?.expirationTtl
        ? Date.now() + options.expirationTtl * 1000
        : undefined
      store.set(key, { value, expiry })
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
  }
}
