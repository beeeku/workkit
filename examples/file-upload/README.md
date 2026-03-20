# File Upload

R2 file upload/download with presigned URLs, streaming, and JWT authentication.

## What it demonstrates

- **Typed R2 client** — `r2<FileMetadata>(env.FILES_BUCKET)` gives you a client where `customMetadata` is typed as `FileMetadata`. No more `Record<string, string>` guessing.
- **Presigned URLs** — `createPresignedUrl()` generates signed URLs for direct client-to-R2 uploads, bypassing the Worker for large files. Supports max file size enforcement.
- **Streaming downloads** — Files stream directly from R2 to the client with correct `Content-Type`, `Content-Disposition`, and `ETag` headers.
- **Ownership enforcement** — Files are scoped to `uploads/{userId}/` and ownership is verified on every operation using JWT claims.
- **Paginated listing** — `bucket.listPage()` returns a cursor-based page with typed objects.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/r2` | Typed R2 client, presigned URLs, streaming |
| `@workkit/auth` | JWT verification and token extraction |
| `@workkit/env` | Environment binding validation |
| `@workkit/errors` | Structured error responses |
| `@workkit/hono` | Hono framework integration |

## Running locally

```bash
# Install dependencies
bun install

# Start local dev server (uses local R2 simulator)
bun run dev
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/files` | Yes | Upload a file via multipart form data |
| POST | `/files/presigned-upload` | Yes | Get a presigned URL for direct upload |
| GET | `/files/:key/presigned` | Yes | Get a presigned URL for download |
| GET | `/files/:key` | Yes | Download a file (streaming) |
| GET | `/files` | Yes | List files with cursor pagination |
| DELETE | `/files/:key` | Yes | Delete a file |
| GET | `/health` | No | Health check |

## Example usage

```bash
# Upload a file
curl -X POST http://localhost:8787/files \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./photo.jpg"

# Get a presigned upload URL (for large files)
curl -X POST http://localhost:8787/files/presigned-upload \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filename": "video.mp4", "contentType": "video/mp4"}'

# List files
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/files

# Download a file
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/files/uploads/user1/photo.jpg -o photo.jpg
```
