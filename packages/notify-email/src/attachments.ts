import { AttachmentTooLargeError } from "./errors";

export interface AttachmentSpec {
	filename: string;
	r2Key: string;
	type?: string; // optional content-type override
}

export interface AttachmentBlob {
	filename: string;
	contentType: string;
	bytes: Uint8Array;
}

interface R2BucketLike {
	get(key: string): Promise<{
		arrayBuffer: () => Promise<ArrayBuffer>;
		httpMetadata?: { contentType?: string };
	} | null>;
}

export interface AttachmentLoadOptions {
	/** Total payload cap in bytes. Default 40 MB (Resend's documented cap). */
	maxTotalBytes?: number;
	/** Bounded concurrency for R2 fetches. Default 4. */
	concurrency?: number;
}

const DEFAULT_MAX_TOTAL = 40 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;

/**
 * Fetch attachments from R2 with bounded concurrency. Throws
 * `AttachmentTooLargeError` if the cumulative payload exceeds the cap.
 */
export async function loadAttachments(
	bucket: R2BucketLike,
	specs: ReadonlyArray<AttachmentSpec>,
	options: AttachmentLoadOptions = {},
): Promise<AttachmentBlob[]> {
	if (specs.length === 0) return [];
	const cap = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL;
	const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

	const out: AttachmentBlob[] = new Array(specs.length);
	let total = 0;
	let cursor = 0;
	const errors: Error[] = [];

	async function worker(): Promise<void> {
		while (cursor < specs.length && errors.length === 0) {
			const i = cursor++;
			const spec = specs[i]!;
			try {
				const obj = await bucket.get(spec.r2Key);
				if (!obj) {
					throw new Error(`R2 object missing: ${spec.r2Key}`);
				}
				const buf = await obj.arrayBuffer();
				const bytes = new Uint8Array(buf);
				total += bytes.byteLength;
				if (total > cap) {
					throw new AttachmentTooLargeError(total, cap);
				}
				out[i] = {
					filename: spec.filename,
					contentType: spec.type ?? obj.httpMetadata?.contentType ?? "application/octet-stream",
					bytes,
				};
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
				return;
			}
		}
	}

	const promises: Promise<void>[] = [];
	for (let i = 0; i < Math.min(concurrency, specs.length); i++) promises.push(worker());
	await Promise.all(promises);
	if (errors.length > 0) throw errors[0];
	return out;
}
