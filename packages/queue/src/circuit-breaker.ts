import type { TypedMessageBatch } from "@workkit/types";
import { parseDuration } from "./duration";
import type {
	CircuitBreakerOptions,
	CircuitBreakerState,
	ConsumerHandler,
	ConsumerMessage,
} from "./types";

const DEFAULT_HALF_OPEN_MAX = 1;

/**
 * Wrap a consumer handler with circuit breaker fault tolerance.
 *
 * Tracks failure rates in KV and short-circuits when a downstream
 * dependency is failing, preventing cascade failures.
 *
 * Three states:
 * - **Closed** (normal): Messages processed normally. Failures counted.
 *   When failureThreshold is reached → Open.
 * - **Open** (tripped): All messages retried with delay. After resetTimeout → Half-Open.
 * - **Half-Open** (probing): Allow halfOpenMax messages through.
 *   Success → Closed. Failure → Open.
 *
 * **Note:** Circuit state is stored in KV, which is eventually consistent.
 * In high-concurrency scenarios, multiple workers may read stale state,
 * resulting in approximate (not exact) failure counting.
 *
 * @example
 * ```ts
 * const handler = withCircuitBreaker<UserEvent>(
 *   createConsumer({ async process(msg) { await callDownstream(msg.body) } }),
 *   {
 *     namespace: env.CIRCUIT_KV,
 *     key: "downstream-api",
 *     failureThreshold: 5,
 *     resetTimeout: "30s",
 *   }
 * )
 * ```
 */
export function withCircuitBreaker<Body>(
	consumer: ConsumerHandler<Body>,
	options: CircuitBreakerOptions,
): ConsumerHandler<Body> {
	const {
		namespace,
		key,
		failureThreshold,
		resetTimeout,
		halfOpenMax = DEFAULT_HALF_OPEN_MAX,
	} = options;
	const resetTimeoutMs = parseDuration(resetTimeout);

	return async (batch: TypedMessageBatch<Body>, env: unknown): Promise<void> => {
		const messages = batch.messages as unknown as ConsumerMessage<Body>[];

		// Read current state from KV
		const state = await readState(namespace, key);

		const now = Date.now();

		// Handle open state
		if (state.state === "open") {
			const elapsed = now - state.openedAt;
			if (elapsed >= resetTimeoutMs) {
				// Transition to half-open
				state.state = "half-open";
				state.halfOpenAttempts = 0;
			} else {
				// Still open — retry all messages
				for (const msg of messages) {
					msg.retry();
				}
				return;
			}
		}

		// Handle half-open state — allow only halfOpenMax messages
		if (state.state === "half-open") {
			const probeMessages = messages.slice(0, halfOpenMax);
			const retryMessages = messages.slice(halfOpenMax);

			// Retry messages beyond the probe limit
			for (const msg of retryMessages) {
				msg.retry();
			}

			// Create a sub-batch with only probe messages
			const probeBatch = {
				...batch,
				messages: probeMessages,
			} as TypedMessageBatch<Body>;

			try {
				await consumer(probeBatch, env);
				// Success — close circuit
				state.state = "closed";
				state.failures = 0;
				state.halfOpenAttempts = 0;
			} catch {
				// Failure — re-open circuit
				state.state = "open";
				state.openedAt = now;
				state.lastFailure = now;
			}

			await writeState(namespace, key, state);
			return;
		}

		// Closed state — process normally
		try {
			await consumer(batch, env);
			// Success — reset failures
			state.failures = 0;
		} catch {
			// Failure — increment count
			state.failures++;
			state.lastFailure = now;

			if (state.failures >= failureThreshold) {
				state.state = "open";
				state.openedAt = now;
			}
		}

		await writeState(namespace, key, state);
	};
}

async function readState(namespace: KVNamespace, key: string): Promise<CircuitBreakerState> {
	const raw = await namespace.get(key, "json");
	if (raw) return raw as CircuitBreakerState;

	return {
		state: "closed",
		failures: 0,
		lastFailure: 0,
		openedAt: 0,
		halfOpenAttempts: 0,
	};
}

async function writeState(
	namespace: KVNamespace,
	key: string,
	state: CircuitBreakerState,
): Promise<void> {
	await namespace.put(key, JSON.stringify(state));
}
