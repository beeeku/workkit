import { assertR2Binding, validateR2Key, wrapR2Error } from "./errors";
import type {
	R2ClientOptions,
	R2GetOptions,
	R2ListOptions,
	R2ListPage,
	R2PutOptions,
	TypedR2Object,
	TypedR2ObjectBody,
	WorkkitR2,
} from "./types";

/**
 * Create a typed R2 client from a Cloudflare R2 bucket binding.
 *
 * Wraps the raw R2 API with typed metadata, automatic pagination,
 * and ergonomic error handling.
 *
 * @param binding - The R2Bucket binding from the worker env.
 * @param options - Optional config: defaultHttpMetadata.
 * @returns A WorkkitR2 instance with get/put/delete/head/list methods.
 *
 * @example
 * ```ts
 * const bucket = r2<AvatarMeta>(env.MY_BUCKET)
 * await bucket.put('avatars/123.png', imageData, {
 *   httpMetadata: { contentType: 'image/png' },
 *   customMetadata: { userId: '123' },
 * })
 * const obj = await bucket.get('avatars/123.png')
 * ```
 */
export function r2<M extends Record<string, string> = Record<string, string>>(
	binding: R2Bucket,
	options?: R2ClientOptions,
): WorkkitR2<M> {
	assertR2Binding(binding);

	const defaultHttpMetadata = options?.defaultHttpMetadata;

	return {
		async get(key: string, opts?: R2GetOptions): Promise<TypedR2ObjectBody<M> | null> {
			validateR2Key(key);
			try {
				const r2Options: R2GetOptions = {};
				if (opts?.onlyIf) r2Options.onlyIf = opts.onlyIf;
				if (opts?.range) r2Options.range = opts.range;

				const result = await binding.get(key, r2Options as any);
				if (!result) return null;
				return result as unknown as TypedR2ObjectBody<M>;
			} catch (err) {
				wrapR2Error(err, { key, operation: "get" });
			}
		},

		async head(key: string): Promise<TypedR2Object<M> | null> {
			validateR2Key(key);
			try {
				const result = await binding.head(key);
				if (!result) return null;
				return result as unknown as TypedR2Object<M>;
			} catch (err) {
				wrapR2Error(err, { key, operation: "head" });
			}
		},

		async put(
			key: string,
			value: ReadableStream | ArrayBuffer | string | Blob | null,
			opts?: R2PutOptions<M>,
		): Promise<TypedR2Object<M>> {
			validateR2Key(key);
			try {
				const r2Options: any = {};

				// Merge default HTTP metadata with per-call overrides
				const httpMetadata = opts?.httpMetadata ?? defaultHttpMetadata;
				if (httpMetadata) r2Options.httpMetadata = httpMetadata;
				if (opts?.customMetadata) r2Options.customMetadata = opts.customMetadata;
				if (opts?.md5) r2Options.md5 = opts.md5;
				if (opts?.sha1) r2Options.sha1 = opts.sha1;
				if (opts?.sha256) r2Options.sha256 = opts.sha256;

				const result = await binding.put(key, value as any, r2Options);
				return result as unknown as TypedR2Object<M>;
			} catch (err) {
				wrapR2Error(err, { key, operation: "put" });
			}
		},

		async delete(keys: string | string[]): Promise<void> {
			const keyArray = Array.isArray(keys) ? keys : [keys];
			for (const key of keyArray) {
				validateR2Key(key);
			}
			try {
				await binding.delete(keyArray.length === 1 ? keyArray[0] : keyArray);
			} catch (err) {
				const key = Array.isArray(keys) ? keys.join(", ") : keys;
				wrapR2Error(err, { key, operation: "delete" });
			}
		},

		async *list(opts?: R2ListOptions): AsyncGenerator<TypedR2Object<M>, void, undefined> {
			let cursor: string | undefined = opts?.cursor;

			do {
				const listOptions: any = {
					limit: opts?.limit ?? 1000,
				};
				if (opts?.prefix) listOptions.prefix = opts.prefix;
				if (cursor) listOptions.cursor = cursor;
				if (opts?.delimiter) listOptions.delimiter = opts.delimiter;
				if (opts?.startAfter) listOptions.startAfter = opts.startAfter;
				if (opts?.include) listOptions.include = opts.include;

				let page: any;
				try {
					page = await binding.list(listOptions);
				} catch (err) {
					wrapR2Error(err, { operation: "list" });
				}

				for (const obj of page.objects) {
					yield obj as unknown as TypedR2Object<M>;
				}

				if (!page.truncated) break;
				cursor = page.cursor;
			} while (cursor);
		},

		async listPage(opts?: R2ListOptions): Promise<R2ListPage<M>> {
			const listOptions: any = {
				limit: opts?.limit ?? 1000,
			};
			if (opts?.prefix) listOptions.prefix = opts.prefix;
			if (opts?.cursor) listOptions.cursor = opts.cursor;
			if (opts?.delimiter) listOptions.delimiter = opts.delimiter;
			if (opts?.startAfter) listOptions.startAfter = opts.startAfter;
			if (opts?.include) listOptions.include = opts.include;

			try {
				const page = await binding.list(listOptions);
				return {
					objects: (page as any).objects as TypedR2Object<M>[],
					truncated: page.truncated,
					cursor: page.truncated ? (page as any).cursor : undefined,
					delimitedPrefixes: (page as any).delimitedPrefixes ?? [],
				};
			} catch (err) {
				wrapR2Error(err, { operation: "list" });
			}
		},

		raw: binding,
	};
}
