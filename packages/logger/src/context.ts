import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestContext } from "./types";

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Get the current request context from AsyncLocalStorage.
 * Returns undefined if called outside of a request context.
 *
 * @example
 * ```ts
 * const ctx = getRequestContext()
 * if (ctx) {
 *   console.log(ctx.requestId) // "abc-123"
 * }
 * ```
 */
export function getRequestContext(): RequestContext | undefined {
	return storage.getStore();
}

/**
 * Run a function within a request context.
 * All code called within `fn` can access the context via `getRequestContext()`.
 *
 * @example
 * ```ts
 * await runWithContext({ requestId: "abc", method: "GET", path: "/", startTime: Date.now(), fields: {} }, async () => {
 *   const ctx = getRequestContext()
 *   // ctx.requestId === "abc"
 * })
 * ```
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn);
}
