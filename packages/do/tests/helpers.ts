import type { TypedDurableObjectStorage, DurableObjectStorageListOptions } from '@workkit/types'

/**
 * Creates an in-memory mock of TypedDurableObjectStorage for testing.
 * Uses a Map internally to store data.
 */
export function createMockStorage() {
	const data = new Map<string, unknown>()
	let alarm: number | null = null

	const storage: TypedDurableObjectStorage & {
		_data: Map<string, unknown>
		_alarm: number | null
	} = {
		_data: data,
		get _alarm() {
			return alarm
		},
		set _alarm(v: number | null) {
			alarm = v
		},

		async get<T>(keyOrKeys: string | string[]): Promise<any> {
			if (Array.isArray(keyOrKeys)) {
				const result = new Map<string, T>()
				for (const key of keyOrKeys) {
					if (data.has(key)) {
						result.set(key, data.get(key) as T)
					}
				}
				return result
			}
			return data.get(keyOrKeys) as T | undefined
		},

		async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
			if (typeof keyOrEntries === 'string') {
				data.set(keyOrEntries, value)
			} else {
				for (const [k, v] of Object.entries(keyOrEntries)) {
					data.set(k, v)
				}
			}
		},

		async delete(keyOrKeys: string | string[]): Promise<any> {
			if (Array.isArray(keyOrKeys)) {
				let count = 0
				for (const key of keyOrKeys) {
					if (data.delete(key)) count++
				}
				return count
			}
			return data.delete(keyOrKeys)
		},

		async deleteAll(): Promise<void> {
			data.clear()
		},

		async list<T>(options?: DurableObjectStorageListOptions): Promise<Map<string, T>> {
			const result = new Map<string, T>()
			const entries = [...data.entries()].sort(([a], [b]) => a.localeCompare(b))
			for (const [key, value] of entries) {
				if (options?.prefix && !key.startsWith(options.prefix)) continue
				if (options?.start && key < options.start) continue
				if (options?.startAfter && key <= options.startAfter) continue
				if (options?.end && key >= options.end) continue
				if (options?.limit && result.size >= options.limit) break
				result.set(key, value as T)
			}
			if (options?.reverse) {
				const reversed = new Map<string, T>()
				const arr = [...result.entries()].reverse()
				for (const [k, v] of arr) reversed.set(k, v)
				return reversed
			}
			return result
		},

		async transaction<T>(closure: (txn: TypedDurableObjectStorage) => Promise<T>): Promise<T> {
			// Snapshot for rollback
			const snapshot = new Map(data)
			try {
				const result = await closure(storage)
				return result
			} catch (err) {
				// Rollback
				data.clear()
				for (const [k, v] of snapshot) {
					data.set(k, v)
				}
				throw err
			}
		},

		async getAlarm(): Promise<number | null> {
			return alarm
		},

		async setAlarm(scheduledTime: number | Date): Promise<void> {
			alarm = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime
		},

		async deleteAlarm(): Promise<void> {
			alarm = null
		},
	}

	return storage
}
