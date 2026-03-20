interface StoredObject {
  body: ArrayBuffer
  customMetadata: Record<string, string>
  httpMetadata: Record<string, string>
  uploaded: Date
  size: number
  key: string
  etag: string
  version: string
}

function toArrayBuffer(value: string | ArrayBuffer | ReadableStream | Blob | null): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer as ArrayBuffer
  if (value instanceof Uint8Array) return value.buffer as ArrayBuffer
  return new ArrayBuffer(0)
}

function makeR2Object(stored: StoredObject): any {
  return {
    key: stored.key,
    size: stored.size,
    etag: stored.etag,
    version: stored.version,
    uploaded: stored.uploaded,
    httpMetadata: { ...stored.httpMetadata },
    customMetadata: { ...stored.customMetadata },
    checksums: {},
    storageClass: 'Standard' as const,
    writeHttpMetadata(_headers: Headers) {},
  }
}

function makeR2ObjectBody(stored: StoredObject): any {
  const obj = makeR2Object(stored)
  const bodyBuf = stored.body.slice(0)
  let bodyUsed = false

  return {
    ...obj,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bodyBuf))
        controller.close()
      },
    }),
    bodyUsed,
    async arrayBuffer() {
      bodyUsed = true
      return bodyBuf.slice(0)
    },
    async text() {
      bodyUsed = true
      return new TextDecoder().decode(bodyBuf)
    },
    async json() {
      bodyUsed = true
      return JSON.parse(new TextDecoder().decode(bodyBuf))
    },
    async blob() {
      bodyUsed = true
      return new Blob([bodyBuf])
    },
  }
}

/**
 * In-memory R2Bucket mock for unit testing.
 */
export function createMockR2(): R2Bucket & { _store: Map<string, StoredObject> } {
  const store = new Map<string, StoredObject>()
  let nextId = 1

  const bucket = {
    _store: store,

    async get(key: string, _options?: any): Promise<any> {
      const stored = store.get(key)
      if (!stored) return null
      return makeR2ObjectBody(stored)
    },

    async put(key: string, value: any, options?: any): Promise<any> {
      const body = toArrayBuffer(value)
      const stored: StoredObject = {
        body,
        key,
        size: body.byteLength,
        etag: `etag-${nextId++}`,
        version: `v${nextId}`,
        uploaded: new Date(),
        customMetadata: options?.customMetadata ? { ...options.customMetadata } : {},
        httpMetadata: options?.httpMetadata ? { ...options.httpMetadata } : {},
      }
      store.set(key, stored)
      return makeR2Object(stored)
    },

    async delete(keys: string | string[]): Promise<void> {
      const keyList = Array.isArray(keys) ? keys : [keys]
      for (const key of keyList) {
        store.delete(key)
      }
    },

    async head(key: string): Promise<any> {
      const stored = store.get(key)
      if (!stored) return null
      return makeR2Object(stored)
    },

    async list(options?: any): Promise<any> {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const delimiter = options?.delimiter
      const cursor = options?.cursor

      let entries = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))

      const delimitedPrefixes: string[] = []

      if (delimiter) {
        const directObjects: typeof entries = []
        const seenPrefixes = new Set<string>()

        for (const [key, val] of entries) {
          const rest = key.slice(prefix.length)
          const delimIdx = rest.indexOf(delimiter)
          if (delimIdx >= 0) {
            const commonPrefix = prefix + rest.slice(0, delimIdx + delimiter.length)
            if (!seenPrefixes.has(commonPrefix)) {
              seenPrefixes.add(commonPrefix)
              delimitedPrefixes.push(commonPrefix)
            }
          } else {
            directObjects.push([key, val])
          }
        }
        entries = directObjects
      }

      const startIndex = cursor ? parseInt(cursor, 10) : 0
      const page = entries.slice(startIndex, startIndex + limit)
      const endIndex = startIndex + page.length
      const truncated = endIndex < entries.length

      return {
        objects: page.map(([_key, stored]) => makeR2Object(stored)),
        truncated,
        cursor: truncated ? String(endIndex) : undefined,
        delimitedPrefixes,
      }
    },

    async createMultipartUpload(key: string, _options?: any): Promise<any> {
      const uploadId = `upload-${nextId++}`
      return {
        key,
        uploadId,
        async uploadPart(_partNumber: number, _value: any) {
          return { partNumber: _partNumber, etag: `part-etag-${nextId++}` }
        },
        async complete(_parts: any[]) {
          return makeR2Object({
            key,
            body: new ArrayBuffer(0),
            size: 0,
            etag: `etag-${nextId++}`,
            version: `v${nextId}`,
            uploaded: new Date(),
            customMetadata: {},
            httpMetadata: {},
          })
        },
        async abort() {},
      }
    },

    resumeMultipartUpload(key: string, uploadId: string): any {
      return {
        key,
        uploadId,
        async uploadPart(_partNumber: number, _value: any) {
          return { partNumber: _partNumber, etag: `part-etag-${nextId++}` }
        },
        async complete(_parts: any[]) {
          return makeR2Object({
            key,
            body: new ArrayBuffer(0),
            size: 0,
            etag: `etag-${nextId++}`,
            version: `v${nextId}`,
            uploaded: new Date(),
            customMetadata: {},
            httpMetadata: {},
          })
        },
        async abort() {},
      }
    },
  }

  return bucket as any
}
