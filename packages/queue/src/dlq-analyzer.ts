import type {
	ConsumerMessage,
	DLQAnalyzer,
	DLQAnalyzerOptions,
	DLQMetadata,
	DLQSummary,
	ErrorPattern,
} from "./types";

const DEFAULT_PREFIX = "default";
const MAX_ERROR_PATTERNS = 100;
const MAX_SAMPLE_IDS = 5;
const HOUR_TTL_SECONDS = 25 * 60 * 60; // 25 hours

/**
 * Create a DLQ analyzer for tracking failure patterns.
 *
 * Records failures to KV-backed counters, enabling aggregation
 * of error patterns, per-queue breakdowns, and hourly histograms.
 *
 * @example
 * ```ts
 * const analyzer = createDLQAnalyzer<UserEvent>({
 *   namespace: env.DLQ_KV,
 *   prefix: "user-events",
 * })
 *
 * // In your DLQ processor:
 * const dlqHandler = createDLQProcessor<UserEvent>({
 *   async process(message, metadata) {
 *     await analyzer.record(message, metadata, lastError)
 *   },
 * })
 *
 * // Query patterns:
 * const summary = await analyzer.summary()
 * const top = await analyzer.topErrors(5)
 * ```
 */
export function createDLQAnalyzer<Body>(options: DLQAnalyzerOptions<Body>): DLQAnalyzer<Body> {
	const { namespace, prefix = DEFAULT_PREFIX } = options;

	const keyPrefix = `dlq:${prefix}`;

	return {
		async record(
			message: ConsumerMessage<Body>,
			metadata: DLQMetadata,
			error?: unknown,
		): Promise<void> {
			// Increment total counter
			const totalKey = `${keyPrefix}:total`;
			const currentTotal = ((await namespace.get(totalKey, "json")) as number) ?? 0;
			await namespace.put(totalKey, JSON.stringify(currentTotal + 1));

			// Increment per-queue counter
			const queueKey = `${keyPrefix}:queue:${metadata.queue}`;
			const currentQueue = ((await namespace.get(queueKey, "json")) as number) ?? 0;
			await namespace.put(queueKey, JSON.stringify(currentQueue + 1));

			// Increment hourly counter
			const hour = new Date().toISOString().slice(0, 13); // e.g. "2025-01-01T12"
			const hourKey = `${keyPrefix}:hour:${hour}`;
			const currentHour = ((await namespace.get(hourKey, "json")) as number) ?? 0;
			await namespace.put(hourKey, JSON.stringify(currentHour + 1), {
				expirationTtl: HOUR_TTL_SECONDS,
			});

			// Record error pattern
			const errorMessage = extractErrorMessage(error);
			const errorHash = simpleHash(errorMessage);
			const errorKey = `${keyPrefix}:error:${errorHash}`;
			const existing = (await namespace.get(errorKey, "json")) as ErrorPattern | null;

			if (existing) {
				existing.count++;
				existing.lastSeen = new Date();
				if (
					existing.sampleMessageIds.length < MAX_SAMPLE_IDS &&
					!existing.sampleMessageIds.includes(metadata.messageId)
				) {
					existing.sampleMessageIds.push(metadata.messageId);
				}
				await namespace.put(errorKey, JSON.stringify(existing));
			} else {
				// Check if we've hit the max error pattern limit
				const indexKey = `${keyPrefix}:error-index`;
				const index = ((await namespace.get(indexKey, "json")) as string[]) ?? [];

				if (index.length < MAX_ERROR_PATTERNS) {
					const pattern: ErrorPattern = {
						message: errorMessage,
						count: 1,
						lastSeen: new Date(),
						sampleMessageIds: [metadata.messageId],
					};
					await namespace.put(errorKey, JSON.stringify(pattern));
					index.push(errorHash);
					await namespace.put(indexKey, JSON.stringify(index));
				}
			}
		},

		async summary(): Promise<DLQSummary> {
			const totalKey = `${keyPrefix}:total`;
			const total = ((await namespace.get(totalKey, "json")) as number) ?? 0;

			// Read per-queue counters
			const byQueue: Record<string, number> = {};
			const queueList = await namespace.list({ prefix: `${keyPrefix}:queue:` });
			for (const key of queueList.keys) {
				const queueName = key.name.slice(`${keyPrefix}:queue:`.length);
				const count = ((await namespace.get(key.name, "json")) as number) ?? 0;
				byQueue[queueName] = count;
			}

			// Read hourly counters
			const byHour: Record<string, number> = {};
			const hourList = await namespace.list({ prefix: `${keyPrefix}:hour:` });
			for (const key of hourList.keys) {
				const hour = key.name.slice(`${keyPrefix}:hour:`.length);
				const count = ((await namespace.get(key.name, "json")) as number) ?? 0;
				byHour[hour] = count;
			}

			// Read top errors
			const topErrors = await readTopErrors(namespace, keyPrefix);

			return { total, byQueue, byHour, topErrors };
		},

		async topErrors(limit = 10): Promise<ErrorPattern[]> {
			const errors = await readTopErrors(namespace, keyPrefix);
			return errors.slice(0, limit);
		},
	};
}

async function readTopErrors(namespace: KVNamespace, keyPrefix: string): Promise<ErrorPattern[]> {
	const indexKey = `${keyPrefix}:error-index`;
	const index = ((await namespace.get(indexKey, "json")) as string[]) ?? [];

	const patterns: ErrorPattern[] = [];
	for (const hash of index) {
		const errorKey = `${keyPrefix}:error:${hash}`;
		const pattern = (await namespace.get(errorKey, "json")) as ErrorPattern | null;
		if (pattern) {
			// Ensure lastSeen is a Date object
			pattern.lastSeen = new Date(pattern.lastSeen);
			patterns.push(pattern);
		}
	}

	// Sort by count descending
	patterns.sort((a, b) => b.count - a.count);
	return patterns;
}

function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "unknown";
}

function simpleHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0; // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(36);
}
