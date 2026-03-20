# @workkit/auth

> JWT, session management, and auth middleware for Cloudflare Workers

[![npm](https://img.shields.io/npm/v/@workkit/auth)](https://www.npmjs.com/package/@workkit/auth)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/auth)](https://bundlephobia.com/package/@workkit/auth)

## Install

```bash
bun add @workkit/auth
```

## Usage

### Before (manual JWT and auth)

```ts
// 50+ lines of WebCrypto boilerplate for JWT
const encoder = new TextEncoder()
const keyData = encoder.encode(secret)
const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
// ... base64url encode header, payload, sign, concatenate ...

// Manual bearer extraction
const auth = request.headers.get("Authorization")
if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 })
const token = auth.slice(7)
// ... verify, check expiry, parse claims ...
```

### After (workkit auth)

```ts
import {
  signJWT,
  verifyJWT,
  createAuthHandler,
  createSessionManager,
  extractBearerToken,
  hashPassword,
  verifyPassword,
} from "@workkit/auth"

// Sign and verify JWTs
const token = await signJWT({ sub: userId, role: "admin" }, env.JWT_SECRET, {
  expiresIn: "7d",
  algorithm: "HS256",
})
const claims = await verifyJWT(token, env.JWT_SECRET) // typed claims

// Auth middleware — wrap any handler
const auth = createAuthHandler({
  verify: async (request, env) => {
    const token = extractBearerToken(request)
    if (!token) return null
    return await verifyJWT(token, env.JWT_SECRET)
  },
})

// Protected route — returns 401 if not authenticated
const handler = auth.required(async (request, env, ctx, claims) => {
  return new Response(`Hello ${claims.sub}`)
})

// Role-based — returns 403 if wrong role
const adminHandler = auth.requireRole("admin", async (request, env, ctx, claims) => {
  return new Response("Admin panel")
})

// Session management with KV
const sessions = createSessionManager({
  kv: env.SESSIONS_KV,
  ttl: 86400,
  cookie: { name: "sid", secure: true, sameSite: "Lax" },
})
const { sessionId, headers } = await sessions.create({ userId: "123" })
const session = await sessions.get(request) // reads from cookie

// Password hashing (PBKDF2)
const hashed = await hashPassword("my-password")
const valid = await verifyPassword("my-password", hashed)
```

## API

### JWT

- **`signJWT(claims, secret, options?)`** — Sign a JWT. Options: `expiresIn`, `algorithm` (`HS256`/`HS384`/`HS512`)
- **`verifyJWT(token, secret, options?)`** — Verify and decode a JWT
- **`decodeJWT(token)`** — Decode without verification (for inspection)

### Auth Handler

- **`createAuthHandler(config)`** — Framework-agnostic auth middleware
  - `.required(handler)` — 401 if not authenticated
  - `.optional(handler)` — Auth context may be null
  - `.requireRole(role, handler)` — 403 if wrong role

### Sessions

- **`createSessionManager(config)`** — KV-backed session management
  - `.create(data)` — Create session, returns `{ sessionId, headers }`
  - `.get(request)` — Get session from cookie
  - `.destroy(request)` — Delete session

### Utilities

- **`extractBearerToken(request)`** — Extract token from `Authorization: Bearer ...`
- **`extractBasicAuth(request)`** — Extract `{ username, password }` from Basic auth
- **`hashPassword(password)`** — PBKDF2 password hash
- **`verifyPassword(password, hash)`** — Verify password against hash

## License

MIT
