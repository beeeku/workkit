import { describe, it, expect } from 'vitest'
import { generateApiTemplate } from '../src/templates/api'
import { generateBasicTemplate } from '../src/templates/basic'
import { generateHonoTemplate } from '../src/templates/hono'
import type { Feature } from '../src/commands/init'

describe('generateBasicTemplate', () => {
  it('generates index and test files', () => {
    const files = generateBasicTemplate('my-worker', [])
    const paths = files.map((f) => f.path)
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('tests/index.test.ts')
  })

  it('includes env import when env feature is present', () => {
    const files = generateBasicTemplate('my-worker', ['env'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('createEnv')
  })

  it('does not include env import when env feature is absent', () => {
    const files = generateBasicTemplate('my-worker', [])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).not.toContain('createEnv')
  })

  it('adds D1 binding to env interface', () => {
    const files = generateBasicTemplate('test', ['d1'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('DB: D1Database')
  })

  it('adds KV binding to env interface', () => {
    const files = generateBasicTemplate('test', ['kv'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('KV: KVNamespace')
  })

  it('adds R2 binding to env interface', () => {
    const files = generateBasicTemplate('test', ['r2'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('BUCKET: R2Bucket')
  })

  it('generates empty env interface with no features', () => {
    const files = generateBasicTemplate('test', [])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('interface Env {}')
  })

  it('combines all features', () => {
    const features: Feature[] = ['env', 'd1', 'kv', 'r2']
    const files = generateBasicTemplate('test', features)
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('createEnv')
    expect(indexFile.content).toContain('DB: D1Database')
    expect(indexFile.content).toContain('KV: KVNamespace')
    expect(indexFile.content).toContain('BUCKET: R2Bucket')
  })

  it('uses rawEnv param name when env feature is present', () => {
    const files = generateBasicTemplate('test', ['env'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('rawEnv')
    expect(indexFile.content).toContain('createEnv')
  })

  it('uses _env param name when env feature is absent', () => {
    const files = generateBasicTemplate('test', [])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('_env')
  })
})

describe('generateApiTemplate', () => {
  it('generates router, handlers, index, and test files', () => {
    const files = generateApiTemplate('my-api', [])
    const paths = files.map((f) => f.path)
    expect(paths).toContain('src/router.ts')
    expect(paths).toContain('src/handlers.ts')
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('tests/api.test.ts')
  })

  it('includes project name in handler response', () => {
    const files = generateApiTemplate('cool-api', [])
    const handlers = files.find((f) => f.path === 'src/handlers.ts')!
    expect(handlers.content).toContain('cool-api')
  })

  it('adds env import and validation when env feature is present', () => {
    const files = generateApiTemplate('test', ['env'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('createEnv')
    expect(indexFile.content).toContain('rawEnv')
  })

  it('adds D1 binding to router env type', () => {
    const files = generateApiTemplate('test', ['d1'])
    const router = files.find((f) => f.path === 'src/router.ts')!
    expect(router.content).toContain('DB: D1Database')
  })

  it('generates router with createRouter and Route types', () => {
    const files = generateApiTemplate('test', [])
    const router = files.find((f) => f.path === 'src/router.ts')!
    expect(router.content).toContain('createRouter')
    expect(router.content).toContain('interface Route')
  })

  it('generates test file with router tests', () => {
    const files = generateApiTemplate('test', [])
    const test = files.find((f) => f.path === 'tests/api.test.ts')!
    expect(test.content).toContain('routes to matching handler')
    expect(test.content).toContain('returns 404 for unmatched routes')
  })

  it('generates empty env interface with no binding features', () => {
    const files = generateApiTemplate('test', [])
    const router = files.find((f) => f.path === 'src/router.ts')!
    expect(router.content).toContain('export interface Env {}')
  })
})

describe('generateHonoTemplate', () => {
  it('generates index and test files', () => {
    const files = generateHonoTemplate('my-hono', [])
    const paths = files.map((f) => f.path)
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('tests/index.test.ts')
  })

  it('imports Hono', () => {
    const files = generateHonoTemplate('test', [])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain("import { Hono } from 'hono'")
  })

  it('adds env import when env feature is present', () => {
    const files = generateHonoTemplate('test', ['env'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('createEnv')
  })

  it('adds bindings to Hono env type', () => {
    const files = generateHonoTemplate('test', ['d1', 'kv', 'r2'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('DB: D1Database')
    expect(indexFile.content).toContain('KV: KVNamespace')
    expect(indexFile.content).toContain('BUCKET: R2Bucket')
  })

  it('uses Hono Bindings pattern for env type', () => {
    const files = generateHonoTemplate('test', ['d1'])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('Bindings:')
  })

  it('generates empty bindings with no features', () => {
    const files = generateHonoTemplate('test', [])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('Bindings: {}')
  })

  it('exports app as default', () => {
    const files = generateHonoTemplate('test', [])
    const indexFile = files.find((f) => f.path === 'src/index.ts')!
    expect(indexFile.content).toContain('export default app')
  })
})
