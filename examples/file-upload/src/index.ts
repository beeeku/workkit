import { extractBearerToken, signJWT, verifyJWT } from "@workkit/auth";
import { r2 as r2Validator } from "@workkit/env/validators";
import { NotFoundError, UnauthorizedError, ValidationError } from "@workkit/errors";
import { getEnv, workkit, workkitErrorHandler } from "@workkit/hono";
import { createPresignedUrl, r2, streamToBuffer } from "@workkit/r2";
/**
 * File Upload — R2 file upload/download with presigned URLs and auth
 *
 * Demonstrates building a file management API with:
 *   - @workkit/r2 for typed R2 operations
 *   - @workkit/auth for JWT-protected endpoints
 *   - Presigned URLs for direct client-to-R2 uploads
 *   - Streaming downloads with proper Content-Type headers
 */
import { Hono } from "hono";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileMetadata {
	userId: string;
	originalName: string;
	mimeType: string;
	uploadedAt: string;
}

interface JWTPayload {
	sub: string;
	email: string;
}

// ─── Environment Schema ───────────────────────────────────────────────────────

const envSchema = {
	FILES_BUCKET: r2Validator(),
	JWT_SECRET: z.string().min(32),
	MAX_FILE_SIZE: z.coerce.number().default(10 * 1024 * 1024), // 10 MB
};

// ─── App Setup ────────────────────────────────────────────────────────────────

type Env = { Bindings: Record<string, unknown> };
const app = new Hono<Env>();

app.use("*", workkit({ env: envSchema }));
app.onError(workkitErrorHandler());

// ─── Auth Helper ──────────────────────────────────────────────────────────────

async function requireAuth(c: any): Promise<JWTPayload> {
	const token = extractBearerToken(c.req.raw);
	if (!token) throw new UnauthorizedError("Missing Authorization header");
	const env = getEnv(c);
	return verifyJWT<JWTPayload>(token, { secret: env.JWT_SECRET });
}

// ─── Upload File (Direct) ─────────────────────────────────────────────────────
//
// Accepts a file via multipart form data and stores it in R2.
//
// BEFORE (raw R2 API):
//   const formData = await request.formData()
//   const file = formData.get('file')
//   await env.FILES_BUCKET.put(`uploads/${userId}/${filename}`, file.stream(), {
//     httpMetadata: { contentType: file.type },
//     customMetadata: { userId, originalName: file.name },
//   })
//   // No validation, no typed metadata, no error wrapping
//
// AFTER (workkit):
//   - Typed R2 client with `FileMetadata` generic
//   - Automatic error wrapping (R2 errors → WorkkitErrors)
//   - Structured customMetadata

app.post("/files", async (c) => {
	const auth = await requireAuth(c);
	const env = getEnv(c);
	const bucket = r2<FileMetadata>(env.FILES_BUCKET);

	const formData = await c.req.formData();
	const file = formData.get("file");
	if (!(file instanceof File)) {
		throw new ValidationError('Missing "file" in form data', [
			{ path: ["file"], message: "Expected a file upload" },
		]);
	}

	// Validate file size
	if (file.size > env.MAX_FILE_SIZE) {
		throw new ValidationError(`File too large: ${file.size} bytes (max ${env.MAX_FILE_SIZE})`, [
			{ path: ["file"], message: `Max size is ${env.MAX_FILE_SIZE} bytes` },
		]);
	}

	const key = `uploads/${auth.sub}/${Date.now()}-${file.name}`;

	const obj = await bucket.put(key, file.stream(), {
		httpMetadata: { contentType: file.type },
		customMetadata: {
			userId: auth.sub,
			originalName: file.name,
			mimeType: file.type,
			uploadedAt: new Date().toISOString(),
		},
	});

	return c.json(
		{
			key,
			size: obj.size,
			etag: obj.etag,
			uploaded: obj.uploaded.toISOString(),
		},
		201,
	);
});

// ─── Get Presigned Upload URL ─────────────────────────────────────────────────
//
// Returns a presigned URL that the client can use to upload directly to R2.
// Useful for large files — the upload goes directly to R2, not through the Worker.

