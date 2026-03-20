/**
 * Full-Stack App — Complete application combining most workkit packages
 *
 * A task management API that demonstrates:
 *   - @workkit/env for binding validation
 *   - @workkit/hono for framework integration
 *   - @workkit/d1 for database operations
 *   - @workkit/kv for session caching
 *   - @workkit/auth for JWT authentication
 *   - @workkit/cache for stale-while-revalidate caching
 *   - @workkit/ratelimit for API throttling
 *   - @workkit/errors for structured error handling
 *   - @workkit/api for typed route definitions
 */
import { Hono } from 'hono'
import { workkit, getEnv, workkitErrorHandler } from '@workkit/hono'
import {
  d1 as d1Validator,
  kv as kvValidator,
} from '@workkit/env/validators'
import { d1 } from '@workkit/d1'
import { kv } from '@workkit/kv'
import { signJWT, verifyJWT, extractBearerToken, hashPassword, verifyPassword } from '@workkit/auth'
import { swr } from '@workkit/cache'
import { fixedWindow, rateLimitHeaders, rateLimitResponse } from '@workkit/ratelimit'
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  ConflictError,
  errorToResponse,
  isWorkkitError,
} from '@workkit/errors'
import { z } from 'zod'

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: number
  email: string
  name: string
  password_hash: string
  created_at: string
}

interface Task {
  id: number
  user_id: number
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  due_date: string | null
  created_at: string
  updated_at: string
}

interface JWTPayload {
  sub: string
  email: string
}

interface SessionData {
  userId: number
  email: string
  loginAt: string
}

// ─── Environment Schema ───────────────────────────────────────────────────────

const envSchema = {
  DB: d1Validator(),
  SESSION_KV: kvValidator(),
  RATE_LIMIT_KV: kvValidator(),
  JWT_SECRET: z.string().min(32),
  ENVIRONMENT: z.enum(['development', 'staging', 'production']),
}

// ─── App Setup ────────────────────────────────────────────────────────────────

type Env = { Bindings: Record<string, unknown> }
const app = new Hono<Env>()

app.use('*', workkit({ env: envSchema }))
app.onError(workkitErrorHandler())

// ─── Global Rate Limiting ─────────────────────────────────────────────────────

app.use('/api/*', async (c, next) => {
  const env = getEnv(c)
  const ip = c.req.header('cf-connecting-ip') ?? 'anonymous'

  const limiter = fixedWindow({
    namespace: env.RATE_LIMIT_KV,
    limit: 60,
    window: '1m',
  })

  const result = await limiter.check(`api:${ip}`)
  if (!result.allowed) {
    return rateLimitResponse(result)
  }

  await next()

  const headers = rateLimitHeaders(result)
  for (const [key, value] of Object.entries(headers)) {
    if (value) c.res.headers.set(key, value)
  }
})

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

async function requireAuth(c: any): Promise<JWTPayload> {
  const token = extractBearerToken(c.req.raw)
  if (!token) throw new UnauthorizedError('Missing Authorization header')

  const env = getEnv(c)

  // Check session cache first (faster than JWT verification)
  const sessions = kv<SessionData>(env.SESSION_KV, { prefix: 'session:' })
  const cached = await sessions.get(token.substring(0, 32)) // Use first 32 chars as cache key

  if (cached) {
    return { sub: String(cached.userId), email: cached.email }
  }

  // Verify JWT
  const payload = await verifyJWT<JWTPayload>(token, {
    secret: env.JWT_SECRET,
    algorithms: ['HS256'],
  })

  // Cache the session for faster subsequent lookups (5 minute TTL)
  await sessions.put(token.substring(0, 32), {
    userId: parseInt(payload.sub, 10),
    email: payload.email,
    loginAt: new Date().toISOString(),
  }, { ttl: 300 })

  return payload
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
})

