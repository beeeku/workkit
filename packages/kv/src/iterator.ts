import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Serializer } from "./serializer";
import type { KVEntry, KVKeyEntry } from "./types";
import { validateValue } from "./validation";

/**
 * Creates an AsyncIterable that automatically handles KV list cursors.
 * The consumer just uses `for await` -- cursor management is invisible.
 */
export async function* createValueListIterator<T>(
	namespace: KVNamespace,
	options: {
		prefix?: string;
		limit?: number;
		serializer: Serializer<T>;
		schema?: StandardSchemaV1<unknown, T>;
	},
): AsyncGenerator<KVEntry<T>> {
	let cursor: string | undefined;
	let remaining = options.limit;

	do {
		const pageLimit = remaining ? Math.min(remaining, 1000) : 1000;

		const result = await namespace.list({
			prefix: options.prefix,
			limit: pageLimit,
			cursor,
		});

		for (const kvKey of result.keys) {
			let value: T | null = null;

			const raw = await namespace.get(kvKey.name, "text");
			if (raw !== null) {
				try {
					value = options.serializer.deserialize(raw);
					if (options.schema) {
						value = await validateValue(options.schema, value, kvKey.name);
					}
				} catch {
					value = null; // deserialization/validation failed -- yield null
				}
			}

			yield {
				key: kvKey.name, // prefix stripping handled by caller
				value,
				expiration: kvKey.expiration,
				metadata: kvKey.metadata,
			};

			if (remaining !== undefined) {
				remaining--;
				if (remaining <= 0) return;
			}
		}

		cursor = result.list_complete ? undefined : result.cursor;
	} while (cursor);
}

/**
 * Keys-only iterator -- no value fetching.
 * Much faster for large datasets when you only need key names.
 */
export async function* createKeysIterator(
	namespace: KVNamespace,
	options: {
		prefix?: string;
		limit?: number;
	},
): AsyncGenerator<KVKeyEntry> {
	let cursor: string | undefined;
	let remaining = options.limit;

	do {
		const pageLimit = remaining ? Math.min(remaining, 1000) : 1000;

		const result = await namespace.list({
			prefix: options.prefix,
			limit: pageLimit,
			cursor,
		});

		for (const kvKey of result.keys) {
			yield {
				key: kvKey.name,
				expiration: kvKey.expiration,
				metadata: kvKey.metadata,
			};

			if (remaining !== undefined) {
				remaining--;
				if (remaining <= 0) return;
			}
		}

		cursor = result.list_complete ? undefined : result.cursor;
	} while (cursor);
}
