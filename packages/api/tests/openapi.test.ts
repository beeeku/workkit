import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { api } from '../src/define'
import { generateOpenAPI } from '../src/openapi'

describe('generateOpenAPI', () => {
  it('generates a valid OpenAPI 3.1 spec', () => {
    const spec = generateOpenAPI({
      title: 'Test API',
      version: '1.0.0',
      apis: [],
    })

    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info).toEqual({ title: 'Test API', version: '1.0.0' })
    expect(spec.paths).toEqual({})
  })

  it('includes description when provided', () => {
    const spec = generateOpenAPI({
      title: 'Test API',
      version: '1.0.0',
      description: 'A test API',
      apis: [],
    })

    expect((spec.info as any).description).toBe('A test API')
  })

  it('includes servers when provided', () => {
    const spec = generateOpenAPI({
      title: 'Test API',
      version: '1.0.0',
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
      apis: [],
    })

    expect(spec.servers).toEqual([
      { url: 'https://api.example.com', description: 'Production' },
    ])
  })

  it('generates paths for GET endpoints', () => {
    const getUsers = api({
      method: 'GET',
      path: '/users',
      response: z.object({ id: z.string(), name: z.string() }),
      handler: async () => ({ id: '1', name: 'Alice' }),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [getUsers],
    })

    const paths = spec.paths as any
    expect(paths['/users']).toBeDefined()
    expect(paths['/users'].get).toBeDefined()
    expect(paths['/users'].get.responses['200']).toBeDefined()
  })

  it('generates paths for POST endpoints with request body', () => {
    const createUser = api({
      method: 'POST',
      path: '/users',
      body: z.object({ name: z.string(), email: z.string() }),
      response: z.object({ id: z.string() }),
      handler: async () => ({ id: '1' }),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [createUser],
    })

    const paths = spec.paths as any
    expect(paths['/users'].post.requestBody).toBeDefined()
    expect(paths['/users'].post.requestBody.required).toBe(true)
    expect(paths['/users'].post.requestBody.content['application/json']).toBeDefined()
  })

  it('converts path parameters to OpenAPI format', () => {
    const getUser = api({
      method: 'GET',
      path: '/users/:id',
      params: z.object({ id: z.string() }),
      handler: async ({ params }) => ({ id: params.id }),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [getUser],
    })

    const paths = spec.paths as any
    expect(paths['/users/{id}']).toBeDefined()
    expect(paths['/users/{id}'].get.parameters).toBeDefined()

    const param = paths['/users/{id}'].get.parameters[0]
    expect(param.name).toBe('id')
    expect(param.in).toBe('path')
    expect(param.required).toBe(true)
  })

  it('generates query parameters', () => {
    const listUsers = api({
      method: 'GET',
      path: '/users',
      query: z.object({
        limit: z.string(),
        offset: z.string(),
      }),
      handler: async () => [],
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [listUsers],
    })

    const paths = spec.paths as any
    const params = paths['/users'].get.parameters
    expect(params).toBeDefined()
    expect(params.length).toBeGreaterThanOrEqual(2)

    const names = params.map((p: any) => p.name)
    expect(names).toContain('limit')
    expect(names).toContain('offset')
  })

  it('generates operation IDs', () => {
    const getUser = api({
      method: 'GET',
      path: '/users/:id',
      handler: async () => ({}),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [getUser],
    })

    const paths = spec.paths as any
    expect(paths['/users/{id}'].get.operationId).toBeDefined()
    expect(typeof paths['/users/{id}'].get.operationId).toBe('string')
  })

  it('generates 400 error response for validated endpoints', () => {
    const createUser = api({
      method: 'POST',
      path: '/users',
      body: z.object({ name: z.string() }),
      handler: async () => ({ id: '1' }),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [createUser],
    })

    const paths = spec.paths as any
    expect(paths['/users'].post.responses['400']).toBeDefined()
    expect(paths['/users'].post.responses['400'].description).toBe('Validation error')
  })

  it('generates 500 error response for all endpoints', () => {
    const getUsers = api({
      method: 'GET',
      path: '/users',
      handler: async () => [],
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [getUsers],
    })

    const paths = spec.paths as any
    expect(paths['/users'].get.responses['500']).toBeDefined()
  })

  it('handles multiple endpoints on the same path', () => {
    const getUsers = api({
      method: 'GET',
      path: '/users',
      handler: async () => [],
    })
    const createUser = api({
      method: 'POST',
      path: '/users',
      body: z.object({ name: z.string() }),
      handler: async () => ({ id: '1' }),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [getUsers, createUser],
    })

    const paths = spec.paths as any
    expect(paths['/users'].get).toBeDefined()
    expect(paths['/users'].post).toBeDefined()
  })

  it('generates JSON schemas from Zod types', () => {
    const createUser = api({
      method: 'POST',
      path: '/users',
      body: z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
      }),
      handler: async () => ({ id: '1' }),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [createUser],
    })

    const paths = spec.paths as any
    const schema = paths['/users'].post.requestBody.content['application/json'].schema
    expect(schema.type).toBe('object')
    expect(schema.properties.name.type).toBe('string')
    expect(schema.properties.age.type).toBe('number')
    expect(schema.properties.active.type).toBe('boolean')
  })

  it('marks required fields correctly', () => {
    const createUser = api({
      method: 'POST',
      path: '/users',
      body: z.object({
        name: z.string(),
        bio: z.string().optional(),
      }),
      handler: async () => ({ id: '1' }),
    })

    const spec = generateOpenAPI({
      title: 'Test',
      version: '1.0.0',
      apis: [createUser],
    })

    const paths = spec.paths as any
    const schema = paths['/users'].post.requestBody.content['application/json'].schema
    expect(schema.required).toContain('name')
    expect(schema.required).not.toContain('bio')
  })
})
