import type { TypedDurableObjectStorage } from "@workkit/types";
import type { TypedStorageWrapper } from "./types";

/**
 * Wraps a DurableObjectStorage (or TypedDurableObjectStorage) with a typed
 * schema so that get/put/delete are type-checked against the schema keys and values.
 *
 * ```ts
 * const storage = typedStorage<{ count: number; name: string }>(state.storage)
 * const count = await storage.get('count')  // number | undefined
 * await storage.put('count', 42)            // type-checked
 * ```
 */
export function typedStorage<TSchema extends Record<string, unknown>>(
	raw: TypedDurableObjectStorage,
): TypedStorageWrapper<TSchema> {
	return {
		async get<K extends keyof TSchema & string>(key: K): Promise<TSchema[K] | undefined> {
			return raw.get<TSchema[K]>(key);
		},

		async put<K extends keyof TSchema & string>(key: K, value: TSchema[K]): Promise<void> {
			return raw.put(key, value);
		},

		async delete<K extends keyof TSchema & string>(key: K): Promise<boolean> {
			return raw.delete(key);
		},

		async list(): Promise<Map<string, unknown>> {
			return raw.list();
		},

		async transaction<R>(closure: (txn: TypedStorageWrapper<TSchema>) => Promise<R>): Promise<R> {
			return raw.transaction(async (txnRaw) => {
				const txnTyped = typedStorage<TSchema>(txnRaw);
				return closure(txnTyped);
			});
		},
	};
}
