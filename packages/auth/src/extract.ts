import type { BasicAuthCredentials } from './types'

/**
 * Extract a bearer token from the Authorization header.
 *
 * @returns The token string, or null if not present or not a Bearer token
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header) return null

  const match = header.match(/^Bearer\s+(\S+)$/i)
  return match?.[1] ?? null
}

/**
 * Extract Basic Auth credentials from the Authorization header.
 *
 * @returns Username and password, or null if not present or not Basic auth
 */
export function extractBasicAuth(request: Request): BasicAuthCredentials | null {
  const header = request.headers.get('Authorization')
  if (!header) return null

  const match = header.match(/^Basic\s+(\S+)$/i)
  if (!match?.[1]) return null

  try {
    const decoded = atob(match[1])
    const colonIndex = decoded.indexOf(':')
    if (colonIndex === -1) return null

    return {
      username: decoded.substring(0, colonIndex),
      password: decoded.substring(colonIndex + 1),
    }
  } catch {
    return null
  }
}