const presignedUploadSchema = z.object({
	filename: z.string().min(1).max(255),
	contentType: z.string().default("application/octet-stream"),
	maxSize: z.number().positive().optional(),
});

app.post("/files/presigned-upload", async (c) => {
	const auth = await requireAuth(c);
	const env = getEnv(c);
	const body = presignedUploadSchema.parse(await c.req.json());

	const key = `uploads/${auth.sub}/${Date.now()}-${body.filename}`;

	const url = await createPresignedUrl(env.FILES_BUCKET, {
		key,
		method: "PUT",
		expiresIn: 3600, // 1 hour
		maxSize: body.maxSize ?? env.MAX_FILE_SIZE,
	});

	return c.json({ uploadUrl: url, key, expiresIn: 3600 });
});

// ─── Get Presigned Download URL ───────────────────────────────────────────────

app.get("/files/:key{.+}/presigned", async (c) => {
	const auth = await requireAuth(c);
	const env = getEnv(c);
	const key = c.req.param("key");

	// Verify the file exists and belongs to the user
	const bucket = r2<FileMetadata>(env.FILES_BUCKET);
	const head = await bucket.head(key);
	if (!head) {
		throw new NotFoundError(`File not found: ${key}`);
	}

	if (head.customMetadata?.userId !== auth.sub) {
		throw new UnauthorizedError("You do not own this file");
	}

	const url = await createPresignedUrl(env.FILES_BUCKET, {
		key,
		method: "GET",
		expiresIn: 3600,
	});

	return c.json({ downloadUrl: url, expiresIn: 3600 });
});

// ─── Download File ────────────────────────────────────────────────────────────
//
// Streams the file directly from R2 to the client with proper headers.

app.get("/files/:key{.+}", async (c) => {
	const auth = await requireAuth(c);
	const env = getEnv(c);
	const key = c.req.param("key");

	const bucket = r2<FileMetadata>(env.FILES_BUCKET);
	const obj = await bucket.get(key);

	if (!obj) {
		throw new NotFoundError(`File not found: ${key}`);
	}

	// Verify ownership
	if (obj.customMetadata?.userId !== auth.sub) {
		throw new UnauthorizedError("You do not own this file");
	}

	const headers = new Headers();
	headers.set("Content-Type", obj.httpMetadata?.contentType ?? "application/octet-stream");
	headers.set("Content-Length", String(obj.size));
	headers.set("ETag", obj.etag);

	if (obj.customMetadata?.originalName) {
		headers.set("Content-Disposition", `attachment; filename="${obj.customMetadata.originalName}"`);
	}

	return new Response(obj.body, { headers });
});

// ─── List Files ───────────────────────────────────────────────────────────────
//
// Lists all files for the authenticated user with pagination.

app.get("/files", async (c) => {
	const auth = await requireAuth(c);
	const env = getEnv(c);
	const bucket = r2<FileMetadata>(env.FILES_BUCKET);

	const cursor = c.req.query("cursor");
	const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 100);

	// List with prefix scoping to user's directory
	const page = await bucket.listPage({
		prefix: `uploads/${auth.sub}/`,
		limit,
		cursor: cursor ?? undefined,
	});

	const files = page.objects.map((obj) => ({
		key: obj.key,
		size: obj.size,
		uploaded: obj.uploaded.toISOString(),
		contentType: obj.httpMetadata?.contentType,
		originalName: obj.customMetadata?.originalName,
	}));

	return c.json({
		files,
		cursor: page.cursor,
		hasMore: page.truncated,
	});
});

// ─── Delete File ──────────────────────────────────────────────────────────────

app.delete("/files/:key{.+}", async (c) => {
	const auth = await requireAuth(c);
	const env = getEnv(c);
	const key = c.req.param("key");

	const bucket = r2<FileMetadata>(env.FILES_BUCKET);

	// Verify ownership before deleting
	const head = await bucket.head(key);
	if (!head) {
		throw new NotFoundError(`File not found: ${key}`);
	}

	if (head.customMetadata?.userId !== auth.sub) {
		throw new UnauthorizedError("You do not own this file");
	}

	await bucket.delete(key);
	return c.json({ message: "File deleted", key });
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// ─── Export ───────────────────────────────────────────────────────────────────

export default app;
