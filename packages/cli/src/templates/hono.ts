import type { Feature } from '../commands/init'
import type { GeneratedFile } from '../commands/init'

/**
 * Generate source files for the "hono" template.
 * A Hono-based Worker with typed routes.
 */
export function generateHonoTemplate(_name: string, features: Feature[]): GeneratedFile[] {
  const imports = [`import { Hono } from 'hono'`]
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
    ? `\ninterface Env {\n  Bindings: {\n  ${envFields.join('\n  ')}\n  }\n}\n`
    : '\ninterface Env {\n  Bindings: {}\n}\n'

  const indexTs = `${imports.join('\n')}
${envType}
const app = new Hono<Env>()

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.get('/', (c) => {
  return c.text('Hello from workkit + Hono!')
})

export default app
`

  const testTs = `import { describe, it, expect } from 'vitest'

describe('Hono Worker', () => {
  it('has routes configured', async () => {
    // Add your tests here
    expect(true).toBe(true)
  })
})
`

  const pkgFiles: GeneratedFile[] = [
    { path: 'src/index.ts', content: indexTs },
    { path: 'tests/index.test.ts', content: testTs },
  ]

  return pkgFiles
}
