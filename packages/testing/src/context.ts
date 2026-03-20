/**
 * Mock ExecutionContext for Cloudflare Workers tests.
 * waitUntil collects promises in _promises for test assertions.
 * passThroughOnException is a no-op.
 */
export function createExecutionContext(): ExecutionContext & { _promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = []

  return {
    _promises: promises,

    waitUntil(promise: Promise<unknown>): void {
      promises.push(promise)
    },

    passThroughOnException(): void {
      // no-op
    },

    abort(_reason?: any): void {
      // no-op in test context
    },
  } as any
}
