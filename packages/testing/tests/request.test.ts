import { describe, it, expect } from 'vitest'
import { createRequest } from '../src/request'

describe('createRequest', () => {
  it('creates a GET request by default', () => {
    const req = createRequest('/api/users')
    expect(req.method).toBe('GET')
    expect(req.url).toBe('http://localhost/api/users')
  })

  it('creates a POST request', () => {
    const req = createRequest('/api/users', { method: 'POST' })
    expect(req.method).toBe('POST')
  })

  it('creates PUT, PATCH, DELETE requests', () => {
    expect(createRequest('/x', { method: 'PUT' }).method).toBe('PUT')
    expect(createRequest('/x', { method: 'PATCH' }).method).toBe('PATCH')
    expect(createRequest('/x', { method: 'DELETE' }).method).toBe('DELETE')
  })

  it('auto-serializes object body to JSON', async () => {
    const req = createRequest('/api/users', {
      method: 'POST',
      body: { name: 'test', age: 25 },
    })
    expect(req.headers.get('Content-Type')).toBe('application/json')
    const body = await req.json()
    expect(body).toEqual({ name: 'test', age: 25 })
  })

  it('passes string body as-is', async () => {
    const req = createRequest('/api/data', {
      method: 'POST',
      body: 'raw text',
    })
    const text = await req.text()
    expect(text).toBe('raw text')
  })

  it('includes custom headers', () => {
    const req = createRequest('/api', {
      headers: { 'Authorization': 'Bearer xxx', 'X-Custom': 'value' },
    })
    expect(req.headers.get('Authorization')).toBe('Bearer xxx')
    expect(req.headers.get('X-Custom')).toBe('value')
  })

  it('merges auto Content-Type with custom headers', () => {
    const req = createRequest('/api', {
      method: 'POST',
      body: { a: 1 },
      headers: { 'X-Custom': 'test' },
    })
    expect(req.headers.get('Content-Type')).toBe('application/json')
    expect(req.headers.get('X-Custom')).toBe('test')
  })

  it('does not override explicit Content-Type', () => {
    const req = createRequest('/api', {
      method: 'POST',
      body: { a: 1 },
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(req.headers.get('Content-Type')).toBe('text/plain')
  })

  it('uses http://localhost as default base', () => {
    const req = createRequest('/test')
    expect(new URL(req.url).origin).toBe('http://localhost')
  })

  it('handles paths without leading slash', () => {
    const req = createRequest('api/users')
    expect(req.url).toBe('http://localhost/api/users')
  })

  it('handles full URLs', () => {
    const req = createRequest('https://example.com/api')
    expect(req.url).toBe('https://example.com/api')
  })

  it('supports query parameters in path', () => {
    const req = createRequest('/api/users?page=1&limit=10')
    expect(req.url).toBe('http://localhost/api/users?page=1&limit=10')
  })
})
