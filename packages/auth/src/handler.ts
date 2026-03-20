import { UnauthorizedError, ForbiddenError, errorToResponse } from '@workkit/errors'
import type { AuthHandlerConfig, AuthHandler } from './types'

/**
 * Create a framework-agnostic auth handler.
 *
 * Provides `.required()`, `.optional()`, and `.requireRole()` wrappers
 * for Cloudflare Worker fetch handlers.
 */
export function createAuthHandler<T>(config: AuthHandlerConfig<T>): AuthHandler<T> {
  const unauthorized = config.unauthorized ?? (() => errorToResponse(new UnauthorizedError()))
  const forbidden = config.forbidden ?? (() => errorToResponse(new ForbiddenError()))

  return {
    required(handler) {
      return async (request, env, ctx) => {
        const authCtx = await config.verify(request, env)
        if (authCtx === null) {
          return unauthorized()
        }
        return handler(request, env, ctx, authCtx)
      }
    },

    optional(handler) {
      return async (request, env, ctx) => {
        const authCtx = await config.verify(request, env)
        return handler(request, env, ctx, authCtx)
      }
    },

    requireRole(role, handler) {
      return async (request, env, ctx) => {
        const authCtx = await config.verify(request, env)
        if (authCtx === null) {
          return unauthorized()
        }

        // Check if the auth context has a role property
        const authObj = authCtx as Record<string, unknown>
        if (authObj.role !== role) {
          return forbidden()
        }

        return handler(request, env, ctx, authCtx)
      }
    },
  }
}
