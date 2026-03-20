import { describe, it, expect, vi } from 'vitest'
import { workkitMiddleware } from '../src/middleware'
import {
  createMockContext,
  createMockContextWithoutRuntime,
  stringValidator,
  numberValidator,
} from './helpers'

describe('workkitMiddleware', () => {
  describe('env validation on request', () => {
    it('calls next() when env is valid', async () => {
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
      })
      const context = createMockContext({ env: { API_KEY: 'valid-key' } })
      const next = vi.fn().mockResolvedValue(new Response('ok'))

      await middleware(context, next)

      expect(next).toHaveBeenCalledOnce()
    })

    it('validates all schema fields', async () => {
      const middleware = workkitMiddleware({
        env: {
          API_KEY: stringValidator(),
          PORT: numberValidator(),
        },
      })
      const context = createMockContext({
        env: { API_KEY: 'key', PORT: '3000' },
      })
      const next = vi.fn().mockResolvedValue(new Response('ok'))

      await middleware(context, next)

      expect(next).toHaveBeenCalledOnce()
    })

    it('returns 500 when env validation fails (no onError)', async () => {
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
      })
      const context = createMockContext({ env: {} })
      const next = vi.fn()

      const response = await middleware(context, next)

      expect(next).not.toHaveBeenCalled()
      expect(response).toBeInstanceOf(Response)
      expect(response!.status).toBe(500)
    })

    it('default error response contains descriptive text', async () => {
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
      })
      const context = createMockContext({ env: {} })
      const next = vi.fn()

      const response = await middleware(context, next)
      const text = await response!.text()

      expect(text).toContain('Environment configuration invalid')
    })

    it('default error response has text/plain content type', async () => {
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
      })
      const context = createMockContext({ env: {} })
      const next = vi.fn()

      const response = await middleware(context, next)

      expect(response!.headers.get('Content-Type')).toBe('text/plain')
    })
  })

  describe('error handling', () => {
    it('calls onError when env validation fails', async () => {
      const onError = vi.fn().mockReturnValue(
        new Response('Custom error', { status: 503 }),
      )
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
        onError,
      })
      const context = createMockContext({ env: {} })
      const next = vi.fn()

      const response = await middleware(context, next)

      expect(onError).toHaveBeenCalledOnce()
      expect(response!.status).toBe(503)
    })

    it('passes the error object to onError', async () => {
      const onError = vi.fn().mockReturnValue(new Response('err'))
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
        onError,
      })
      const context = createMockContext({ env: {} })
      const next = vi.fn()

      await middleware(context, next)

      const [error] = onError.mock.calls[0]
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('validation failed')
    })

    it('passes the context to onError', async () => {
      const onError = vi.fn().mockReturnValue(new Response('err'))
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
        onError,
      })
      const context = createMockContext({ env: {} })
      const next = vi.fn()

      await middleware(context, next)

      const [, ctx] = onError.mock.calls[0]
      expect(ctx).toBe(context)
    })

    it('handles async onError', async () => {
      const onError = vi.fn().mockResolvedValue(
        new Response('Async error', { status: 422 }),
      )
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
        onError,
      })
      const context = createMockContext({ env: {} })
      const next = vi.fn()

      const response = await middleware(context, next)

      expect(response!.status).toBe(422)
    })

    it('returns 500 when Cloudflare runtime is missing (no onError)', async () => {
      const middleware = workkitMiddleware({
        env: { API_KEY: stringValidator() },
      })
      const context = createMockContextWithoutRuntime()
      const next = vi.fn()

      const response = await middleware(context, next)

      expect(next).not.toHaveBeenCalled()
      expect(response!.status).toBe(500)
    })
  })

  describe('caching behavior', () => {
    it('only validates once across multiple requests', async () => {
      let validateCount = 0
      const trackingValidator = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate(value: unknown) {
            validateCount++
            if (typeof value !== 'string') {
              return { issues: [{ message: 'Expected string' }] }
            }
            return { value }
          },
        },
      }

      const middleware = workkitMiddleware({
        env: { KEY: trackingValidator },
      })

      const context1 = createMockContext({ env: { KEY: 'val' } })
      const context2 = createMockContext({ env: { KEY: 'val2' } })
      const next = vi.fn().mockResolvedValue(new Response('ok'))

      await middleware(context1, next)
      await middleware(context2, next)

      expect(validateCount).toBe(1) // validated only on first request
      expect(next).toHaveBeenCalledTimes(2) // both requests go through
    })

    it('does not cache failed validation (retries on next request)', async () => {
      let callCount = 0
      const flakyValidator = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate(value: unknown) {
            callCount++
            if (callCount === 1) {
              return { issues: [{ message: 'Transient failure' }] }
            }
            return { value: value as string }
          },
        },
      }

      const middleware = workkitMiddleware({
        env: { KEY: flakyValidator },
      })

      const next = vi.fn().mockResolvedValue(new Response('ok'))

      // First request fails validation
      const context1 = createMockContext({ env: { KEY: 'val' } })
      const response1 = await middleware(context1, next)
      expect(response1!.status).toBe(500)

      // Second request retries and succeeds
      const context2 = createMockContext({ env: { KEY: 'val' } })
      await middleware(context2, next)
      expect(next).toHaveBeenCalledOnce()
    })
  })
})
