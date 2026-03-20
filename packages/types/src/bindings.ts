// All types here REFERENCE @cloudflare/workers-types — they don't redefine the bindings.
// They ADD type parameters that the raw types lack.

// --- Typed KV ---

/** A KV namespace with typed values. Wraps KVNamespace from @cloudflare/workers-types. */
export interface TypedKVNamespace<T> {
	/** The underlying untyped KV binding */
	readonly raw: KVNamespace

	get(key: string): Promise<T | null>
	getWithMetadata<M = unknown>(key: string): Promise<{ value: T | null; metadata: M | null }>
	put(key: string, value: T, options?: KVNamespacePutOptions): Promise<void>
	delete(key: string): Promise<void>
	list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult<T>>
}

// --- Typed D1 ---

/** Type-safe D1 query result */
export interface TypedD1Result<T> {
	results: T[]
	success: boolean
	meta: D1Meta
	error?: string
}

/** D1 meta information */
export interface D1Meta {
	changed_db: boolean
	changes: number
	duration: number
	last_row_id: number
	rows_read: number
	rows_written: number
	size_after: number
}

// --- Typed R2 ---

/** R2 object with typed custom metadata */
export interface TypedR2Object<M extends Record<string, string> = Record<string, string>> {
	key: string
	version: string
	size: number
	etag: string
	httpEtag: string
	uploaded: Date
	httpMetadata?: R2HTTPMetadata
	customMetadata: M
	checksums: R2Checksums
}

/** R2 get result — body + metadata */
export interface TypedR2ObjectBody<M extends Record<string, string> = Record<string, string>>
	extends TypedR2Object<M> {
	body: ReadableStream
	bodyUsed: boolean
	arrayBuffer(): Promise<ArrayBuffer>
	text(): Promise<string>
	json<T>(): Promise<T>
	blob(): Promise<Blob>
}

// --- R2 supporting types ---

export interface R2HTTPMetadata {
	contentType?: string
	contentLanguage?: string
	contentDisposition?: string
	contentEncoding?: string
	cacheControl?: string
	cacheExpiry?: Date
}

export interface R2Checksums {
	md5?: ArrayBuffer
	sha1?: ArrayBuffer
	sha256?: ArrayBuffer
	sha384?: ArrayBuffer
	sha512?: ArrayBuffer
}

// --- Typed Queue ---

/** A typed queue producer */
export interface TypedQueue<Body> {
	send(body: Body, options?: QueueSendOptions): Promise<void>
	sendBatch(
		messages: Iterable<TypedMessageSendRequest<Body>>,
		options?: QueueSendBatchOptions,
	): Promise<void>
}

/** A typed message for sendBatch */
export interface TypedMessageSendRequest<Body> {
	body: Body
	contentType?: QueueContentType
	delaySeconds?: number
}

/** A typed message received from a queue */
export interface TypedMessage<Body> {
	readonly id: string
	readonly timestamp: Date
	readonly body: Body
	readonly attempts: number
	ack(): void
	retry(options?: QueueRetryOptions): void
}

/** A typed message batch */
export interface TypedMessageBatch<Body> {
	readonly queue: string
	readonly messages: readonly TypedMessage<Body>[]
	ackAll(): void
	retryAll(options?: QueueRetryOptions): void
}

// --- Queue supporting types ---

export interface QueueSendOptions {
	contentType?: QueueContentType
	delaySeconds?: number
}

export interface QueueSendBatchOptions {
	delaySeconds?: number
}

export interface QueueRetryOptions {
	delaySeconds?: number
}

export type QueueContentType = 'text' | 'bytes' | 'json' | 'v8'

// --- Typed DO Storage ---

/** Typed Durable Object storage interface */
export interface TypedDurableObjectStorage {
	get<T>(key: string): Promise<T | undefined>
	get<T>(keys: string[]): Promise<Map<string, T>>
	put<T>(key: string, value: T): Promise<void>
	put<T>(entries: Record<string, T>): Promise<void>
	delete(key: string): Promise<boolean>
	delete(keys: string[]): Promise<number>
	deleteAll(): Promise<void>
	list<T>(options?: DurableObjectStorageListOptions): Promise<Map<string, T>>
	transaction<T>(closure: (txn: TypedDurableObjectStorage) => Promise<T>): Promise<T>
	getAlarm(): Promise<number | null>
	setAlarm(scheduledTime: number | Date): Promise<void>
	deleteAlarm(): Promise<void>
}

export interface DurableObjectStorageListOptions {
	start?: string
	startAfter?: string
	end?: string
	prefix?: string
	reverse?: boolean
	limit?: number
	allowConcurrency?: boolean
	noCache?: boolean
}

// --- KV supporting types needed by TypedKVNamespace ---

export interface KVNamespacePutOptions {
	expiration?: number
	expirationTtl?: number
	metadata?: unknown
}

export interface KVNamespaceListOptions {
	prefix?: string
	limit?: number
	cursor?: string
}

export interface KVNamespaceListResult<T> {
	keys: KVNamespaceListKey<T>[]
	list_complete: boolean
	cursor?: string
	cacheStatus: string | null
}

export interface KVNamespaceListKey<T> {
	name: string
	expiration?: number
	metadata?: T
}
