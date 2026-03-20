import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSessionManager } from '../src/session'

type TestSessionData = { userId: string; cart: string[] }

/** Create a mock KV namespace */
function createMockKV() {
  const store = new Map<string, { value: string; expiration?: number }>()

  return {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiration && Date.now() / 1000 > entry.expiration) {
        store.delete(key)
        return null
      }
      return entry.value
    }),
    put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      const expiration = opts?.expirationTtl
        ? Math.floor(Date.now() / 1000) + opts.expirationTtl
        : undefined
      store.set(key, { value, expiration })
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, any> }
}

describe('createSessionManager', () => {
  let kv: ReturnType<typeof createMockKV>

  beforeEach(() => {
    kv = createMockKV()
  })

  describe('create', () => {
    it('creates a session with typed data', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const result = await sessions.create({ userId: '123', cart: [] })

      expect(result.sessionId).toBeTruthy()
      expect(result.sessionId).toHaveLength(64) // 32 bytes hex
      expect(result.cookie).toContain('session_id=')
    })

    it('stores session in KV', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { sessionId } = await sessions.create({ userId: '123', cart: ['item1'] })

      expect(kv.put).toHaveBeenCalledOnce()
      const storedKey = (kv.put as any).mock.calls[0][0]
      expect(storedKey).toBe(`session:${sessionId}`)
    })

    it('generates unique session IDs', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const ids = new Set<string>()

      for (let i = 0; i < 10; i++) {
        const { sessionId } = await sessions.create({ userId: '123', cart: [] })
        ids.add(sessionId)
      }

      expect(ids.size).toBe(10)
    })

    it('includes cookie attributes', async () => {
      const sessions = createSessionManager<TestSessionData>({
        store: kv,
        ttl: 3600,
        secure: true,
        sameSite: 'Strict',
        domain: 'example.com',
        path: '/api',
      })

      const { cookie } = await sessions.create({ userId: '123', cart: [] })

      expect(cookie).toContain('Max-Age=3600')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Strict')
      expect(cookie).toContain('Domain=example.com')
      expect(cookie).toContain('Path=/api')
    })

    it('uses default cookie name', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { cookie } = await sessions.create({ userId: '123', cart: [] })

      expect(cookie).toMatch(/^session_id=/)
    })

    it('uses custom cookie name', async () => {
      const sessions = createSessionManager<TestSessionData>({
        store: kv,
        cookieName: 'sid',
      })
      const { cookie } = await sessions.create({ userId: '123', cart: [] })

      expect(cookie).toMatch(/^sid=/)
    })
  })

  describe('get', () => {
    it('retrieves an existing session', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { sessionId } = await sessions.create({ userId: '123', cart: ['a'] })

      const session = await sessions.get(sessionId)

      expect(session).not.toBeNull()
      expect(session!.id).toBe(sessionId)
      expect(session!.data.userId).toBe('123')
      expect(session!.data.cart).toEqual(['a'])
    })

    it('returns null for non-existent session', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const session = await sessions.get('nonexistent')

      expect(session).toBeNull()
    })

    it('returns null for expired session', async () => {
      const sessions = createSessionManager<TestSessionData>({
        store: kv,
        ttl: 1,
      })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      // Manually expire the session
      const storedRaw = await kv.get(`session:${sessionId}`)
      const stored = JSON.parse(storedRaw!)
      stored.expiresAt = Math.floor(Date.now() / 1000) - 10
      await kv.put(`session:${sessionId}`, JSON.stringify(stored))

      const session = await sessions.get(sessionId)

      expect(session).toBeNull()
    })

    it('includes createdAt and expiresAt', async () => {
      const sessions = createSessionManager<TestSessionData>({
        store: kv,
        ttl: 7200,
      })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      const session = await sessions.get(sessionId)

      expect(session!.createdAt).toBeDefined()
      expect(session!.expiresAt).toBeDefined()
      expect(session!.expiresAt - session!.createdAt).toBe(7200)
    })
  })

  describe('fromRequest', () => {
    it('extracts session from request cookie', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      const request = new Request('https://example.com', {
        headers: { Cookie: `session_id=${sessionId}` },
      })

      const session = await sessions.fromRequest(request)

      expect(session).not.toBeNull()
      expect(session!.data.userId).toBe('123')
    })

    it('returns null when no Cookie header', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const request = new Request('https://example.com')

      const session = await sessions.fromRequest(request)

      expect(session).toBeNull()
    })

    it('returns null when cookie not present', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const request = new Request('https://example.com', {
        headers: { Cookie: 'other_cookie=value' },
      })

      const session = await sessions.fromRequest(request)

      expect(session).toBeNull()
    })

    it('handles multiple cookies', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      const request = new Request('https://example.com', {
        headers: { Cookie: `theme=dark; session_id=${sessionId}; lang=en` },
      })

      const session = await sessions.fromRequest(request)

      expect(session).not.toBeNull()
      expect(session!.data.userId).toBe('123')
    })

    it('uses custom cookie name', async () => {
      const sessions = createSessionManager<TestSessionData>({
        store: kv,
        cookieName: 'sid',
      })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      const request = new Request('https://example.com', {
        headers: { Cookie: `sid=${sessionId}` },
      })

      const session = await sessions.fromRequest(request)

      expect(session).not.toBeNull()
    })
  })

  describe('update', () => {
    it('updates session data', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      await sessions.update(sessionId, { userId: '123', cart: ['item1', 'item2'] })

      const session = await sessions.get(sessionId)
      expect(session!.data.cart).toEqual(['item1', 'item2'])
    })

    it('throws NotFoundError for non-existent session', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })

      await expect(
        sessions.update('nonexistent', { userId: '123', cart: [] }),
      ).rejects.toThrow('not found')
    })

    it('preserves session metadata', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      const before = await sessions.get(sessionId)
      await sessions.update(sessionId, { userId: '456', cart: ['x'] })
      const after = await sessions.get(sessionId)

      expect(after!.id).toBe(before!.id)
      expect(after!.createdAt).toBe(before!.createdAt)
    })
  })

  describe('destroy', () => {
    it('removes the session', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })
      const { sessionId } = await sessions.create({ userId: '123', cart: [] })

      await sessions.destroy(sessionId)

      const session = await sessions.get(sessionId)
      expect(session).toBeNull()
    })

    it('does not throw for non-existent session', async () => {
      const sessions = createSessionManager<TestSessionData>({ store: kv })

      await expect(sessions.destroy('nonexistent')).resolves.not.toThrow()
    })
  })
})
