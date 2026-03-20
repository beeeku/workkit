import { describe, it, expect, beforeEach } from 'vitest'
import { migrate, migrationStatus } from '../src/migrate'
import { createMockD1 } from './helpers/mock-d1'
import { D1MigrationError } from '../src/errors'

describe('migrate', () => {
  let db: D1Database

  beforeEach(() => {
    db = createMockD1()
  })

  it('creates migration tracking table if not exists', async () => {
    const result = await migrate(db, [])
    expect(result.applied).toBe(0)
    expect(result.pending).toBe(0)
  })

  it('applies pending migrations in order', async () => {
    const migrations = [
      { name: '001_create_users', sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)' },
      { name: '002_create_posts', sql: 'CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT)' },
    ]

    const result = await migrate(db, migrations)
    expect(result.applied).toBe(2)
    expect(result.migrations).toHaveLength(2)
    expect(result.migrations[0].name).toBe('001_create_users')
    expect(result.migrations[0].success).toBe(true)
    expect(result.migrations[1].name).toBe('002_create_posts')
    expect(result.migrations[1].success).toBe(true)
  })

  it('skips already-applied migrations', async () => {
    const migrations = [
      { name: '001_create_users', sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)' },
      { name: '002_create_posts', sql: 'CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY)' },
    ]

    // Apply first time
    await migrate(db, migrations)

    // Apply again with a new migration
    const migrations2 = [
      ...migrations,
      { name: '003_create_comments', sql: 'CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY)' },
    ]

    const result = await migrate(db, migrations2)
    expect(result.applied).toBe(1)
    expect(result.migrations).toHaveLength(1)
    expect(result.migrations[0].name).toBe('003_create_comments')
  })

  it('records applied migrations in tracking table', async () => {
    const migrations = [
      { name: '001_create_users', sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)' },
    ]

    await migrate(db, migrations)

    // Check status shows it as applied
    const status = await migrationStatus(db, migrations)
    expect(status.applied).toContain('001_create_users')
  })

  it('returns applied count and pending count', async () => {
    const migrations = [
      { name: '001_create_users', sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)' },
    ]

    const result = await migrate(db, migrations)
    expect(result.applied).toBe(1)
    expect(result.pending).toBe(0)
  })

  it('throws D1MigrationError on failure', async () => {
    // Use a mock that fails on specific SQL
    const migrations = [
      { name: '001_bad_sql', sql: 'THIS IS NOT VALID SQL' },
    ]

    // The createMockD1 won't throw on unknown SQL, so let's simulate a failure
    // by using a custom mock that throws on exec for bad SQL
    const failOnExec = createMockD1()
    const originalExec = failOnExec.exec.bind(failOnExec)
    ;(failOnExec as any).exec = async (sql: string) => {
      if (sql.includes('NOT VALID')) {
        throw new Error('near "THIS": syntax error')
      }
      return originalExec(sql)
    }

    await expect(migrate(failOnExec, migrations)).rejects.toThrow(D1MigrationError)
  })

  it('uses custom table name when provided', async () => {
    const migrations = [
      { name: '001_create_users', sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)' },
    ]

    await migrate(db, migrations, { tableName: 'custom_migrations' })

    // Check with custom table name
    const status = await migrationStatus(db, migrations, { tableName: 'custom_migrations' })
    expect(status.applied).toContain('001_create_users')
  })

  it('returns empty result when no pending migrations', async () => {
    const result = await migrate(db, [])
    expect(result.applied).toBe(0)
    expect(result.pending).toBe(0)
    expect(result.migrations).toEqual([])
  })
})

describe('migrationStatus', () => {
  let db: D1Database

  beforeEach(() => {
    db = createMockD1()
  })

  it('returns applied and pending migration names', async () => {
    const migrations = [
      { name: '001_create_users', sql: 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)' },
      { name: '002_create_posts', sql: 'CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY)' },
    ]

    // Apply first migration only
    await migrate(db, [migrations[0]])

    // Check status with all migrations
    const status = await migrationStatus(db, migrations)
    expect(status.applied).toEqual(['001_create_users'])
    expect(status.pending).toEqual(['002_create_posts'])
    expect(status.total).toBe(2)
  })

  it('handles missing tracking table (all pending)', async () => {
    const migrations = [
      { name: '001_create_users', sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY)' },
    ]

    const status = await migrationStatus(db, migrations)
    expect(status.applied).toEqual([])
    expect(status.pending).toEqual(['001_create_users'])
    expect(status.total).toBe(1)
  })

  it('returns total count', async () => {
    const migrations = [
      { name: '001_a', sql: 'SELECT 1' },
      { name: '002_b', sql: 'SELECT 1' },
      { name: '003_c', sql: 'SELECT 1' },
    ]

    const status = await migrationStatus(db, migrations)
    expect(status.total).toBe(3)
  })

  it('uses custom table name for status', async () => {
    const migrations = [
      { name: '001_test', sql: 'CREATE TABLE IF NOT EXISTS t1 (id INTEGER PRIMARY KEY)' },
    ]
    await migrate(db, migrations, { tableName: 'my_migrations' })
    const status = await migrationStatus(db, migrations, { tableName: 'my_migrations' })
    expect(status.applied).toContain('001_test')
  })
})

describe('validateTableName (SQL injection prevention)', () => {
  let db: D1Database

  beforeEach(() => {
    db = createMockD1()
  })

  it('rejects table names with SQL injection attempts', async () => {
    await expect(
      migrate(db, [], { tableName: 'migrations; DROP TABLE users; --' }),
    ).rejects.toThrow(/Invalid migration table name/)
  })

  it('rejects table names with spaces', async () => {
    await expect(
      migrate(db, [], { tableName: 'my table' }),
    ).rejects.toThrow(/Invalid migration table name/)
  })

  it('rejects table names starting with numbers', async () => {
    await expect(
      migrate(db, [], { tableName: '123migrations' }),
    ).rejects.toThrow(/Invalid migration table name/)
  })

  it('rejects table names with special characters', async () => {
    await expect(
      migrate(db, [], { tableName: 'my-migrations' }),
    ).rejects.toThrow(/Invalid migration table name/)
  })

  it('accepts valid table names with underscores', async () => {
    const result = await migrate(db, [], { tableName: '_my_migrations_v2' })
    expect(result.applied).toBe(0)
  })

  it('accepts standard alphanumeric table names', async () => {
    const result = await migrate(db, [], { tableName: 'migrations' })
    expect(result.applied).toBe(0)
  })
})
