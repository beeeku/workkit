import { NotFoundError } from '@workkit/errors'
import type { SessionConfig, Session, CreateSessionResult, SessionManager } from './types'

/** Generate a cryptographically random session ID */
function generateSessionId(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Build a Set-Cookie header value */
function buildCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
    domain?: string
    path?: string
    httpOnly?: boolean
  },
): string {
  const parts = [`${name}=${value}`]

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.secure) parts.push('Secure')
  if (options.httpOnly !== false) parts.push('HttpOnly')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)

  return parts.join('; ')
}

/** Parse cookies from a Cookie header */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const [key, ...valueParts] = pair.trim().split('=')
    if (key) {
      cookies[key.trim()] = valueParts.join('=').trim()
    }
  }
  return cookies
}

/**
 * Create a KV-backed session manager with typed session data.
 *
 * Sessions are stored in a Cloudflare KV namespace with automatic
 * TTL-based expiration.
 */
export function createSessionManager<T>(config: SessionConfig): SessionManager<T> {
  const {
    store,
    ttl = 86400,
    cookieName = 'session_id',
    secure = true,
    sameSite = 'Lax',
    domain,
    path = '/',
  } = config

  const kvPrefix = 'session:'

  return {
    async create(data: T): Promise<CreateSessionResult> {
      const sessionId = generateSessionId()
      const now = Math.floor(Date.now() / 1000)

      const session: Session<T> = {
        id: sessionId,
        data,
        createdAt: now,
        expiresAt: now + ttl,
      }

      await store.put(`${kvPrefix}${sessionId}`, JSON.stringify(session), {
        expirationTtl: ttl,
      })

      const cookie = buildCookie(cookieName, sessionId, {
        maxAge: ttl,
        secure,
        sameSite,
        domain,
        path,
        httpOnly: true,
      })

      return { sessionId, cookie }
    },

    async get(sessionId: string): Promise<Session<T> | null> {
      const raw = await store.get(`${kvPrefix}${sessionId}`)
      if (!raw) return null

      const session = JSON.parse(raw) as Session<T>

      // Double-check expiration (KV TTL is eventually consistent)
      const now = Math.floor(Date.now() / 1000)
      if (now > session.expiresAt) {
        // Clean up expired session
        await store.delete(`${kvPrefix}${sessionId}`)
        return null
      }

      return session
    },

    async fromRequest(request: Request): Promise<Session<T> | null> {
      const cookieHeader = request.headers.get('Cookie')
      if (!cookieHeader) return null

      const cookies = parseCookies(cookieHeader)
      const sessionId = cookies[cookieName]
      if (!sessionId) return null

      return this.get(sessionId)
    },

    async update(sessionId: string, data: T): Promise<void> {
      const existing = await this.get(sessionId)
      if (!existing) {
        throw new NotFoundError('Session', sessionId)
      }

      const updated: Session<T> = {
        ...existing,
        data,
      }

      // Preserve remaining TTL
      const now = Math.floor(Date.now() / 1000)
      const remainingTtl = Math.max(1, existing.expiresAt - now)

      await store.put(`${kvPrefix}${sessionId}`, JSON.stringify(updated), {
        expirationTtl: remainingTtl,
      })
    },

    async destroy(sessionId: string): Promise<void> {
      await store.delete(`${kvPrefix}${sessionId}`)
    },
  }
}
