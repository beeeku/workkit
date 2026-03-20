import { createMemoryCache } from "./memory";
import type { CachePutOptions, TaggedCacheConfig, TaggedCacheInstance, TypedCache } from "./types";

const DEFAULT_BASE_URL = "https://cache.local";

/**
 * Create a tagged cache that supports tag-based invalidation.
 *
 * Wraps an underlying cache and maintains an in-memory tag-to-key mapping.
 * When a tag is invalidated, all associated cache entries are purged.
 *
 * @example
 * ```ts
 * const tc = taggedCache()
 *
 * await tc.put('/api/users/123', response, { tags: ['user:123', 'users'] })
 * await tc.put('/api/users/456', response, { tags: ['user:456', 'users'] })
 *
 * await tc.invalidateTag('users')      // purges both entries
 * await tc.invalidateTag('user:123')   // purges only user 123
 * ```
 */
export function taggedCache(config?: TaggedCacheConfig): TaggedCacheInstance {
	const cache: TypedCache =
		config?.cache ??
		createMemoryCache({
			baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
		});

	// Tag → Set of cache keys
	const tagToKeys = new Map<string, Set<string>>();
	// Key → Set of tags
	const keyToTags = new Map<string, Set<string>>();

	function addMapping(key: string, tags: string[]): void {
		if (tags.length === 0) return;

		let keyTags = keyToTags.get(key);
		if (!keyTags) {
			keyTags = new Set();
			keyToTags.set(key, keyTags);
		}

		for (const tag of tags) {
			keyTags.add(tag);

			let keys = tagToKeys.get(tag);
			if (!keys) {
				keys = new Set();
				tagToKeys.set(tag, keys);
			}
			keys.add(key);
		}
	}

	function removeMapping(key: string): void {
		const tags = keyToTags.get(key);
		if (!tags) return;

		for (const tag of tags) {
			const keys = tagToKeys.get(tag);
			if (keys) {
				keys.delete(key);
				if (keys.size === 0) {
					tagToKeys.delete(tag);
				}
			}
		}

		keyToTags.delete(key);
	}

	return {
		async put(
			key: string,
			response: Response,
			options?: CachePutOptions & { tags?: string[] },
		): Promise<void> {
			// Remove old mappings if re-putting the same key
			removeMapping(key);

			await cache.put(key, response, options);

			if (options?.tags && options.tags.length > 0) {
				addMapping(key, options.tags);
			}
		},

		async get(key: string): Promise<Response | undefined> {
			return cache.get(key);
		},

		async delete(key: string): Promise<boolean> {
			removeMapping(key);
			return cache.delete(key);
		},

		async invalidateTag(tag: string): Promise<number> {
			const keys = tagToKeys.get(tag);
			if (!keys || keys.size === 0) return 0;

			// Copy the set since we'll be modifying it during iteration
			const keyList = [...keys];
			let count = 0;

			for (const key of keyList) {
				removeMapping(key);
				const deleted = await cache.delete(key);
				if (deleted) count++;
			}

			return count;
		},

		getTags(key: string): string[] {
			const tags = keyToTags.get(key);
			return tags ? [...tags] : [];
		},

		getKeysByTag(tag: string): string[] {
			const keys = tagToKeys.get(tag);
			return keys ? [...keys] : [];
		},
	};
}
