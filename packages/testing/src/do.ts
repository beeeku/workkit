/**
 * In-memory DurableObjectStorage mock for unit testing.
 */
export function createMockDO(): DurableObjectStorage & {
	_store: Map<string, unknown>;
	_alarm: number | null;
} {
	const store = new Map<string, unknown>();
	let alarm: number | null = null;

	function createStorageApi(targetStore: Map<string, unknown>) {
		return {
			async get(keyOrKeys: string | string[]): Promise<any> {
				if (Array.isArray(keyOrKeys)) {
					const result = new Map<string, unknown>();
					for (const key of keyOrKeys) {
						if (targetStore.has(key)) {
							result.set(key, targetStore.get(key));
						}
					}
					return result;
				}
				return targetStore.get(keyOrKeys);
			},

			async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
				if (typeof keyOrEntries === "string") {
					targetStore.set(keyOrEntries, value);
				} else {
					for (const [k, v] of Object.entries(keyOrEntries)) {
						targetStore.set(k, v);
					}
				}
			},

			async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
				if (Array.isArray(keyOrKeys)) {
					let count = 0;
					for (const key of keyOrKeys) {
						if (targetStore.delete(key)) count++;
					}
					return count;
				}
				return targetStore.delete(keyOrKeys);
			},

			async list(options?: {
				prefix?: string;
				start?: string;
				end?: string;
				limit?: number;
				reverse?: boolean;
			}): Promise<Map<string, unknown>> {
				let entries = [...targetStore.entries()].sort(([a], [b]) => a.localeCompare(b));

				if (options?.prefix) {
					entries = entries.filter(([k]) => k.startsWith(options.prefix!));
				}
				if (options?.start) {
					entries = entries.filter(([k]) => k >= options.start!);
				}
				if (options?.end) {
					entries = entries.filter(([k]) => k < options.end!);
				}
				if (options?.reverse) {
					entries.reverse();
				}
				if (options?.limit) {
					entries = entries.slice(0, options.limit);
				}

				return new Map(entries);
			},
		};
	}

	const api = createStorageApi(store);

	const storage = {
		_store: store,
		_alarm: alarm,

		get: api.get,
		put: api.put,
		delete: api.delete,
		list: api.list,

		async deleteAll(): Promise<void> {
			store.clear();
		},

		async transaction<T>(closure: (txn: DurableObjectStorage) => Promise<T>): Promise<T> {
			// Create a snapshot for rollback
			const snapshot = new Map(store);
			try {
				// Create a transactional storage that operates on the real store
				const txnApi = createStorageApi(store);
				const txnStorage = {
					...txnApi,
					getAlarm: storage.getAlarm,
					setAlarm: storage.setAlarm,
					deleteAlarm: storage.deleteAlarm,
					deleteAll: storage.deleteAll,
					transaction: storage.transaction,
				} as unknown as DurableObjectStorage;
				return await closure(txnStorage);
			} catch (e) {
				// Rollback: restore snapshot
				store.clear();
				for (const [k, v] of snapshot) {
					store.set(k, v);
				}
				throw e;
			}
		},

		async getAlarm(): Promise<number | null> {
			return alarm;
		},

		async setAlarm(scheduledTime: number | Date): Promise<void> {
			alarm = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
		},

		async deleteAlarm(): Promise<void> {
			alarm = null;
		},

		// Stubs for sync methods
		sync(): Promise<void> {
			return Promise.resolve();
		},
	};

	return storage as any;
}
