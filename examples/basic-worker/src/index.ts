/**
 * Basic Worker — Minimal fetch handler with @workkit/env validation
 *
 * Demonstrates how workkit validates environment bindings at startup,
 * giving you typed, guaranteed-present bindings instead of raw `env.X`
 * that might be undefined at runtime.
 */
import { parseEnv } from '@workkit/env'
import { kv as kvValidator } from '@workkit/env/validators'
import { kv } from '@workkit/kv'
import { z } from 'zod'

// ─── Environment Schema ───────────────────────────────────────────────────────
// Define what bindings your worker needs. Validation runs once on first request.
// If a binding is missing or the wrong type, you get a clear error — not a
// runtime "Cannot read property 'get' of undefined" buried in a handler.

const envSchema = {
  // Standard Schema validators (Zod, Valibot, ArkType — anything that implements Standard Schema)
  API_KEY: z.string().min(1),
  ENVIRONMENT: z.enum(['development', 'staging', 'production']),

  // Workkit binding validators — duck-type checks for Cloudflare bindings
  CACHE: kvValidator(),
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
    // Validate all env bindings at once. Collects ALL issues before throwing,
    // so you don't play whack-a-mole with one missing binding at a time.
    const env = await parseEnv(rawEnv, envSchema)

    // `env` is now fully typed:
    //   env.API_KEY      → string (guaranteed non-empty)
    //   env.ENVIRONMENT  → 'development' | 'staging' | 'production'
    //   env.CACHE        → KVNamespace (guaranteed to have get/put/delete/list)

    const url = new URL(request.url)

    if (url.pathname === '/') {
      return Response.json({
        message: 'Hello from workkit!',
        environment: env.ENVIRONMENT,
      })
    }

    if (url.pathname === '/cache-demo') {
      // ─── BEFORE (raw Cloudflare API) ──────────────────────────────
      // const value = await env.CACHE.get('visits')
      // const visits = value ? parseInt(value, 10) : 0
      // await env.CACHE.put('visits', String(visits + 1))
      //
      // Problems:
      //   - env.CACHE might be undefined (wrangler.toml misconfigured)
      //   - get() returns string | null, manual parsing needed
      //   - put() takes only string, must serialize manually
      //   - No key validation, no prefix namespacing

      // ─── AFTER (with workkit) ─────────────────────────────────────
      const cache = kv<number>(env.CACHE, { prefix: 'app:' })
      const visits = (await cache.get('visits')) ?? 0
      await cache.put('visits', visits + 1, { ttl: 86400 })

      return Response.json({ visits: visits + 1 })
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  },
}
