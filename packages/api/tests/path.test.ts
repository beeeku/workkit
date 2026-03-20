import { describe, it, expect } from 'vitest'
import { parsePath, matchPath, buildPath, toOpenAPIPath, parseQuery } from '../src/path'

describe('parsePath', () => {
  it('parses a static path', () => {
    const result = parsePath('/users')
    expect(result.segments).toEqual(['users'])
    expect(result.params).toEqual([])
    expect(result.pattern).toBe('/users')
  })

  it('parses a path with one parameter', () => {
    const result = parsePath('/users/:id')
    expect(result.segments).toEqual(['users', ':id'])
    expect(result.params).toEqual(['id'])
  })

  it('parses a path with multiple parameters', () => {
    const result = parsePath('/users/:id/posts/:postId')
    expect(result.segments).toEqual(['users', ':id', 'posts', ':postId'])
    expect(result.params).toEqual(['id', 'postId'])
  })

  it('parses a root path', () => {
    const result = parsePath('/')
    expect(result.segments).toEqual([])
    expect(result.params).toEqual([])
  })

  it('handles paths without leading slash', () => {
    const result = parsePath('users/:id')
    expect(result.segments).toEqual(['users', ':id'])
    expect(result.params).toEqual(['id'])
  })

  it('parses deeply nested paths', () => {
    const result = parsePath('/api/v1/users/:userId/posts/:postId/comments/:commentId')
    expect(result.params).toEqual(['userId', 'postId', 'commentId'])
    expect(result.segments).toHaveLength(8)
  })

  it('parses path with no params', () => {
    const result = parsePath('/api/health')
    expect(result.segments).toEqual(['api', 'health'])
    expect(result.params).toEqual([])
  })
})

describe('matchPath', () => {
  it('matches a static path', () => {
    const result = matchPath('/users', '/users')
    expect(result).toEqual({ matched: true, params: {} })
  })

  it('matches a path with parameters', () => {
    const result = matchPath('/users/:id', '/users/123')
    expect(result).toEqual({ matched: true, params: { id: '123' } })
  })

  it('matches a path with multiple parameters', () => {
    const result = matchPath('/users/:id/posts/:postId', '/users/123/posts/456')
    expect(result).toEqual({ matched: true, params: { id: '123', postId: '456' } })
  })

  it('does not match different paths', () => {
    const result = matchPath('/users/:id', '/posts/123')
    expect(result).toEqual({ matched: false })
  })

  it('does not match paths with different segment counts', () => {
    const result = matchPath('/users/:id', '/users/123/extra')
    expect(result).toEqual({ matched: false })
  })

  it('does not match shorter paths', () => {
    const result = matchPath('/users/:id/posts', '/users/123')
    expect(result).toEqual({ matched: false })
  })

  it('matches root path', () => {
    const result = matchPath('/', '/')
    expect(result).toEqual({ matched: true, params: {} })
  })

  it('decodes URI-encoded parameters', () => {
    const result = matchPath('/users/:name', '/users/John%20Doe')
    expect(result).toEqual({ matched: true, params: { name: 'John Doe' } })
  })

  it('matches wildcard paths', () => {
    const result = matchPath('/files/*', '/files/images/logo.png')
    expect(result).toEqual({
      matched: true,
      params: { '*': 'images/logo.png' },
    })
  })

  it('matches wildcard at root', () => {
    const result = matchPath('/api/:version/*', '/api/v1/users/123')
    expect(result).toEqual({
      matched: true,
      params: { version: 'v1', '*': 'users/123' },
    })
  })

  it('matches wildcard with empty remainder', () => {
    const result = matchPath('/files/*', '/files/')
    expect(result).toEqual({ matched: true, params: { '*': '' } })
  })

  it('does not match wildcard when prefix differs', () => {
    const result = matchPath('/files/*', '/images/logo.png')
    expect(result).toEqual({ matched: false })
  })
})

describe('buildPath', () => {
  it('builds a path with parameters', () => {
    const result = buildPath('/users/:id', { id: '123' })
    expect(result).toBe('/users/123')
  })

  it('builds a path with multiple parameters', () => {
    const result = buildPath('/users/:id/posts/:postId', { id: '123', postId: '456' })
    expect(result).toBe('/users/123/posts/456')
  })

  it('builds a static path', () => {
    const result = buildPath('/users', {})
    expect(result).toBe('/users')
  })

  it('encodes parameter values', () => {
    const result = buildPath('/users/:name', { name: 'John Doe' })
    expect(result).toBe('/users/John%20Doe')
  })

  it('throws on missing parameter', () => {
    expect(() => buildPath('/users/:id', {})).toThrow('Missing path parameter: id')
  })
})

describe('toOpenAPIPath', () => {
  it('converts parameter syntax', () => {
    expect(toOpenAPIPath('/users/:id')).toBe('/users/{id}')
  })

  it('converts multiple parameters', () => {
    expect(toOpenAPIPath('/users/:id/posts/:postId')).toBe('/users/{id}/posts/{postId}')
  })

  it('leaves static paths unchanged', () => {
    expect(toOpenAPIPath('/users')).toBe('/users')
  })
})

describe('parseQuery', () => {
  it('parses query parameters', () => {
    expect(parseQuery('http://example.com?foo=bar&baz=qux')).toEqual({
      foo: 'bar',
      baz: 'qux',
    })
  })

  it('returns empty for no query', () => {
    expect(parseQuery('http://example.com')).toEqual({})
  })

  it('handles encoded values', () => {
    expect(parseQuery('http://example.com?name=John%20Doe')).toEqual({
      name: 'John Doe',
    })
  })

  it('handles empty values', () => {
    expect(parseQuery('http://example.com?flag')).toEqual({ flag: '' })
  })

  it('handles multiple params with same structure', () => {
    expect(parseQuery('?a=1&b=2&c=3')).toEqual({ a: '1', b: '2', c: '3' })
  })
})
