import type { RateLimitResult } from './types'

/** Standard rate limit header names */
export interface RateLimitHeaders {
  'X-RateLimit-Limit': string
  'X-RateLimit-Remaining': string
  'X-RateLimit-Reset': string
  'Retry-After'?: string
}

/**
 * Generate standard rate limit headers from a result.
 *
 * @example
 * ```ts
 * const headers = rateLimitHeaders(result)
 * return new Response('OK', { headers })
 * ```
 */
export function rateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt.getTime() / 1000)),
  }

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))
    headers['Retry-After'] = String(retryAfterSeconds)
  }

  return headers
}

/**
 * Generate a 429 Too Many Requests response with rate limit headers.
 *
 * @example
 * ```ts
 * if (!result.allowed) {
 *   return rateLimitResponse(result)
 * }
 * ```
 */
export function rateLimitResponse(result: RateLimitResult, message?: string): Response {
  const headers = rateLimitHeaders(result)
  const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))

  return new Response(
    JSON.stringify({
      error: message ?? 'Rate limit exceeded',
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    },
  )
}
