import { describe, it, expect } from 'vitest'
import { buildCacheUrl } from '../src/cache'

describe('buildCacheUrl', () => {
  const baseUrl = 'https://cache.local'

  it('should prepend baseUrl to relative path with leading slash', () => {
    expect(buildCacheUrl('/api/users', baseUrl)).toBe('https://cache.local/api/users')
  })

  it('should prepend baseUrl to relative path without leading slash', () => {
    expect(buildCacheUrl('api/users', baseUrl)).toBe('https://cache.local/api/users')
  })

  it('should pass through full https URLs unchanged', () => {
    expect(buildCacheUrl('https://example.com/data', baseUrl)).toBe('https://example.com/data')
  })

  it('should pass through full http URLs unchanged', () => {
    expect(buildCacheUrl('http://example.com/data', baseUrl)).toBe('http://example.com/data')
  })

  it('should handle root path', () => {
    expect(buildCacheUrl('/', baseUrl)).toBe('https://cache.local/')
  })

  it('should handle empty key', () => {
    expect(buildCacheUrl('', baseUrl)).toBe('https://cache.local/')
  })

  it('should use custom baseUrl', () => {
    expect(buildCacheUrl('/test', 'https://my-app.workers.dev')).toBe('https://my-app.workers.dev/test')
  })

  it('should handle keys with query strings', () => {
    expect(buildCacheUrl('/api/users?page=1', baseUrl)).toBe('https://cache.local/api/users?page=1')
  })

  it('should handle keys with hash fragments', () => {
    expect(buildCacheUrl('/api/data#section', baseUrl)).toBe('https://cache.local/api/data#section')
  })

  it('should handle deep paths', () => {
    expect(buildCacheUrl('/api/v2/users/123/posts', baseUrl)).toBe('https://cache.local/api/v2/users/123/posts')
  })
})
