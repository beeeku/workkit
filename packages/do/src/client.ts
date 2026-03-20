import type { DOClient } from './types'

/**
 * Creates a typed RPC-style client for a Durable Object stub.
 *
 * Each method call on the returned client sends a POST request to the stub
 * with the method name as the URL path and arguments as the JSON body.
 * The response is parsed as JSON and returned.
 *
 * The target DO should handle these requests by parsing the path and body.
 *
 * ```ts
 * interface CounterAPI {
 *   increment(amount: number): Promise<number>
 *   getCount(): Promise<number>
 * }
 *
 * const counter = createDOClient<CounterAPI>(env.COUNTER, id)
 * const count = await counter.increment(5)  // typed!
 * ```
 */
export function createDOClient<T extends Record<string, (...args: any[]) => Promise<any>>>(
	namespace: { get(id: any): { fetch(input: Request | string, init?: RequestInit): Promise<Response> } },
	id: { toString(): string },
): DOClient<T> {
	const stub = namespace.get(id)

	return new Proxy({} as DOClient<T>, {
		get(_target, prop: string) {
			return async (...args: unknown[]) => {
				const request = new Request(`https://do-rpc.internal/${prop}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(args),
				})

				const response = await stub.fetch(request)

				if (!response.ok) {
					const errorBody = await response.text()
					let message: string
					try {
						const parsed = JSON.parse(errorBody)
						message = parsed.error || parsed.message || errorBody
					} catch {
						message = errorBody
					}
					throw new Error(`DO RPC call "${prop}" failed (${response.status}): ${message}`)
				}

				return response.json()
			}
		},
	})
}

/**
 * Creates a Durable Object stub from a namespace using a named ID.
 * Useful for singleton patterns where you want a well-known instance.
 *
 * ```ts
 * const rateLimiter = singleton(env.RATE_LIMITER, 'global')
 * const config = singleton(env.CONFIG, 'main')
 * ```
 */
export function singleton<
	TStub extends { fetch(input: Request | string, init?: RequestInit): Promise<Response> },
>(
	namespace: { idFromName(name: string): unknown; get(id: unknown): TStub },
	name: string,
): TStub {
	const id = namespace.idFromName(name)
	return namespace.get(id)
}
