import { describe, it, expect, beforeEach } from 'vitest'
import { kv } from '../src/kv'
import { createMockKV } from './helpers/mock-kv'

type Item = { data: string }

describe('list()', () => {
  let mock: ReturnType<typeof createMockKV>
  let store: ReturnType<typeof kv<Item>>

  beforeEach(() => {
    mock = createMockKV()
    store = kv<Item>(mock, { prefix: 'item:' })
  })

  it('yields all entries when result fits in one page', async () => {
    await store.put('a', { data: '1' })
    await store.put('b', { data: '2' })
    await store.put('c', { data: '3' })

    const entries = []
    for await (const entry of store.list()) {
      entries.push(entry)
    }
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.name).sort()).toEqual(['a', 'b', 'c'])
  })

  it('strips namespace prefix from yielded key names', async () => {
    await store.put('abc', { data: 'test' })

    const entries = []
    for await (const entry of store.list()) {
      entries.push(entry)
    }
    expect(entries[0].name).toBe('abc')
    // Should NOT be "item:abc"
    expect(entries[0].name).not.toContain('item:')
  })

  it('yields entries with metadata', async () => {
    await store.put('123', { data: 'test' }, { metadata: { tag: 'important' } })

    const entries = []
    for await (const entry of store.list<{ tag: string }>()) {
      entries.push(entry)
    }
    expect(entries[0].metadata?.tag).toBe('important')
  })

  it('handles empty result set', async () => {
    const entries = []
    for await (const entry of store.list()) {
      entries.push(entry)
    }
    expect(entries).toHaveLength(0)
  })

  it('appends list prefix to namespace prefix for CF query', async () => {
    await store.put('active:1', { data: 'a' })
    await store.put('active:2', { data: 'b' })
    await store.put('inactive:1', { data: 'c' })

    const entries = []
    for await (const entry of store.list({ prefix: 'active:' })) {
      entries.push(entry)
    }
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.name).sort()).toEqual(['active:1', 'active:2'])
  })
})

describe('listKeys()', () => {
  it('returns all entries as an array', async () => {
    const mock = createMockKV()
    const store = kv<Item>(mock, { prefix: 'item:' })

    await store.put('x', { data: '1' })
    await store.put('y', { data: '2' })

    const keys = await store.listKeys()
    expect(keys).toHaveLength(2)
    expect(keys.map((e) => e.name).sort()).toEqual(['x', 'y'])
  })
})
