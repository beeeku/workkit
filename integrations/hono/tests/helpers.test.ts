import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { workkit } from '../src/middleware'
import { getEnv } from '../src/helpers'
import type { WorkkitEnv } from '../src/types'

function string() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate(value: unknown) {
        if (typeof value === 'string') {
          return { value }
        }
        return { issues: [{ message: 'Expected string', path: [] }] }
      },
    },
  }
}

describe('getEnv()', () => {
  it('returns validated env from context', async () => {
    const schema = { API_KEY: string() }
    const app = new Hono<{ Bindings: { API_KEY: string } }>()

    app.use(workkit({ env: schema }))
    app.get('/', (c) => {
      const env = getEnv(c as any)
      return c.json({ key: env.API_KEY })
    })

    const res = await app.request('/', undefined, { API_KEY: 'my-key' })
    const body = await res.json()
    expect(body.key).toBe('my-key')
  })

  it('throws if workkit() middleware was not applied', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      const env = getEnv(c as any)
      return c.json(env)
    })

    const res = await app.request('/')
    // Without workkit middleware, getEnv throws, Hono catches and returns 500
    expect(res.status).toBe(500)
  })

  it('works with multiple env variables', async () => {
    const schema = {
      KEY_A: string(),
      KEY_B: string(),
      KEY_C: string(),
    }
    const app = new Hono<{ Bindings: { KEY_A: string; KEY_B: string; KEY_C: string } }>()

    app.use(workkit({ env: schema }))
    app.get('/', (c) => {
      const env = getEnv(c as any)
      return c.json({ a: env.KEY_A, b: env.KEY_B, c: env.KEY_C })
    })

    const res = await app.request('/', undefined, {
      KEY_A: 'alpha',
      KEY_B: 'bravo',
      KEY_C: 'charlie',
    })

    const body = await res.json()
    expect(body.a).toBe('alpha')
    expect(body.b).toBe('bravo')
    expect(body.c).toBe('charlie')
  })
})
