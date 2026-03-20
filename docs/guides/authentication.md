# Authentication

`@workkit/auth` provides JWT signing/verification, KV-backed sessions, password hashing with PBKDF2, header extraction, and a composable auth handler -- all using WebCrypto with zero external dependencies.

## JWT

### Sign a Token

```ts
import { signJWT } from '@workkit/auth'

const token = await signJWT(
  { userId: 'user-123', role: 'admin' },
  {
    secret: env.JWT_SECRET,
    expiresIn: '24h',
    issuer: 'my-api',
    audience: 'my-app',
    algorithm: 'HS256',  // default, also supports HS384, HS512
  },
)
// Returns a standard JWT string: header.payload.signature
```

### Verify a Token

```ts
import { verifyJWT } from '@workkit/auth'

try {
  const payload = await verifyJWT<{ userId: string; role: string }>(token, {
    secret: env.JWT_SECRET,
    issuer: 'my-api',
    audience: 'my-app',
    algorithms: ['HS256'],
    clockTolerance: 30,  // 30 seconds tolerance for clock skew
  })

  console.log(payload.userId)  // 'user-123'
  console.log(payload.role)    // 'admin'
  console.log(payload.exp)     // expiration timestamp
  console.log(payload.iat)     // issued-at timestamp
} catch (error) {
  // UnauthorizedError with details:
  // - "JWT signature verification failed"
  // - "JWT has expired"
  // - "JWT is not yet valid"
  // - "JWT issuer mismatch"
  // - "JWT audience mismatch"
}
```

### Decode without Verification

Useful for inspecting a token before verifying, or when verification is handled externally:

```ts
import { decodeJWT } from '@workkit/auth'

const { header, payload, signature } = decodeJWT<{ userId: string }>(token)
// header: { alg: 'HS256', typ: 'JWT' }
// payload: { userId: 'user-123', iat: ..., exp: ... }
// signature: string
```

### Duration Parsing

The `parseDuration` helper converts human-readable strings to seconds:

```ts
import { parseDuration } from '@workkit/auth'

parseDuration('30s')  // 30
parseDuration('5m')   // 300
parseDuration('1h')   // 3600
parseDuration('7d')   // 604800
parseDuration('2w')   // 1209600
```

## Password Hashing

Uses PBKDF2 via WebCrypto with a random salt. The result is a structured object that stores all parameters needed for future verification:

```ts
import { hashPassword, verifyPassword } from '@workkit/auth'

// Hash a password
const hashed = await hashPassword('my-secret-password')
// {
//   hash: '7a3f...',         hex-encoded derived key
//   salt: 'b2c1...',         hex-encoded random salt
//   iterations: 100000,
//   algorithm: 'pbkdf2-sha-256'
// }

// Store the full object in your database
await db.run('INSERT INTO users (email, password) VALUES (?, ?)', [
  email,
  JSON.stringify(hashed),
])

// Verify a password
const stored = JSON.parse(user.password)
const valid = await verifyPassword('my-secret-password', stored)
// true or false (uses constant-time comparison)
```

Custom iteration count for environments where you want to tune the cost:

```ts
const hashed = await hashPassword('password', { iterations: 200_000 })
```

## Session Management

KV-backed sessions with automatic expiration and cookie handling:

```ts
import { createSessionManager } from '@workkit/auth'

interface SessionData {
  userId: string
  role: string
  preferences: Record<string, unknown>
}

const sessions = createSessionManager<SessionData>({
  store: env.SESSION_KV,    // KVNamespace binding
  ttl: 86400,               // 24 hours (default)
  cookieName: 'session_id', // default
  secure: true,             // default (set false for local dev)
  sameSite: 'Lax',          // default, also 'Strict' or 'None'
  domain: 'example.com',    // optional
  path: '/',                // default
})
```

### Create a Session

```ts
const { sessionId, cookie } = await sessions.create({
  userId: 'user-123',
  role: 'admin',
  preferences: { theme: 'dark' },
})

return new Response('Logged in', {
  headers: { 'Set-Cookie': cookie },
})
// cookie: "session_id=abc123; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Lax"
```

