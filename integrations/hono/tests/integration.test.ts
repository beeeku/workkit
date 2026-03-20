import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { workkit } from '../src/middleware'
import { workkitErrorHandler } from '../src/error-handler'
import { rateLimit } from '../src/rate-limit'
import { getEnv } from '../src/helpers'
import { NotFoundError, ValidationError } from '@workkit/errors'
import type { RateLimiter, RateLimitResult } from '../src/types'

function string() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate(value: unknown) {
        if (typeof value === 'string') return { value }
        return { issues: [{ message: 'Expected string', path: [] }] }
      },
    },
  }
}

function createMockLimiter(
  fn: (key: string) => RateLimitResult,
): RateLimiter {
  return {
    check: vi.fn(async (key: string) => fn(key)),
  }
}

describe('integration: workkit + errorHandler', () => {
  it('env validation errors are caught by error handler', async () => {
    const schema = { API_KEY: string() }
    const app = new Hono()
    app.onError(workkitErrorHandler())
    app.use(workkit({ env: schema }))
    app.get('/', (c) => c.text('ok'))

    const res = await app.request('/', undefined, {})
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe('WORKKIT_VALIDATION')
  })

  it('workkit env + getEnv + error handler work together', async () => {
    const schema = { TOKEN: string() }
    const app = new Hono<{ Bindings: { TOKEN: string } }>()

    app.onError(workkitErrorHandler())
    app.use(workkit({ env: schema }))

    app.get('/protected', (c) => {
      const env = getEnv(c as any)
      if (env.TOKEN !== 'valid-token') {
        throw new NotFoundError('Resource')
      }
      return c.json({ access: 'granted' })
    })

    // Valid token
    const res1 = await app.request('/protected', undefined, {
      TOKEN: 'valid-token',
    })
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1.access).toBe('granted')

    // Different token (still valid env, but handler throws)
    // Need a new app instance since env is cached
    const app2 = new Hono<{ Bindings: { TOKEN: string } }>()
    app2.onError(workkitErrorHandler())
    app2.use(workkit({ env: schema }))
    app2.get('/protected', (c) => {
      const env = getEnv(c as any)
      if (env.TOKEN !== 'valid-token') {
        throw new NotFoundError('Resource')
      }
      return c.json({ access: 'granted' })
    })

    const res2 = await app2.request('/protected', undefined, {
      TOKEN: 'wrong-token',
    })
    expect(res2.status).toBe(404)
  })
})

describe('integration: rateLimit + errorHandler', () => {
  it('rate limited requests get proper 429 response', async () => {
    const limiter = createMockLimiter(() => ({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30000,
    }))

    const app = new Hono()
    app.onError(workkitErrorHandler())
    app.use('/api/*', rateLimit({ limiter, keyFn: () => 'key' }))
    app.get('/api/data', (c) => c.json({ data: 'ok' }))

    const res = await app.request('/api/data')
    expect(res.status).toBe(429)

    const body = await res.json()
    expect(body.error.code).toBe('WORKKIT_RATE_LIMIT')
  })

  it('non-rate-limited requests pass through', async () => {
    const limiter = createMockLimiter(() => ({
      allowed: true,
      remaining: 99,
      resetAt: Date.now() + 60000,
    }))

    const app = new Hono()
    app.onError(workkitErrorHandler())
    app.use('/api/*', rateLimit({ limiter, keyFn: () => 'key' }))
    app.get('/api/data', (c) => c.json({ data: 'ok' }))

    const res = await app.request('/api/data')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toBe('ok')
  })
})

describe('integration: full stack', () => {
  it('workkit + rateLimit + errorHandler compose correctly', async () => {
    const envSchema = { API_KEY: string() }
    let requestCount = 0
    const limiter = createMockLimiter(() => {
      requestCount++
      return {
        allowed: requestCount <= 2,
        remaining: Math.max(0, 2 - requestCount),
        resetAt: Date.now() + 60000,
      }
    })

    const app = new Hono<{ Bindings: { API_KEY: string } }>()
    app.onError(workkitErrorHandler())
    app.use(workkit({ env: envSchema }))
    app.use('/api/*', rateLimit({ limiter, keyFn: () => 'test' }))
    app.get('/api/data', (c) => {
      const env = getEnv(c as any)
      return c.json({ key: env.API_KEY })
    })

    // First request: allowed
    const res1 = await app.request('/api/data', undefined, {
      API_KEY: 'key-123',
    })
    expect(res1.status).toBe(200)

    // Second request: allowed
    const res2 = await app.request('/api/data', undefined, {
      API_KEY: 'key-123',
    })
    expect(res2.status).toBe(200)

    // Third request: rate limited
    const res3 = await app.request('/api/data', undefined, {
      API_KEY: 'key-123',
    })
    expect(res3.status).toBe(429)
  })

  it('handler errors are caught by error handler after middleware passes', async () => {
    const envSchema = { SECRET: string() }
    const app = new Hono<{ Bindings: { SECRET: string } }>()

    app.onError(workkitErrorHandler())
    app.use(workkit({ env: envSchema }))

    app.post('/validate', async (c) => {
      const body = await c.req.json()
      if (!body.name) {
        throw new ValidationError('Missing required fields', [
          { path: ['name'], message: 'Name is required' },
        ])
      }
      return c.json({ ok: true })
    })

    const res = await app.request(
      '/validate',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      },
      { SECRET: 'shh' },
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('WORKKIT_VALIDATION')
    expect(body.error.issues[0].message).toBe('Name is required')
  })

  it('non-matched routes return standard Hono 404', async () => {
    const app = new Hono()
    app.onError(workkitErrorHandler())
    app.get('/exists', (c) => c.text('ok'))

    const res = await app.request('/does-not-exist')
    // Hono returns 404 for unmatched routes (not through our error handler)
    expect(res.status).toBe(404)
  })
})
