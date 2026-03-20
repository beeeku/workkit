interface MockR2Entry {
  key: string
  body: ArrayBuffer
  httpMetadata?: Record<string, any>
  customMetadata?: Record<string, string>
  version: string
  size: number
  etag: string
  httpEtag: string
  uploaded: Date
}

interface MockMultipartUpload {
  uploadId: string
  key: string
  parts: Map<number, { data: ArrayBuffer; etag: string }>
  httpMetadata?: Record<string, any>
  customMetadata?: Record<string, string>
  aborted: boolean
}

/**
 * In-memory R2Bucket mock for unit testing.
 * Implements the subset of R2Bucket that @workkit/r2 uses.
 */
export function createMockR2(): R2Bucket & {
  _store: Map<string, MockR2Entry>
  _uploads: Map<string, MockMultipartUpload>
} {
  const store = new Map<string, MockR2Entry>()
  const uploads = new Map<string, MockMultipartUpload>()
  let versionCounter = 0
  let uploadIdCounter = 0

  function textToBuffer(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer
  }

  function bufferToText(buffer: ArrayBuffer): string {
    return new TextDecoder().decode(buffer)
  }

  function generateEtag(): string {
    return `etag-${++versionCounter}`
  }

  function makeR2Object(entry: MockR2Entry) {
    return {
      key: entry.key,
      version: entry.version,
      size: entry.size,
      etag: entry.etag,
      httpEtag: entry.httpEtag,
      uploaded: entry.uploaded,
      httpMetadata: entry.httpMetadata ?? {},
      customMetadata: entry.customMetadata ?? {},
      checksums: {},
    }
  }

  function makeR2ObjectBody(entry: MockR2Entry) {
    const bodyBuffer = entry.body.slice(0) // Clone
    let bodyUsed = false

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bodyBuffer))
        controller.close()
      },
    })

    return {
      ...makeR2Object(entry),
      body: stream,
      get bodyUsed() { return bodyUsed },
      async arrayBuffer() {
        bodyUsed = true
        return bodyBuffer.slice(0)
      },
      async text() {
        bodyUsed = true
        return bufferToText(bodyBuffer)
      },
      async json() {
        bodyUsed = true
        return JSON.parse(bufferToText(bodyBuffer))
      },
      async blob() {
        bodyUsed = true
        return new Blob([bodyBuffer])
      },
    }
  }

  async function valueToBuffer(
    value: ReadableStream | ArrayBuffer | string | Blob | null,
  ): Promise<ArrayBuffer> {
    if (value === null) return new ArrayBuffer(0)
    if (typeof value === 'string') return textToBuffer(value)
    if (value instanceof ArrayBuffer) return value
    if (value instanceof Blob) return await value.arrayBuffer()
    // ReadableStream
    const reader = (value as ReadableStream).getReader()
    const chunks: Uint8Array[] = []
    let totalLen = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      chunks.push(u8)
      totalLen += u8.byteLength
    }
    const result = new Uint8Array(totalLen)
    let offset = 0
    for (const c of chunks) {
      result.set(c, offset)
      offset += c.byteLength
    }
    return result.buffer
  }

  return {
    _store: store,
    _uploads: uploads,

    async get(key: string, options?: any): Promise<any> {
      const entry = store.get(key)
      if (!entry) return null

      if (options?.onlyIf) {
        const cond = options.onlyIf
        if (cond.etagMatches && entry.etag !== cond.etagMatches) return null
        if (cond.etagDoesNotMatch && entry.etag === cond.etagDoesNotMatch) return null
        if (cond.uploadedBefore && entry.uploaded >= cond.uploadedBefore) return null
        if (cond.uploadedAfter && entry.uploaded <= cond.uploadedAfter) return null
      }

      let bodyBuffer = entry.body.slice(0)

      if (options?.range) {
        const range = options.range
        if (range.suffix !== undefined) {
          const start = Math.max(0, bodyBuffer.byteLength - range.suffix)
          bodyBuffer = bodyBuffer.slice(start)
        } else {
          const offset = range.offset ?? 0
          const length = range.length ?? (bodyBuffer.byteLength - offset)
          bodyBuffer = bodyBuffer.slice(offset, offset + length)
        }
        // Return with sliced body
        const slicedEntry = { ...entry, body: bodyBuffer, size: bodyBuffer.byteLength }
        return makeR2ObjectBody(slicedEntry)
      }

      return makeR2ObjectBody(entry)
    },

    async head(key: string): Promise<any> {
      const entry = store.get(key)
      if (!entry) return null
      return makeR2Object(entry)
    },

    async put(key: string, value: any, options?: any): Promise<any> {
      const buffer = await valueToBuffer(value)
      const etag = generateEtag()
      const entry: MockR2Entry = {
        key,
        body: buffer,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
        version: `v${versionCounter}`,
        size: buffer.byteLength,
        etag,
        httpEtag: `"${etag}"`,
        uploaded: new Date(),
      }
      store.set(key, entry)
      return makeR2Object(entry)
    },

    async delete(keys: string | string[]): Promise<void> {
      const keyArray = Array.isArray(keys) ? keys : [keys]
      for (const k of keyArray) {
        store.delete(k)
      }
    },

    async list(options?: any): Promise<any> {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const delimiter = options?.delimiter
      const startAfter = options?.startAfter

      let entries = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))

      if (startAfter) {
        entries = entries.filter(([k]) => k > startAfter)
      }

      // Handle delimiter for hierarchical listing
      const delimitedPrefixes: string[] = []
      if (delimiter) {
        const seenPrefixes = new Set<string>()
        entries = entries.filter(([k]) => {
          const rest = k.slice(prefix.length)
          const delimIdx = rest.indexOf(delimiter)
          if (delimIdx !== -1) {
            const dp = prefix + rest.slice(0, delimIdx + 1)
            if (!seenPrefixes.has(dp)) {
              seenPrefixes.add(dp)
              delimitedPrefixes.push(dp)
            }
            return false
          }
          return true
        })
      }

      // Apply cursor (simple index-based)
      const startIndex = options?.cursor ? parseInt(options.cursor, 10) : 0
      const page = entries.slice(startIndex, startIndex + limit)
      const endIndex = startIndex + page.length
      const truncated = endIndex < entries.length

      return {
        objects: page.map(([, entry]) => makeR2Object(entry)),
        truncated,
        cursor: truncated ? String(endIndex) : undefined,
        delimitedPrefixes,
      }
    },

    async createMultipartUpload(key: string, options?: any): Promise<any> {
      const uploadId = `upload-${++uploadIdCounter}`
      const upload: MockMultipartUpload = {
        uploadId,
        key,
        parts: new Map(),
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
        aborted: false,
      }
      uploads.set(uploadId, upload)

      return {
        uploadId,
        key,
        async uploadPart(partNumber: number, data: any): Promise<any> {
          if (upload.aborted) throw new Error('Upload has been aborted')
          const buffer = await valueToBuffer(data)
          const etag = generateEtag()
          upload.parts.set(partNumber, { data: buffer, etag })
          return { partNumber, etag }
        },
        async complete(parts: { partNumber: number; etag: string }[]): Promise<any> {
          if (upload.aborted) throw new Error('Upload has been aborted')
          // Assemble all parts
          const allBuffers: ArrayBuffer[] = []
          let totalSize = 0
          for (const part of parts) {
            const stored = upload.parts.get(part.partNumber)
            if (!stored) throw new Error(`Part ${part.partNumber} not found`)
            if (stored.etag !== part.etag) throw new Error(`Part ${part.partNumber} etag mismatch`)
            allBuffers.push(stored.data)
            totalSize += stored.data.byteLength
          }
          const assembled = new Uint8Array(totalSize)
          let offset = 0
          for (const buf of allBuffers) {
            assembled.set(new Uint8Array(buf), offset)
            offset += buf.byteLength
          }

          const etag = generateEtag()
          const entry: MockR2Entry = {
            key,
            body: assembled.buffer,
            httpMetadata: upload.httpMetadata,
            customMetadata: upload.customMetadata,
            version: `v${versionCounter}`,
            size: totalSize,
            etag,
            httpEtag: `"${etag}"`,
            uploaded: new Date(),
          }
          store.set(key, entry)
          uploads.delete(uploadId)
          return makeR2Object(entry)
        },
        async abort(): Promise<void> {
          upload.aborted = true
          uploads.delete(uploadId)
        },
      }
    },
  } as any
}

/**
 * Helper: create a ReadableStream from a string.
 */
export function stringToStream(text: string): ReadableStream {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

/**
 * Helper: create a ReadableStream from an ArrayBuffer.
 */
export function bufferToStream(buffer: ArrayBuffer): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer))
      controller.close()
    },
  })
}
