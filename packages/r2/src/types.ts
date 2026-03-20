import type { R2HTTPMetadata, TypedR2Object, TypedR2ObjectBody } from "@workkit/types";

// Re-export from @workkit/types for convenience
export type { TypedR2Object, TypedR2ObjectBody, R2HTTPMetadata, R2Checksums } from "@workkit/types";

/** Options for creating an R2 client wrapper */
export interface R2ClientOptions {
	/** Default HTTP metadata applied to all put() calls */
	defaultHttpMetadata?: R2HTTPMetadata;
}

/** Options for get() */
export interface R2GetOptions {
	/** Only return the object if it matches the given etag */
	onlyIf?: R2ConditionalOptions;
	/** Range of bytes to read */
	range?: R2Range;
}

/** Options for put() */
export interface R2PutOptions<M extends Record<string, string> = Record<string, string>> {
	/** HTTP metadata (content-type, cache-control, etc.) */
	httpMetadata?: R2HTTPMetadata;
	/** Custom metadata (user-defined key-value pairs) */
	customMetadata?: M;
	/** MD5 hash for integrity verification */
	md5?: ArrayBuffer | string;
	/** SHA-1 hash for integrity verification */
	sha1?: ArrayBuffer | string;
	/** SHA-256 hash for integrity verification */
	sha256?: ArrayBuffer | string;
}

/** Options for list() */
export interface R2ListOptions {
	/** Only list objects with keys starting with this prefix */
	prefix?: string;
	/** Maximum objects per page (default: 1000, max: 1000) */
	limit?: number;
	/** Cursor for pagination */
	cursor?: string;
	/** Delimiter for hierarchical listing */
	delimiter?: string;
	/** Only list keys that come after this key */
	startAfter?: string;
	/** Include custom metadata and HTTP metadata in results */
	include?: R2ListInclude[];
}

/** What to include in list results */
export type R2ListInclude = "httpMetadata" | "customMetadata";

/** Conditional options for get/head */
export interface R2ConditionalOptions {
	etagMatches?: string;
	etagDoesNotMatch?: string;
	uploadedBefore?: Date;
	uploadedAfter?: Date;
}

/** Byte range for partial reads */
export interface R2Range {
	offset?: number;
	length?: number;
	suffix?: number;
}

/** Result of a list page */
export interface R2ListPage<M extends Record<string, string> = Record<string, string>> {
	objects: TypedR2Object<M>[];
	truncated: boolean;
	cursor?: string;
	delimitedPrefixes: string[];
}

/** Presigned URL options */
export interface PresignedUrlOptions {
	/** Object key */
	key: string;
	/** HTTP method: GET for download, PUT for upload */
	method: "GET" | "PUT";
	/** Expiration time in seconds (default: 3600) */
	expiresIn?: number;
	/** Maximum upload size in bytes (PUT only) */
	maxSize?: number;
}

/** Multipart upload options */
export interface MultipartUploadOptions {
	/** Size of each part in bytes (minimum: 5MB for all but last part) */
	partSize?: number;
	/** HTTP metadata for the completed object */
	httpMetadata?: R2HTTPMetadata;
	/** Custom metadata for the completed object */
	customMetadata?: Record<string, string>;
}

/** An active multipart upload session */
export interface MultipartUploadSession {
	/** Upload a part. Parts can be uploaded out of order. */
	uploadPart(
		partNumber: number,
		data: ArrayBuffer | ReadableStream | string | Blob,
	): Promise<R2UploadedPart>;
	/** Complete the multipart upload, assembling all parts */
	complete(): Promise<TypedR2Object>;
	/** Abort the multipart upload and discard uploaded parts */
	abort(): Promise<void>;
	/** The upload ID for this session */
	readonly uploadId: string;
}

/** A completed part in a multipart upload */
export interface R2UploadedPart {
	partNumber: number;
	etag: string;
}

/** The main typed R2 client interface */
export interface WorkkitR2<M extends Record<string, string> = Record<string, string>> {
	/** Get an object with its body and typed metadata */
	get(key: string, options?: R2GetOptions): Promise<TypedR2ObjectBody<M> | null>;
	/** Get only the object's metadata (no body download) */
	head(key: string): Promise<TypedR2Object<M> | null>;
	/** Put an object with typed metadata */
	put(
		key: string,
		value: ReadableStream | ArrayBuffer | string | Blob | null,
		options?: R2PutOptions<M>,
	): Promise<TypedR2Object<M>>;
	/** Delete one or more objects */
	delete(keys: string | string[]): Promise<void>;
	/** List objects with automatic cursor-based pagination */
	list(options?: R2ListOptions): AsyncIterable<TypedR2Object<M>>;
	/** List a single page of objects */
	listPage(options?: R2ListOptions): Promise<R2ListPage<M>>;
	/** The underlying R2Bucket binding */
	readonly raw: R2Bucket;
}

/** R2 error context for error wrapping */
export type R2Operation =
	| "get"
	| "head"
	| "put"
	| "delete"
	| "list"
	| "createMultipartUpload"
	| "uploadPart"
	| "completeMultipartUpload"
	| "abortMultipartUpload";

export interface R2ErrorContext {
	key?: string;
	operation: R2Operation;
	uploadId?: string;
}
