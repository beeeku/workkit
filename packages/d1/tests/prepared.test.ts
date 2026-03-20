import { describe, it, expect, beforeEach } from 'vitest'
import { createTypedPreparedStatement } from '../src/prepared'
import { createMockD1 } from './helpers/mock-d1'

type User = { id: number; name: string; email: string }

describe('TypedPreparedStatement', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createMockD1({
      users: [
        { id: 1, name: 'Alice', email: 'alice@test.com' },
        { id: 2, name: 'Bob', email: 'bob@test.com' },
        { id: 3, name: 'Charlie', email: 'charlie@test.com' },
      ],
    })
  })

  it('creates a reusable prepared statement', () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users WHERE id = ?')
    expect(stmt).toBeDefined()
    expect(stmt.sql).toBe('SELECT * FROM users WHERE id = ?')
  })

  it('exposes sql property', () => {
    const stmt = createTypedPreparedStatement(db, 'SELECT * FROM users')
    expect(stmt.sql).toBe('SELECT * FROM users')
  })

  it('first() binds params and returns typed result', async () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users WHERE id = ?')
    const user = await stmt.first([1])
    expect(user).toEqual({ id: 1, name: 'Alice', email: 'alice@test.com' })
  })

  it('first() returns null when no match', async () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users WHERE id = ?')
    const user = await stmt.first([999])
    expect(user).toBeNull()
  })

  it('all() binds params and returns typed results', async () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users WHERE name = ?')
    const users = await stmt.all(['Alice'])
    expect(users).toHaveLength(1)
    expect(users[0].name).toBe('Alice')
  })

  it('all() returns empty array when no match', async () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users WHERE name = ?')
    const users = await stmt.all(['Nobody'])
    expect(users).toEqual([])
  })

  it('run() binds params and returns D1RunResult', async () => {
    const stmt = createTypedPreparedStatement(db, 'INSERT INTO users (name, email) VALUES (?, ?)')
    const result = await stmt.run(['Dave', 'dave@test.com'])
    expect(result.success).toBe(true)
    expect(result.meta).toBeDefined()
    expect(result.meta.changes).toBe(1)
  })

  it('bind() returns BoundStatement for batch', () => {
    const stmt = createTypedPreparedStatement(db, 'INSERT INTO users (name, email) VALUES (?, ?)')
    const bound = stmt.bind(['Eve', 'eve@test.com'])
    expect(bound).toBeDefined()
    expect(bound.statement).toBeDefined()
  })

  it('can be reused with different params', async () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users WHERE id = ?')

    const alice = await stmt.first([1])
    expect(alice?.name).toBe('Alice')

    const bob = await stmt.first([2])
    expect(bob?.name).toBe('Bob')

    const charlie = await stmt.first([3])
    expect(charlie?.name).toBe('Charlie')
  })

  it('first() works without params', async () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users')
    const user = await stmt.first()
    expect(user).toBeDefined()
    expect(user?.id).toBe(1)
  })

  it('all() works without params', async () => {
    const stmt = createTypedPreparedStatement<User>(db, 'SELECT * FROM users')
    const users = await stmt.all()
    expect(users).toHaveLength(3)
  })

  it('applies column transformer when provided', async () => {
    const transform = (col: string) => col.toUpperCase()
    const stmt = createTypedPreparedStatement<any>(
      db,
      'SELECT * FROM users WHERE id = ?',
      undefined,
      transform,
    )
    const user = await stmt.first([1])
    expect(user).toHaveProperty('ID')
    expect(user).toHaveProperty('NAME')
    expect(user).toHaveProperty('EMAIL')
  })
})
