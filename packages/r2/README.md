# @workkit/r2

> Typed R2 client with streaming helpers, multipart uploads, and presigned URLs

[![npm](https://img.shields.io/npm/v/@workkit/r2)](https://www.npmjs.com/package/@workkit/r2)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/r2)](https://bundlephobia.com/package/@workkit/r2)

## Install

```bash
bun add @workkit/r2
```

## Usage

### Before (raw R2 API)

```ts
// No typed metadata, manual error handling, verbose multipart
await env.BUCKET.put("avatars/123.png", imageData, {
  httpMetadata: { contentType: "image/png" },
  customMetadata: { userId: "123" },
})

const obj = await env.BUCKET.get("avatars/123.png")
if (!obj) throw new Error("not found")
const data = await obj.arrayBuffer()
const userId = obj.customMetadata?.userId // string | undefined — untyped
```

### After (workkit r2)

```ts
import { r2, streamToBuffer, streamToJson, multipartUpload } from "@workkit/r2"

type AvatarMeta = { userId: string; uploadedAt: string }

const bucket = r2<AvatarMeta>(env.MY_BUCKET)

// Typed metadata on put and get
await bucket.put("avatars/123.png", imageData, {
  httpMetadata: { contentType: "image/png" },
  customMetadata: { userId: "123", uploadedAt: new Date().toISOString() },
})

const obj = await bucket.get("avatars/123.png")
obj?.customMetadata.userId // string — typed!

// Streaming helpers
const buffer = await streamToBuffer(obj!.body)
const json = await streamToJson<Config>(configObj!.body)

// Multipart upload for large files
const upload = await multipartUpload(env.MY_BUCKET, "large-file.zip", {
  partSize: 10 * 1024 * 1024, // 10MB parts
})
for (const chunk of chunks) {
  await upload.uploadPart(chunk)
}
await upload.complete()
```

## API

### `r2<Metadata>(binding, options?)`

Create a typed R2 client.

**Methods:**
- **`get(key, opts?)`** — Get object with typed metadata
- **`put(key, value, opts?)`** — Store with typed metadata
- **`delete(key)`** — Delete an object
- **`head(key)`** — Get metadata without body
- **`list(opts?)`** — List objects with auto-pagination

### Streaming

- **`streamToBuffer(stream)`** — ReadableStream to ArrayBuffer
- **`streamToText(stream)`** — ReadableStream to string
- **`streamToJson<T>(stream)`** — ReadableStream to parsed JSON

### Multipart Upload

- **`multipartUpload(bucket, key, options)`** — Chunked upload for large files

### Presigned URLs

- **`createPresignedUrl(options)`** — Generate time-limited access URLs

### Migration

- **`fromS3Key(key)`** / **`toS3Key(key)`** — S3-compatible key conversion

## License

MIT
