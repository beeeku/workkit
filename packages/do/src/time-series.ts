import type { TypedDurableObjectStorage } from "@workkit/types";
import { parseDuration } from "./alarm";

/** A single time-series data point */
export interface TimeSeriesEntry<TValue> {
	bucket: Date;
	value: TValue;
	count: number;
}

/** Internal representation used for DO storage reads/writes */
interface StoredTimeSeriesEntry<TValue> {
	bucket: string;
	value: TValue;
	count: number;
}

/** Options for creating a time series */
export interface TimeSeriesOptions<TValue> {
	prefix: string;
	granularity: "minute" | "hour" | "day";
	/** Retention period as duration string (e.g. '7d'). Default: '7d' */
	retention?: string;
	/** Reducer for aggregating values. Default: numeric sum */
	reducer?: (existing: TValue, incoming: TValue) => TValue;
}

/** A time-bucketed aggregation store */
export interface TimeSeries<TValue> {
	record(value: TValue, at?: Date): Promise<void>;
	query(from: Date, to: Date): Promise<TimeSeriesEntry<TValue>[]>;
	rollup(granularity: "hour" | "day"): Promise<TimeSeriesEntry<TValue>[]>;
	prune(): Promise<number>;
}

function truncateToBucket(date: Date, granularity: "minute" | "hour" | "day"): Date {
	const d = new Date(date);
	d.setUTCMilliseconds(0);
	d.setUTCSeconds(0);
	if (granularity === "minute") return d;
	d.setUTCMinutes(0);
	if (granularity === "hour") return d;
	d.setUTCHours(0);
	return d;
}

function storageKey(prefix: string, granularity: string, bucket: Date): string {
	return `${prefix}:${granularity}:${bucket.toISOString()}`;
}

function defaultNumericReducer(existing: number, incoming: number): number {
	return existing + incoming;
}

/**
 * Creates a time-bucketed aggregation store for metrics in DO storage.
 *
 * ```ts
 * const ts = createTimeSeries(storage, {
 *   prefix: 'api_requests',
 *   granularity: 'minute',
 *   retention: '7d',
 * })
 *
 * await ts.record(1)
 * const results = await ts.query(from, to)
 * ```
 */
export function createTimeSeries<TValue = number>(
	storage: TypedDurableObjectStorage,
	options: TimeSeriesOptions<TValue>,
): TimeSeries<TValue> {
	const { prefix, granularity, retention = "7d" } = options;
	const reducer = (options.reducer ?? defaultNumericReducer) as (
		existing: TValue,
		incoming: TValue,
	) => TValue;
	const keyPrefix = `${prefix}:${granularity}:`;

	return {
		async record(value: TValue, at?: Date): Promise<void> {
			const bucket = truncateToBucket(at ?? new Date(), granularity);
			const key = storageKey(prefix, granularity, bucket);

			const existing = await storage.get<StoredTimeSeriesEntry<TValue>>(key);
			if (existing) {
				existing.value = reducer(existing.value, value);
				existing.count += 1;
				await storage.put(key, existing);
			} else {
				await storage.put(key, { bucket: bucket.toISOString(), value, count: 1 });
			}
		},

		async query(from: Date, to: Date): Promise<TimeSeriesEntry<TValue>[]> {
			const entries = await storage.list<StoredTimeSeriesEntry<TValue>>({
				prefix: keyPrefix,
			});

			const results: TimeSeriesEntry<TValue>[] = [];
			const fromMs = from.getTime();
			const toMs = to.getTime();

			for (const [, entry] of entries) {
				const bucketDate = new Date(entry.bucket);
				const bucketMs = bucketDate.getTime();
				if (bucketMs >= fromMs && bucketMs < toMs) {
					results.push({
						bucket: bucketDate,
						value: entry.value,
						count: entry.count,
					});
				}
			}

			results.sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
			return results;
		},

		async rollup(targetGranularity: "hour" | "day"): Promise<TimeSeriesEntry<TValue>[]> {
			const entries = await storage.list<StoredTimeSeriesEntry<TValue>>({
				prefix: keyPrefix,
			});

			const buckets = new Map<string, TimeSeriesEntry<TValue>>();

			for (const [, entry] of entries) {
				const originalBucket = new Date(entry.bucket);
				const rollupBucket = truncateToBucket(originalBucket, targetGranularity);
				const rollupKey = rollupBucket.toISOString();

				const existing = buckets.get(rollupKey);
				if (existing) {
					existing.value = reducer(existing.value, entry.value);
					existing.count += entry.count;
				} else {
					buckets.set(rollupKey, {
						bucket: rollupBucket,
						value: entry.value,
						count: entry.count,
					});
				}
			}

			const results = [...buckets.values()];
			results.sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
			return results;
		},

		async prune(): Promise<number> {
			const retentionMs = parseDuration(retention);
			const cutoff = Date.now() - retentionMs;

			const entries = await storage.list<StoredTimeSeriesEntry<TValue>>({ prefix: keyPrefix });
			const keysToDelete: string[] = [];

			for (const [key, entry] of entries) {
				const bucketDate = new Date(entry.bucket);
				if (bucketDate.getTime() < cutoff) {
					keysToDelete.push(key);
				}
			}

			if (keysToDelete.length > 0) {
				await storage.delete(keysToDelete);
			}

			return keysToDelete.length;
		},
	};
}