### Read a Session from Request

```ts
const session = await sessions.fromRequest(request)
if (!session) {
  return new Response('Unauthorized', { status: 401 })
}

console.log(session.data.userId)  // 'user-123'
console.log(session.expiresAt)    // unix timestamp
```

### Get a Session by ID

```ts
const session = await sessions.get(sessionId)
// Session<SessionData> | null
// Automatically checks expiration (double-check beyond KV TTL)
```

### Update Session Data

```ts
await sessions.update(sessionId, {
  userId: 'user-123',
  role: 'admin',
  preferences: { theme: 'light' },  // updated
})
// Preserves remaining TTL -- does not reset expiration
```

### Destroy a Session

```ts
await sessions.destroy(sessionId)
```

## Header Extraction

```ts
import { extractBearerToken, extractBasicAuth } from '@workkit/auth'

// Extract Bearer token from Authorization header
const token = extractBearerToken(request)
// string | null

// Extract Basic auth credentials
const credentials = extractBasicAuth(request)
// { username: string, password: string } | null
```

## Auth Handler

The auth handler wraps your fetch handlers with authentication logic. Define a `verify` function once and use `.required()`, `.optional()`, or `.requireRole()` on any handler:

```ts
import { createAuthHandler, verifyJWT, extractBearerToken } from '@workkit/auth'

interface AuthContext {
  userId: string
  role: string
}

const auth = createAuthHandler<AuthContext>({
  async verify(request, env) {
    const token = extractBearerToken(request)
    if (!token) return null

    try {
      const payload = await verifyJWT<AuthContext>(token, {
        secret: env.JWT_SECRET,
      })
      return { userId: payload.userId, role: payload.role }
    } catch {
      return null
    }
  },
  // Optional custom responses (defaults to standard 401/403 JSON)
  // unauthorized: () => new Response('Login required', { status: 401 }),
  // forbidden: () => new Response('Access denied', { status: 403 }),
})
```

### Required Auth

Handler only runs if authentication succeeds:

```ts
const getProfile = auth.required(async (request, env, ctx, authCtx) => {
  const user = await db.first('SELECT * FROM users WHERE id = ?', [authCtx.userId])
  return Response.json(user)
})
// Returns 401 if not authenticated
```

### Optional Auth

Handler always runs, auth context may be null:

```ts
const getPublicProfile = auth.optional(async (request, env, ctx, authCtx) => {
  const userId = new URL(request.url).searchParams.get('id')
  const user = await db.first('SELECT * FROM users WHERE id = ?', [userId])

  // Show more data if authenticated
  if (authCtx) {
    return Response.json(user)
  }
  return Response.json({ name: user.name })  // limited data
})
```

### Role-Based Auth

Handler only runs if authenticated AND the role matches:

```ts
const adminDashboard = auth.requireRole('admin', async (request, env, ctx, authCtx) => {
  const stats = await getAdminStats()
  return Response.json(stats)
})
// Returns 401 if not authenticated, 403 if wrong role
```

## Full Example: Login Flow

```ts
import { signJWT, verifyPassword, createSessionManager, createAuthHandler } from '@workkit/auth'
import { d1 } from '@workkit/d1'

export default {
  async fetch(request: Request, env: Env) {
    const db = d1(env.DB)
    const url = new URL(request.url)

    if (url.pathname === '/login' && request.method === 'POST') {
      const { email, password } = await request.json()

      const user = await db.first<{ id: string; password: string; role: string }>(
        'SELECT id, password, role FROM users WHERE email = ?',
        [email],
      )

      if (!user) {
        return Response.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      const valid = await verifyPassword(password, JSON.parse(user.password))
      if (!valid) {
        return Response.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      const token = await signJWT(
        { userId: user.id, role: user.role },
        { secret: env.JWT_SECRET, expiresIn: '24h' },
      )

      return Response.json({ token })
    }

    // ... protected routes using auth handler
  },
}
```
