import { describe, it, expect } from 'vitest'
import {
  extractRoutes,
  routeToFnName,
  generateClientCode,
  executeGenClient,
} from '../src/commands/gen-client'
import { createMockFs } from './helpers'

describe('gen client command', () => {
  describe('extractRoutes', () => {
    it('extracts Hono-style routes', () => {
      const source = `
        app.get('/health', handler)
        app.post('/users', createUser)
        app.delete('/users/:id', deleteUser)
      `
      const routes = extractRoutes(source, 'index.ts')
      expect(routes).toHaveLength(3)
      expect(routes[0]!.method).toBe('GET')
      expect(routes[0]!.path).toBe('/health')
      expect(routes[1]!.method).toBe('POST')
      expect(routes[2]!.method).toBe('DELETE')
    })

    it('extracts workkit router-style routes', () => {
      const source = `
        const routes = [
          { method: 'GET', pattern: '/health', handler: healthHandler },
          { method: 'POST', pattern: '/items', handler: createItem },
        ]
      `
      const routes = extractRoutes(source, 'index.ts')
      expect(routes).toHaveLength(2)
      expect(routes[0]!.method).toBe('GET')
      expect(routes[0]!.path).toBe('/health')
    })

    it('returns empty for source without routes', () => {
      expect(extractRoutes('const x = 1;', 'file.ts')).toHaveLength(0)
    })

    it('handles mixed route styles', () => {
      const source = `
        app.get('/a', h)
        const r = [{ method: 'POST', pattern: '/b', handler: h }]
      `
      const routes = extractRoutes(source, 'file.ts')
      expect(routes).toHaveLength(2)
    })
  })

  describe('routeToFnName', () => {
    it('converts GET /health to getHealth', () => {
      expect(routeToFnName('GET', '/health')).toBe('getHealth')
    })

    it('converts POST /users to createUsers', () => {
      expect(routeToFnName('POST', '/users')).toBe('createUsers')
    })

    it('converts PUT /users to updateUsers', () => {
      expect(routeToFnName('PUT', '/users')).toBe('updateUsers')
    })

    it('converts DELETE /users to removeUsers', () => {
      expect(routeToFnName('DELETE', '/users')).toBe('removeUsers')
    })

    it('handles root path', () => {
      expect(routeToFnName('GET', '/')).toBe('getRoot')
    })

    it('skips path parameters', () => {
      const name = routeToFnName('GET', '/users/:id')
      expect(name).toBe('getUsers')
    })
  })

  describe('generateClientCode', () => {
    it('generates client with route methods', () => {
      const routes = [
        { method: 'GET', path: '/health', name: 'getHealth' },
        { method: 'POST', path: '/users', name: 'createUsers' },
      ]
      const code = generateClientCode(routes)
      expect(code).toContain('getHealth')
      expect(code).toContain('createUsers')
      expect(code).toContain('createClient')
      expect(code).toContain('ClientOptions')
    })

    it('adds body parameter for POST/PUT/PATCH', () => {
      const routes = [
        { method: 'POST', path: '/items', name: 'createItems' },
      ]
      const code = generateClientCode(routes)
      expect(code).toContain('body?: unknown')
    })

    it('omits body parameter for GET/DELETE', () => {
      const routes = [
        { method: 'GET', path: '/items', name: 'getItems' },
      ]
      const code = generateClientCode(routes)
      expect(code).toContain('getItems(): Promise<Response>')
    })

    it('includes auto-generated header comment', () => {
      const code = generateClientCode([])
      expect(code).toContain('Auto-generated')
    })
  })

  describe('executeGenClient', () => {
    it('generates client from source files', async () => {
      const fs = createMockFs({
        '/src/api/routes.ts': `app.get('/health', h)\napp.post('/users', h)`,
      })
      const code = await executeGenClient(
        { sourceDir: '/src/api', output: '/out/client.ts' },
        fs,
      )
      expect(code).toContain('getHealth')
      expect(fs.files.has('/out/client.ts')).toBe(true)
    })

    it('throws for missing source directory', async () => {
      const fs = createMockFs()
      await expect(
        executeGenClient({ sourceDir: '/missing', output: '/out.ts' }, fs),
      ).rejects.toThrow('not found')
    })

    it('throws when no routes found', async () => {
      const fs = createMockFs({
        '/src/api/empty.ts': 'const x = 1;',
      })
      await expect(
        executeGenClient({ sourceDir: '/src/api', output: '/out.ts' }, fs),
      ).rejects.toThrow('No route definitions')
    })

    it('skips test files', async () => {
      const fs = createMockFs({
        '/src/api/routes.ts': `app.get('/a', h)`,
        '/src/api/routes.test.ts': `app.get('/test-only', h)`,
      })
      const code = await executeGenClient(
        { sourceDir: '/src/api', output: '/out.ts' },
        fs,
      )
      expect(code).not.toContain('testOnly')
    })
  })
})
