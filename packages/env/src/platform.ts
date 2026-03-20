/**
 * Detected runtime platform.
 */
export type Platform = 'workers' | 'node' | 'bun' | 'deno' | 'unknown'

/**
 * Detects the current runtime platform.
 */
export function detectPlatform(): Platform {
  // Workers: no process global, has global caches API
  if (
    typeof globalThis.process === 'undefined' &&
    typeof (globalThis as Record<string, unknown>).caches !== 'undefined'
  ) {
    return 'workers'
  }
  // Bun
  if (typeof (globalThis as Record<string, unknown>).Bun !== 'undefined') return 'bun'
  // Deno
  if (typeof (globalThis as Record<string, unknown>).Deno !== 'undefined') return 'deno'
  // Node
  if (typeof globalThis.process?.versions?.node !== 'undefined') return 'node'
  return 'unknown'
}

/**
 * Resolves raw environment from the platform.
 * On Workers, env is passed per-request — this function throws to enforce explicit passing.
 * On Node/Bun/Deno, it returns the global env object.
 */
export function resolveEnv(
  explicitEnv?: Record<string, unknown>,
): Record<string, unknown> {
  if (explicitEnv) return explicitEnv

  const platform = detectPlatform()
  switch (platform) {
    case 'node':
    case 'bun':
      return process.env as Record<string, unknown>
    case 'deno':
      return (globalThis as Record<string, Record<string, () => Record<string, unknown>>>).Deno.env.toObject()
    case 'workers':
      throw new Error(
        '@workkit/env: On Cloudflare Workers, you must pass the env object explicitly. ' +
          'It is available as the second argument to your fetch handler.',
      )
    default:
      return {}
  }
}
