import { ConfigError, ValidationError } from "@workkit/errors";
import { type RenderPdfOptions, renderPDF } from "./render";
import { safeKey } from "./safe-key";
import type { BrowserSessionLike, R2BucketLike } from "./types";

const MAX_PRESIGN_TTL_S = 86_400; // 24h hard cap on bearer-style URLs.
const DEFAULT_PRESIGN_TTL_S = 3_600;

export type ReadPolicy = "presigned" | "private";

export interface StorePdfOptions extends RenderPdfOptions {
	bucket: R2BucketLike;
	/** Either an already-safe key string, or path parts to feed `safeKey()`. */
	key: string | string[];
	/** Custom R2 metadata (tagged for cache invalidation patterns, etc.). */
	metadata?: Record<string, string>;
	/** `presigned` (default) returns a `url`; `private` returns `url: null`. */
	readPolicy?: ReadPolicy;
	/** Presigned URL TTL in seconds. Default 3600. Hard cap 86400. */
	presignTtl?: number;
	/** Override `Content-Disposition` header on the stored object. */
	contentDisposition?: string;
}

export interface StorePdfResult {
	r2Key: string;
	bytes: number;
	url: string | null;
}

/**
 * Render to PDF and upload to R2 in one call. Returns the (sanitized) key,
 * the byte size, and a presigned URL (unless `readPolicy: "private"`).
 *
 * SECURITY: presigned URLs are bearer tokens. The TTL is capped at 24h to
 * limit blast radius if a link leaks; for highly sensitive content prefer
 * `readPolicy: "private"` and fetch via an authenticated proxy.
 */
export async function storedPDF(
	session: BrowserSessionLike,
	html: string,
	options: StorePdfOptions,
): Promise<StorePdfResult> {
	const r2Key = Array.isArray(options.key) ? safeKey(...options.key) : safeKey(options.key);

	const ttl = options.presignTtl ?? DEFAULT_PRESIGN_TTL_S;
	if (!Number.isFinite(ttl) || ttl <= 0) {
		throw new ValidationError("presignTtl must be a positive number of seconds", [
			{ path: ["presignTtl"], message: "non-positive presign TTL" },
		]);
	}
	if (ttl > MAX_PRESIGN_TTL_S) {
		throw new ValidationError(
			`presignTtl exceeds 24h cap (${MAX_PRESIGN_TTL_S}s). Use readPolicy:'private' for longer-lived access.`,
			[{ path: ["presignTtl"], message: `requested ${ttl}s, max ${MAX_PRESIGN_TTL_S}s` }],
		);
	}

	const bytes = await renderPDF(session, html, options);

	await options.bucket.put(r2Key, bytes, {
		httpMetadata: {
			contentType: "application/pdf",
			contentDisposition: options.contentDisposition,
		},
		customMetadata: options.metadata,
	});

	const policy: ReadPolicy = options.readPolicy ?? "presigned";
	if (policy === "private") {
		return { r2Key, bytes: bytes.byteLength, url: null };
	}

	if (typeof options.bucket.createPresignedUrl !== "function") {
		throw new ConfigError(
			"R2 bucket binding does not support createPresignedUrl. Use readPolicy:'private' or upgrade your binding.",
		);
	}

	const url = await options.bucket.createPresignedUrl(r2Key, { expiresIn: ttl, method: "GET" });
	return { r2Key, bytes: bytes.byteLength, url };
}
