import type { KVListEntry, ListOptions } from "./types";

export async function* createListIterator<M = unknown>(
	binding: KVNamespace,
	fullPrefix: string,
	namespacePrefix: string,
	options?: ListOptions,
): AsyncGenerator<KVListEntry<M>, void, undefined> {
	let cursor: string | undefined = options?.cursor;
	const limit = options?.limit ?? 1000;

	do {
		const page = await binding.list<M>({
			prefix: fullPrefix || undefined,
			limit,
			cursor,
		});

		for (const key of page.keys) {
			yield {
				name: namespacePrefix ? key.name.slice(namespacePrefix.length) : key.name,
				expiration: key.expiration,
				metadata: key.metadata as M | undefined,
			};
		}

		if (page.list_complete) break;
		cursor = page.cursor;
	} while (cursor);
}
