export type SerializerType = 'json' | 'text' | 'arrayBuffer' | 'stream'

export interface KVOptions {
  /** Key prefix — automatically prepended to all keys */
  prefix?: string
  /** Default expiration TTL in seconds for put() calls */
  defaultTtl?: number
  /** Default cacheTtl in seconds for get() calls */
  defaultCacheTtl?: number
  /** Serialization format. Default: 'json' */
  serializer?: SerializerType
}

export interface GetOptions {
  /** Edge cache TTL in seconds. Set to false or 0 to bypass. */
  cacheTtl?: number | false
}

export interface PutOptions {
  /** Expiration TTL in seconds (from now). Minimum: 60. */
  ttl?: number
  /** Absolute expiration timestamp (Unix epoch seconds). Overrides ttl. */
  expiration?: number
  /** Arbitrary metadata (up to 1024 bytes serialized). */
  metadata?: Record<string, unknown>
}

export interface KVGetWithMetadataResult<T, M = unknown> {
  value: T | null
  metadata: M | null
  cacheStatus: string | null
}

export interface KVBatchPutEntry<T> {
  key: string
  value: T
  options?: PutOptions
}

export interface ListOptions {
  /** Additional prefix to filter by (appended to namespace prefix). */
  prefix?: string
  /** Maximum keys per page (CF max: 1000, default: 1000). */
  limit?: number
  /** Cursor for manual pagination. */
  cursor?: string
}

export interface KVListEntry<M = unknown> {
  /** Key name WITHOUT the namespace prefix. */
  name: string
  /** Expiration timestamp, if set. */
  expiration?: number
  /** Metadata attached to this key, if any. */
  metadata?: M
}

export interface KVListPage<M = unknown> {
  entries: KVListEntry<M>[]
  listComplete: boolean
  cursor?: string
}

export interface WorkkitKV<T> {
  get(key: string, options?: GetOptions): Promise<T | null>
  getWithMetadata<M = unknown>(
    key: string,
    options?: GetOptions,
  ): Promise<KVGetWithMetadataResult<T, M>>
  put(key: string, value: T, options?: PutOptions): Promise<void>
  delete(key: string): Promise<void>
  getMany(keys: string[], options?: GetOptions): Promise<Map<string, T>>
  putMany(entries: KVBatchPutEntry<T>[], options?: PutOptions): Promise<void>
  deleteMany(keys: string[]): Promise<void>
  list<M = unknown>(options?: ListOptions): AsyncIterable<KVListEntry<M>>
  listKeys(options?: ListOptions): Promise<KVListEntry[]>
  has(key: string): Promise<boolean>
  readonly raw: KVNamespace
}
