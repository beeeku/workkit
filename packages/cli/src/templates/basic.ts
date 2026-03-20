import type { Feature } from '../commands/init'
import type { GeneratedFile } from '../commands/init'

/**
 * Generate source files for the "basic" template.
 * A minimal Worker with fetch handler.
 */
export function generateBasicTemplate(_name: string, features: Feature[]): GeneratedFile[] {
  const imports: string[] = []
  const envFields: string[] = []

  if (features.includes('env')) {
    imports.push(`import { createEnv } from '@workkit/env'`)
  }

  if (features.includes('d1')) {
    envFields.push('  DB: D1Database')
  }
  if (features.includes('kv')) {
    envFields.push('  KV: KVNamespace')
  }
  if (features.includes('r2')) {
    envFields.push('  BUCKET: R2Bucket')
  }

  const envType = envFields.length > 0
    ? `\ninterface Env {\n${envFields.join('\n')}\n}\n`
    : '\ninterface Env {}\n'

  const envSetup = features.includes('env')
    ? `\nconst env = createEnv<Env>(rawEnv)\n`
    : ''

  const handlerParam = features.includes('env') ? 'rawEnv' : '_env'

  const indexTs = `${imports.join('\n')}${imports.length > 0 ? '\n' : ''}${envType}
export default {
  async fetch(request: Request, ${handlerParam}: Env): Promise<Response> {${envSetup}
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    return new Response('Hello from workkit!', {
      headers: { 'content-type': 'text/plain' },
    })
  },
} satisfies ExportedHandler<Env>
`

  const testTs = `import { describe, it, expect } from 'vitest'

describe('Worker', () => {
  it('responds with hello message', async () => {
    // Add your tests here
    expect(true).toBe(true)
  })
})
`

  return [
    { path: 'src/index.ts', content: indexTs },
    { path: 'tests/index.test.ts', content: testTs },
  ]
}
