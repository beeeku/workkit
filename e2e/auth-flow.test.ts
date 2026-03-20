import { describe, it, expect } from 'vitest'
import {
  signJWT,
  verifyJWT,
  decodeJWT,
  parseDuration,
  createAuthHandler,
  createSessionManager,
  extractBearerToken,
  extractBasicAuth,
} from '@workkit/auth'
import { createMockKV, createRequest } from './helpers/setup'

const JWT_SECRET = 'test-secret-key-for-jwt-signing'

describe('Auth flow E2E', () => {
  describe('JWT sign and verify', () => {
    it('signs and verifies a JWT', async () => {
      const token = await signJWT(
        { userId: '123', role: 'admin' },
        { secret: JWT_SECRET, expiresIn: '1h' },
      )

      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3)

      const payload = await verifyJWT<{ userId: string; role: string }>(token, {
        secret: JWT_SECRET,
      })

      expect(payload.userId).toBe('123')
      expect(payload.role).toBe('admin')
      expect(payload.iat).toBeDefined()
      expect(payload.exp).toBeDefined()
    })

    it('decode returns header and payload without verification', () => {
      // Manually create a minimal token to decode
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const payload = btoa(JSON.stringify({ sub: '123' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const token = `${header}.${payload}.fakesig`

      const decoded = decodeJWT(token)
      expect(decoded.header.alg).toBe('HS256')
      expect((decoded.payload as any).sub).toBe('123')
    })

    it('rejects expired JWT', async () => {
      const shortToken = await signJWT(
        { userId: '123' },
        { secret: JWT_SECRET, expiresIn: '1s' },
      )

      // Wait long enough that Math.floor(Date.now()/1000) > exp
      // exp = iat + 1, so we need now > iat + 1, meaning at least 2 seconds from iat
      await new Promise((r) => setTimeout(r, 2100))

      await expect(
        verifyJWT(shortToken, { secret: JWT_SECRET }),
      ).rejects.toThrow('expired')
    })

    it('rejects JWT with wrong secret', async () => {
      const token = await signJWT({ userId: '123' }, { secret: JWT_SECRET })

      await expect(
        verifyJWT(token, { secret: 'wrong-secret' }),
      ).rejects.toThrow('signature')
    })

    it('validates issuer claim', async () => {
      const token = await signJWT(
        { userId: '123' },
        { secret: JWT_SECRET, issuer: 'my-app' },
      )

      // Correct issuer
      const payload = await verifyJWT(token, {
        secret: JWT_SECRET,
        issuer: 'my-app',
      })
      expect(payload.iss).toBe('my-app')

      // Wrong issuer
      await expect(
        verifyJWT(token, { secret: JWT_SECRET, issuer: 'other-app' }),
      ).rejects.toThrow('issuer')
    })

    it('validates audience claim', async () => {
      const token = await signJWT(
        { userId: '123' },
        { secret: JWT_SECRET, audience: 'api' },
      )

      const payload = await verifyJWT(token, {
        secret: JWT_SECRET,
        audience: 'api',
      })
      expect(payload.aud).toBe('api')

      await expect(
        verifyJWT(token, { secret: JWT_SECRET, audience: 'web' }),
      ).rejects.toThrow('audience')
    })

    it('rejects disallowed algorithm', async () => {
      const token = await signJWT({ userId: '123' }, { secret: JWT_SECRET, algorithm: 'HS256' })

      await expect(
        verifyJWT(token, { secret: JWT_SECRET, algorithms: ['HS512'] }),
      ).rejects.toThrow('not allowed')
    })

    it('supports HS384 algorithm', async () => {
      const token = await signJWT(
        { data: 'test' },
        { secret: JWT_SECRET, algorithm: 'HS384' },
      )

      const payload = await verifyJWT(token, {
        secret: JWT_SECRET,
        algorithms: ['HS384'],
      })
      expect(payload.data).toBe('test')
    })

    it('supports HS512 algorithm', async () => {
      const token = await signJWT(
        { data: 'test' },
        { secret: JWT_SECRET, algorithm: 'HS512' },
      )

      const payload = await verifyJWT(token, {
        secret: JWT_SECRET,
        algorithms: ['HS512'],
      })
      expect(payload.data).toBe('test')
    })

    it('parseDuration handles various formats', () => {
      expect(parseDuration('30s')).toBe(30)
      expect(parseDuration('5m')).toBe(300)
      expect(parseDuration('2h')).toBe(7200)
      expect(parseDuration('1d')).toBe(86400)
      expect(parseDuration('1w')).toBe(604800)
    })

    it('parseDuration rejects invalid format', () => {
      expect(() => parseDuration('abc')).toThrow()
      expect(() => parseDuration('10x')).toThrow()
    })
  })

  describe('session management', () => {
    it('creates a session in KV', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string }>({ store: kv })

      const result = await sessions.create({ userId: '123' })
      expect(result.sessionId).toBeDefined()
      expect(result.sessionId.length).toBeGreaterThan(0)
      expect(result.cookie).toContain('session_id=')
    })

    it('retrieves a session by ID', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string; name: string }>({ store: kv })

      const { sessionId } = await sessions.create({ userId: '123', name: 'Alice' })
      const session = await sessions.get(sessionId)

      expect(session).not.toBeNull()
      expect(session!.id).toBe(sessionId)
      expect(session!.data.userId).toBe('123')
      expect(session!.data.name).toBe('Alice')
    })

    it('reads session from request cookies', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string }>({ store: kv })

      const { sessionId } = await sessions.create({ userId: '456' })

      const req = createRequest('/api/me', {
        headers: { Cookie: `session_id=${sessionId}` },
      })

      const session = await sessions.fromRequest(req)
      expect(session).not.toBeNull()
      expect(session!.data.userId).toBe('456')
    })

    it('returns null for request without cookies', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string }>({ store: kv })

      const req = createRequest('/api/me')
      const session = await sessions.fromRequest(req)
      expect(session).toBeNull()
    })

    it('returns null for invalid session ID', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string }>({ store: kv })

      const session = await sessions.get('nonexistent-id')
      expect(session).toBeNull()
    })

    it('updates session data', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string; lastPage: string }>({ store: kv })

      const { sessionId } = await sessions.create({ userId: '123', lastPage: '/home' })
      await sessions.update(sessionId, { userId: '123', lastPage: '/dashboard' })

      const session = await sessions.get(sessionId)
      expect(session!.data.lastPage).toBe('/dashboard')
    })

    it('destroys a session', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string }>({ store: kv })

      const { sessionId } = await sessions.create({ userId: '123' })
      expect(await sessions.get(sessionId)).not.toBeNull()

      await sessions.destroy(sessionId)
      expect(await sessions.get(sessionId)).toBeNull()
    })

    it('uses custom cookie name', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string }>({
        store: kv,
        cookieName: 'my_session',
      })

      const { cookie, sessionId } = await sessions.create({ userId: '123' })
      expect(cookie).toContain('my_session=')

      const req = createRequest('/api/me', {
        headers: { Cookie: `my_session=${sessionId}` },
      })
      const session = await sessions.fromRequest(req)
      expect(session).not.toBeNull()
    })

    it('cookie includes security attributes', async () => {
      const kv = createMockKV()
      const sessions = createSessionManager<{ userId: string }>({
        store: kv,
        secure: true,
        sameSite: 'Strict',
      })

      const { cookie } = await sessions.create({ userId: '123' })
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('SameSite=Strict')
      expect(cookie).toContain('HttpOnly')
    })
  })

  describe('auth handler — protected routes', () => {
    it('required() rejects unauthenticated requests', async () => {
      const auth = createAuthHandler<{ userId: string }>({
        verify: async (req) => {
          const token = extractBearerToken(req)
          if (!token) return null
          try {
            const payload = await verifyJWT<{ userId: string }>(token, { secret: JWT_SECRET })
            return { userId: payload.userId }
          } catch {
            return null
          }
        },
      })

      const handler = auth.required(async (_req, _env, _ctx, authCtx) => {
        return new Response(JSON.stringify({ userId: authCtx.userId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      // No auth header
      const res = await handler(createRequest('/api/me'), {}, {} as any)
      expect(res.status).toBe(401)
    })

    it('required() allows authenticated requests', async () => {
      const auth = createAuthHandler<{ userId: string }>({
        verify: async (req) => {
          const token = extractBearerToken(req)
          if (!token) return null
          try {
            const payload = await verifyJWT<{ userId: string }>(token, { secret: JWT_SECRET })
            return { userId: payload.userId }
          } catch {
            return null
          }
        },
      })

      const handler = auth.required(async (_req, _env, _ctx, authCtx) => {
        return new Response(JSON.stringify({ userId: authCtx.userId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const token = await signJWT({ userId: 'user-42' }, { secret: JWT_SECRET, expiresIn: '1h' })
      const req = createRequest('/api/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const res = await handler(req, {}, {} as any)
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.userId).toBe('user-42')
    })

    it('optional() passes null auth context when unauthenticated', async () => {
      const auth = createAuthHandler<{ userId: string }>({
        verify: async (req) => {
          const token = extractBearerToken(req)
          if (!token) return null
          return { userId: 'test' }
        },
      })

      const handler = auth.optional(async (_req, _env, _ctx, authCtx) => {
        return new Response(JSON.stringify({ authed: authCtx !== null }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const res = await handler(createRequest('/api/public'), {}, {} as any)
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.authed).toBe(false)
    })

    it('requireRole() rejects wrong role', async () => {
      const auth = createAuthHandler<{ userId: string; role: string }>({
        verify: async (req) => {
          const token = extractBearerToken(req)
          if (!token) return null
          try {
            const payload = await verifyJWT<{ userId: string; role: string }>(token, { secret: JWT_SECRET })
            return { userId: payload.userId, role: payload.role }
          } catch {
            return null
          }
        },
      })

      const handler = auth.requireRole('admin', async (_req, _env, _ctx, authCtx) => {
        return new Response(JSON.stringify({ access: true }))
      })

      // User is 'viewer', not 'admin'
      const token = await signJWT(
        { userId: '123', role: 'viewer' },
        { secret: JWT_SECRET, expiresIn: '1h' },
      )
      const req = createRequest('/admin', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const res = await handler(req, {}, {} as any)
      expect(res.status).toBe(403)
    })

    it('requireRole() allows correct role', async () => {
      const auth = createAuthHandler<{ userId: string; role: string }>({
        verify: async (req) => {
          const token = extractBearerToken(req)
          if (!token) return null
          try {
            const payload = await verifyJWT<{ userId: string; role: string }>(token, { secret: JWT_SECRET })
            return { userId: payload.userId, role: payload.role }
          } catch {
            return null
          }
        },
      })

      const handler = auth.requireRole('admin', async (_req, _env, _ctx, authCtx) => {
        return new Response(JSON.stringify({ access: true }))
      })

      const token = await signJWT(
        { userId: '123', role: 'admin' },
        { secret: JWT_SECRET, expiresIn: '1h' },
      )
      const req = createRequest('/admin', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const res = await handler(req, {}, {} as any)
      expect(res.status).toBe(200)
    })
  })

  describe('header extraction utilities', () => {
    it('extractBearerToken returns token', () => {
      const req = createRequest('/api', {
        headers: { Authorization: 'Bearer my-token-123' },
      })
      expect(extractBearerToken(req)).toBe('my-token-123')
    })

    it('extractBearerToken returns null without auth header', () => {
      expect(extractBearerToken(createRequest('/api'))).toBeNull()
    })

    it('extractBearerToken returns null for non-Bearer scheme', () => {
      const req = createRequest('/api', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      })
      expect(extractBearerToken(req)).toBeNull()
    })

    it('extractBasicAuth returns credentials', () => {
      const encoded = btoa('user:pass')
      const req = createRequest('/api', {
        headers: { Authorization: `Basic ${encoded}` },
      })
      const creds = extractBasicAuth(req)
      expect(creds).not.toBeNull()
      expect(creds!.username).toBe('user')
      expect(creds!.password).toBe('pass')
    })

    it('extractBasicAuth handles password with colon', () => {
      const encoded = btoa('user:pass:with:colons')
      const req = createRequest('/api', {
        headers: { Authorization: `Basic ${encoded}` },
      })
      const creds = extractBasicAuth(req)
      expect(creds!.username).toBe('user')
      expect(creds!.password).toBe('pass:with:colons')
    })

    it('extractBasicAuth returns null without auth header', () => {
      expect(extractBasicAuth(createRequest('/api'))).toBeNull()
    })
  })
})
