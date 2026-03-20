interface MockKVEntry {
  value: string
  expiration?: number
  metadata?: unknown
}

/**
 * In-memory KVNamespace mock for unit testing.
 * Implements the subset of KVNamespace that @workkit/kv uses.
 */
export function createMockKV(): KVNamespace & { _store: Map<string, MockKVEntry> } {
  const store = new Map<string, MockKVEntry>()

  return {
    _store: store,

    async get(key: string, options?: any): Promise<any> {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiration && entry.expiration < Date.now() / 1000) {
        store.delete(key)
        return null
      }
      const type = typeof options === 'string' ? options : options?.type ?? 'text'
      if (type === 'json') return JSON.parse(entry.value)
      return entry.value
    },

    async getWithMetadata(key: string, options?: any): Promise<any> {
      const entry = store.get(key)
      if (!entry) return { value: null, metadata: null, cacheStatus: null }
      if (entry.expiration && entry.expiration < Date.now() / 1000) {
        store.delete(key)
        return { value: null, metadata: null, cacheStatus: null }
      }
      const type = typeof options === 'string' ? options : options?.type ?? 'text'
      const value = type === 'json' ? JSON.parse(entry.value) : entry.value
      return { value, metadata: entry.metadata ?? null, cacheStatus: null }
    },

    async put(key: string, value: any, options?: any): Promise<void> {
      const entry: MockKVEntry = {
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }
      if (options?.expiration) entry.expiration = options.expiration
      if (options?.expirationTtl)
        entry.expiration = Math.floor(Date.now() / 1000) + options.expirationTtl
      if (options?.metadata) entry.metadata = options.metadata
      store.set(key, entry)
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async list(options?: any): Promise<any> {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const entries = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))

      const startIndex = options?.cursor ? parseInt(options.cursor, 10) : 0
      const page = entries.slice(startIndex, startIndex + limit)
      const endIndex = startIndex + page.length
      const listComplete = endIndex >= entries.length

      return {
        keys: page.map(([name, entry]) => ({
          name,
          expiration: entry.expiration,
          metadata: entry.metadata,
        })),
        list_complete: listComplete,
        cursor: listComplete ? undefined : String(endIndex),
        cacheStatus: null,
      }
    },
  } as any
}