app.post('/api/auth/register', async (c) => {
  const body = registerSchema.parse(await c.req.json())
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  // Check if email is taken
  const existing = await db.first<User>(
    'SELECT id FROM users WHERE email = ?',
    [body.email],
  )
  if (existing) {
    throw new ConflictError(`Email ${body.email} is already registered`)
  }

  // Hash password with @workkit/auth
  const passwordHash = await hashPassword(body.password)

  // Insert user
  const user = await db.insert('users')
    .values({
      email: body.email,
      name: body.name,
      password_hash: passwordHash,
    })
    .returning<User>('id', 'email', 'name', 'created_at')
    .first()

  // Generate JWT
  const token = await signJWT<JWTPayload>(
    { sub: String(user!.id), email: user!.email },
    { secret: env.JWT_SECRET, expiresIn: '7d', issuer: 'workkit-fullstack' },
  )

  return c.json({ token, user: { id: user!.id, email: user!.email, name: user!.name } }, 201)
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

app.post('/api/auth/login', async (c) => {
  const body = loginSchema.parse(await c.req.json())
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const user = await db.first<User>(
    'SELECT * FROM users WHERE email = ?',
    [body.email],
  )
  if (!user) throw new UnauthorizedError('Invalid email or password')

  // Verify password hash
  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) throw new UnauthorizedError('Invalid email or password')

  const token = await signJWT<JWTPayload>(
    { sub: String(user.id), email: user.email },
    { secret: env.JWT_SECRET, expiresIn: '7d', issuer: 'workkit-fullstack' },
  )

  return c.json({ token, user: { id: user.id, email: user.email, name: user.name } })
})

// ─── Task Routes ──────────────────────────────────────────────────────────────

/** GET /api/tasks — List tasks with filtering and pagination */
app.get('/api/tasks', async (c) => {
  const auth = await requireAuth(c)
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const status = c.req.query('status') as Task['status'] | undefined
  const priority = c.req.query('priority') as Task['priority'] | undefined
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)

  // Build query with optional filters
  let query = db.select<Task>('tasks')
    .where({ user_id: parseInt(auth.sub, 10) })

  if (status) query = query.andWhere({ status })
  if (priority) query = query.andWhere({ priority })

  const tasks = await query
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset((page - 1) * limit)
    .all()

  // Cached total count (SWR — count doesn't need to be real-time)
  const countResult = await swr<{ total: number }>({
    key: `task-count:${auth.sub}:${status ?? 'all'}:${priority ?? 'all'}`,
    ttl: 30,
    staleWhileRevalidate: 300,
    async fetch() {
      let countQuery = db.select<Task>('tasks')
        .where({ user_id: parseInt(auth.sub, 10) })
      if (status) countQuery = countQuery.andWhere({ status })
      if (priority) countQuery = countQuery.andWhere({ priority })
      return { total: await countQuery.count() }
    },
  })

  return c.json({
    data: tasks,
    pagination: {
      page,
      limit,
      total: countResult.data.total,
      pages: Math.ceil(countResult.data.total / limit),
    },
  })
})

/** GET /api/tasks/:id — Get a single task */
app.get('/api/tasks/:id', async (c) => {
  const auth = await requireAuth(c)
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const task = await db.select<Task>('tasks')
    .where({ id: parseInt(c.req.param('id'), 10), user_id: parseInt(auth.sub, 10) })
    .first()

  if (!task) throw new NotFoundError('Task not found')

  return c.json({ data: task })
})

/** POST /api/tasks — Create a task */
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().default(null),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().nullable().default(null),
})

app.post('/api/tasks', async (c) => {
  const auth = await requireAuth(c)
  const body = createTaskSchema.parse(await c.req.json())
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const task = await db.insert('tasks')
    .values({
      user_id: parseInt(auth.sub, 10),
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      due_date: body.dueDate,
    })
    .returning<Task>('*')
    .first()

  return c.json({ data: task }, 201)
})

/** PATCH /api/tasks/:id — Update a task */
const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: z.string().nullable().optional(),
})

app.patch('/api/tasks/:id', async (c) => {
  const auth = await requireAuth(c)
  const body = updateTaskSchema.parse(await c.req.json())
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  // Build the SET clause from provided fields
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.status !== undefined) updates.status = body.status
  if (body.priority !== undefined) updates.priority = body.priority
  if (body.dueDate !== undefined) updates.due_date = body.dueDate

  const task = await db.update('tasks')
    .set(updates)
    .where({ id: parseInt(c.req.param('id'), 10), user_id: parseInt(auth.sub, 10) })
    .returning<Task>('*')
    .first()

  if (!task) throw new NotFoundError('Task not found')

  return c.json({ data: task })
})

/** DELETE /api/tasks/:id — Delete a task */
app.delete('/api/tasks/:id', async (c) => {
  const auth = await requireAuth(c)
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })

  const deleted = await db.delete('tasks')
    .where({ id: parseInt(c.req.param('id'), 10), user_id: parseInt(auth.sub, 10) })
    .returning<Task>('id')
    .first()

  if (!deleted) throw new NotFoundError('Task not found')

  return c.json({ message: 'Task deleted' })
})

// ─── Dashboard Stats (cached) ─────────────────────────────────────────────────

app.get('/api/stats', async (c) => {
  const auth = await requireAuth(c)
  const env = getEnv(c)
  const db = d1(env.DB, { transformColumns: 'camelCase' })
  const userId = parseInt(auth.sub, 10)

  // Cache dashboard stats with SWR — acceptable to be slightly stale
  const stats = await swr({
    key: `stats:${userId}`,
    ttl: 60,
    staleWhileRevalidate: 600,
    async fetch() {
      const [todo, inProgress, done, highPriority, overdue] = await Promise.all([
        db.select('tasks').where({ user_id: userId, status: 'todo' }).count(),
        db.select('tasks').where({ user_id: userId, status: 'in_progress' }).count(),
        db.select('tasks').where({ user_id: userId, status: 'done' }).count(),
        db.select('tasks').where({ user_id: userId, priority: 'high' })
          .andWhere('status != ?', ['done']).count(),
        db.first<{ count: number }>(
          `SELECT COUNT(*) as count FROM tasks
           WHERE user_id = ? AND due_date < ? AND status != 'done'`,
          [userId, new Date().toISOString()],
        ),
      ])

      return {
        todo,
        inProgress,
        done,
        total: todo + inProgress + done,
        highPriority,
        overdue: overdue?.count ?? 0,
      }
    },
  })

  return c.json({ data: stats.data, cached: stats.age > 0 })
})

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Export ───────────────────────────────────────────────────────────────────

export default app
