import { describe, it, expect, beforeEach } from 'vitest'
import { d1 } from '../src/client'
import { createMockD1, createFailingD1 } from './helpers/mock-d1'
import { D1QueryError, D1ConstraintError } from '../src/errors'
import { BindingNotFoundError } from '@workkit/errors'

type User = { id: number; name: string; email: string; active: boolean }

describe('d1()', () => {
  it('creates a typed D1 client from a D1Database', () => {
    const mock = createMockD1()
    const db = d1(mock)
    expect(db).toBeDefined()
    expect(typeof db.first).toBe('function')
    expect(typeof db.all).toBe('function')
    expect(typeof db.run).toBe('function')
    expect(typeof db.exec).toBe('function')
    expect(typeof db.prepare).toBe('function')
    expect(typeof db.batch).toBe('function')
    expect(typeof db.select).toBe('function')
    expect(typeof db.insert).toBe('function')
    expect(typeof db.update).toBe('function')
    expect(typeof db.delete).toBe('function')
  })

  it('exposes raw D1Database via .raw', () => {
    const mock = createMockD1()
    const db = d1(mock)
    expect(db.raw).toBe(mock)
  })

  it('throws BindingNotFoundError for null binding', () => {
    expect(() => d1(null as any)).toThrow(BindingNotFoundError)
  })

  it('throws BindingNotFoundError for undefined binding', () => {
    expect(() => d1(undefined as any)).toThrow(BindingNotFoundError)
  })

  it('accepts options with transformColumns', () => {
    const mock = createMockD1()
    const db = d1(mock, { transformColumns: 'camelCase' })
    expect(db).toBeDefined()
  })

  it('accepts a custom transform function', () => {
    const mock = createMockD1()
    const db = d1(mock, { transformColumns: (col: string) => col.toUpperCase() })
    expect(db).toBeDefined()
  })

  it('does not transform columns when option is undefined', async () => {
    const mock = createMockD1({
      users: [{ id: 1, first_name: 'Alice' }],
    })
    const db = d1(mock)
    const user = await db.first('SELECT * FROM users WHERE id = ?', [1])
    expect(user).toHaveProperty('first_name')
  })
})

describe('first()', () => {
  let db: ReturnType<typeof d1>

  beforeEach(() => {
    const mock = createMockD1({
      users: [
        { id: 1, name: 'Alice', email: 'alice@test.com', active: true },
        { id: 2, name: 'Bob', email: 'bob@test.com', active: false },
      ],
    })
    db = d1(mock)
  })

  it('returns first matching row typed as T', async () => {
    const user = await db.first<User>('SELECT * FROM users WHERE id = ?', [1])
    expect(user).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com', active: true })
  })

  it('returns null when no rows match', async () => {
    const user = await db.first<User>('SELECT * FROM users WHERE id = ?', [999])
    expect(user).toBeNull()
  })

  it('binds parameters correctly', async () => {
    const user = await db.first<User>('SELECT * FROM users WHERE name = ?', ['Bob'])
    expect(user?.name).toBe('Bob')
  })

  it('applies column transformation when configured', async () => {
    const mock = createMockD1({
      users: [{ id: 1, first_name: 'Alice', last_name: 'Smith' }],
    })
    const camelDb = d1(mock, { transformColumns: 'camelCase' })
    const user = await camelDb.first('SELECT * FROM users WHERE id = ?', [1])
    expect(user).toHaveProperty('firstName')
    expect(user).toHaveProperty('lastName')
  })

  it('wraps D1 errors as D1QueryError', async () => {
    const failDb = d1(createFailingD1('no such table: widgets'))
    await expect(
      failDb.first('SELECT * FROM widgets WHERE id = ?', [1]),
    ).rejects.toThrow(D1QueryError)
  })
})

describe('all()', () => {
  let db: ReturnType<typeof d1>

  beforeEach(() => {
    const mock = createMockD1({
      users: [
        { id: 1, name: 'Alice', email: 'alice@test.com', active: true },
        { id: 2, name: 'Bob', email: 'bob@test.com', active: true },
        { id: 3, name: 'Charlie', email: 'charlie@test.com', active: false },
      ],
    })
    db = d1(mock)
  })

  it('returns all matching rows typed as T[]', async () => {
    const users = await db.all<User>('SELECT * FROM users WHERE active = ?', [true])
    expect(users).toHaveLength(2)
    expect(users[0].name).toBe('Alice')
    expect(users[1].name).toBe('Bob')
  })

  it('returns empty array when no rows match', async () => {
    const users = await db.all<User>('SELECT * FROM users WHERE name = ?', ['Nobody'])
    expect(users).toEqual([])
  })

  it('binds parameters correctly', async () => {
    const users = await db.all<User>('SELECT * FROM users WHERE active = ?', [false])
    expect(users).toHaveLength(1)
    expect(users[0].name).toBe('Charlie')
  })

  it('applies column transformation', async () => {
    const mock = createMockD1({
      users: [
        { id: 1, first_name: 'Alice', is_active: true },
        { id: 2, first_name: 'Bob', is_active: true },
      ],
    })
    const camelDb = d1(mock, { transformColumns: 'camelCase' })
    const users = await camelDb.all('SELECT * FROM users')
    expect(users[0]).toHaveProperty('firstName')
    expect(users[0]).toHaveProperty('isActive')
  })
})

describe('run()', () => {
  let mock: D1Database
  let db: ReturnType<typeof d1>

  beforeEach(() => {
    mock = createMockD1({
      users: [
        { id: 1, name: 'Alice', email: 'alice@test.com' },
      ],
    })
    db = d1(mock)
  })

  it('executes INSERT and returns D1RunResult', async () => {
    const result = await db.run(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      ['Bob', 'bob@test.com'],
    )
    expect(result.success).toBe(true)
    expect(result.meta).toBeDefined()
    expect(result.meta.changes).toBe(1)
  })

  it('executes UPDATE and returns changes count', async () => {
    const result = await db.run(
      'UPDATE users SET name = ? WHERE id = ?',
      ['Updated', 1],
    )
    expect(result.success).toBe(true)
    expect(result.meta.changes).toBe(1)
  })

  it('executes DELETE and returns changes count', async () => {
    const result = await db.run('DELETE FROM users WHERE id = ?', [1])
    expect(result.success).toBe(true)
    expect(result.meta.changes).toBe(1)
  })

  it('wraps constraint violations as D1ConstraintError', async () => {
    const failDb = d1(createFailingD1('UNIQUE constraint failed: users.email'))
    await expect(
      failDb.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Dup', 'dup@test.com']),
    ).rejects.toThrow(D1ConstraintError)
  })
})

describe('exec()', () => {
  it('executes raw SQL (DDL)', async () => {
    const mock = createMockD1()
    const db = d1(mock)
    const result = await db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)')
    expect(result).toBeDefined()
    expect(result.count).toBeGreaterThanOrEqual(1)
  })

  it('returns execution stats', async () => {
    const mock = createMockD1()
    const db = d1(mock)
    const result = await db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)')
    expect(result).toHaveProperty('count')
    expect(result).toHaveProperty('duration')
  })
})
