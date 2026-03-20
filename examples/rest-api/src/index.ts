/**
 * REST API — Full CRUD API with JWT auth, D1 database, and Hono framework
 *
 * Demonstrates building a production REST API with:
 *   - @workkit/api for typed route definitions with validation
 *   - @workkit/hono for framework integration
 *   - @workkit/d1 for typed database queries
 *   - @workkit/auth for JWT authentication
 *   - @workkit/errors for structured error responses
 */
import { Hono } from 'hono'
import { workkit, getEnv, workkitErrorHandler } from '@workkit/hono'
import { d1 as d1Validator, kv as kvValidator } from '@workkit/env/validators'
import { d1 } from '@workkit/d1'
import { signJWT, verifyJWT, extractBearerToken } from '@workkit/auth'
import { NotFoundError, UnauthorizedError, ValidationError, errorToResponse } from '@workkit/errors'
import { z } from 'zod'

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  created_at: string
}

interface JWTPayload {
  sub: string
  email: string
  role: string
}

// ─── Environment Schema ───────────────────────────────────────────────────────

const envSchema = {
  DB: d1Validator(),
  JWT_SECRET: z.string().min(32),
  ENVIRONMENT: z.enum(['development', 'staging', 'production']),
}

// ─── App Setup ────────────────────────────────────────────────────────────────

type Env = { Bindings: Record<string, unknown> }
const app = new Hono<Env>()

// Validate env on every request (cached after first)
app.use('*', workkit({ env: envSchema }))

// Structured error handling — WorkkitErrors become JSON responses with proper status codes
app.onError(workkitErrorHandler())

// ─── Auth Middleware ──────────────────────────────────────────────────────────

/** Extract and verify JWT from Authorization header */
async function requireAuth(c: any): Promise<JWTPayload> {
  const token = extractBearerToken(c.req.raw)
  if (!token) {
    throw new UnauthorizedError('Missing or invalid Authorization header')
  }

  const env = getEnv(c)
  const payload = await verifyJWT<JWTPayload>(token, {
    secret: env.JWT_SECRET,
    algorithms: ['HS256'],
  })

  return payload
}

// ─── Routes: Auth ─────────────────────────────────────────────────────────────

/**
 * POST /auth/login — Authenticate and receive a JWT
 *
 * BEFORE (raw):
 *   - Parse JSON body manually, hope fields exist
 *   - Roll your own JWT with jsonwebtoken or jose
 *   - Manually construct error responses with status codes
 *
 * AFTER (workkit):
 *   - Zod validates the body; invalid input returns 422 automatically
 *   - signJWT uses WebCrypto (no deps), handles exp/iss/aud
 *   - WorkkitErrors serialize to structured JSON with correct HTTP status
 */
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

app.post('/auth/login', async (c) => {
  const body = loginSchema.parse(await c.req.json())
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const user = await db.first<User>(
    'SELECT * FROM users WHERE email = ?',
    [body.email],
  )

  if (!user) {
    throw new UnauthorizedError('Invalid email or password')
  }

  // In production, use @workkit/auth's verifyPassword() against a hash
  // This is simplified for the example
  const token = await signJWT<JWTPayload>(
    { sub: String(user.id), email: user.email, role: user.role },
    { secret: env.JWT_SECRET, expiresIn: '24h', issuer: 'workkit-api' },
  )

  return c.json({ token, user: { id: user.id, email: user.email, name: user.name } })
})

// ─── Routes: Users CRUD ───────────────────────────────────────────────────────

/** GET /users — List users with pagination */
app.get('/users', async (c) => {
  const auth = await requireAuth(c)
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const page = parseInt(c.req.query('page') ?? '1', 10)
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
  const offset = (page - 1) * limit

  // ─── BEFORE (raw D1 API) ───────────────────────────────────────
  // const stmt = env.DB.prepare('SELECT * FROM users LIMIT ? OFFSET ?')
  //   .bind(limit, offset)
  // const result = await stmt.all()
  // const users = result.results  // untyped Record<string, unknown>[]
  // // Manual snake_case → camelCase if you care about JS conventions

  // ─── AFTER (workkit query builder) ─────────────────────────────
  const users = await db.select<User>('users')
    .columns('id', 'email', 'name', 'role', 'created_at')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .all()

  const total = await db.select<User>('users').count()

  return c.json({
    data: users,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

/** GET /users/:id — Get a single user */
app.get('/users/:id', async (c) => {
  await requireAuth(c)
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const user = await db.select<User>('users')
    .where({ id: parseInt(c.req.param('id'), 10) })
    .first()

  if (!user) {
    throw new NotFoundError(`User ${c.req.param('id')} not found`)
  }

  return c.json({ data: user })
})

/** POST /users — Create a new user (admin only) */
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'user']).default('user'),
})

app.post('/users', async (c) => {
  const auth = await requireAuth(c)
  if (auth.role !== 'admin') {
    throw new ValidationError('Only admins can create users')
  }

  const body = createUserSchema.parse(await c.req.json())
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  // Insert with RETURNING to get the created row back
  const created = await db.insert('users')
    .values({ email: body.email, name: body.name, role: body.role })
    .returning<User>('*')
    .first()

  return c.json({ data: created }, 201)
})

/** PATCH /users/:id — Update a user */
const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
})

app.patch('/users/:id', async (c) => {
  const auth = await requireAuth(c)
  const id = parseInt(c.req.param('id'), 10)

  // Users can update themselves; admins can update anyone
  if (auth.role !== 'admin' && auth.sub !== String(id)) {
    throw new ValidationError('You can only update your own profile')
  }

  const body = updateUserSchema.parse(await c.req.json())
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const updated = await db.update('users')
    .set(body)
    .where({ id })
    .returning<User>('*')
    .first()

  if (!updated) {
    throw new NotFoundError(`User ${id} not found`)
  }

  return c.json({ data: updated })
})

/** DELETE /users/:id — Delete a user (admin only) */
app.delete('/users/:id', async (c) => {
  const auth = await requireAuth(c)
  if (auth.role !== 'admin') {
    throw new ValidationError('Only admins can delete users')
  }

  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })
  const id = parseInt(c.req.param('id'), 10)

  const deleted = await db.delete('users')
    .where({ id })
    .returning<User>('id')
    .first()

  if (!deleted) {
    throw new NotFoundError(`User ${id} not found`)
  }

  return c.json({ message: 'User deleted' })
})

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Export ───────────────────────────────────────────────────────────────────

export default app
