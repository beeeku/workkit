import { describe, it, expect } from 'vitest'
import { WorkkitError } from '@workkit/errors'
import {
  D1Error,
  D1QueryError,
  D1ConstraintError,
  D1BatchError,
  D1MigrationError,
  classifyD1Error,
} from '../src/errors'

describe('D1Error', () => {
  it('extends WorkkitError', () => {
    const err = new D1Error('test error')
    expect(err).toBeInstanceOf(WorkkitError)
    expect(err).toBeInstanceOf(Error)
  })

  it('has correct code and statusCode', () => {
    const err = new D1Error('test error')
    expect(err.code).toBe('WORKKIT_D1_QUERY')
    expect(err.statusCode).toBe(500)
    expect(err.retryable).toBe(false)
    expect(err.retryStrategy).toEqual({ kind: 'none' })
  })

  it('preserves message', () => {
    const err = new D1Error('something broke')
    expect(err.message).toBe('something broke')
  })

  it('accepts WorkkitErrorOptions', () => {
    const cause = new Error('root cause')
    const err = new D1Error('test', { cause, context: { table: 'users' } })
    expect(err.cause).toBe(cause)
    expect(err.context).toEqual({ table: 'users' })
  })
})

describe('D1QueryError', () => {
  it('includes SQL and params in context', () => {
    const err = new D1QueryError('syntax error', 'SELECT * FROM', [1, 2])
    expect(err.sql).toBe('SELECT * FROM')
    expect(err.params).toEqual([1, 2])
    expect(err.context).toEqual({ sql: 'SELECT * FROM', params: [1, 2] })
  })

  it('formats message with query info', () => {
    const err = new D1QueryError('near "FROM": syntax error', 'SELECT FROM')
    expect(err.message).toContain('D1 query failed')
    expect(err.message).toContain('near "FROM": syntax error')
  })

  it('has correct code and statusCode', () => {
    const err = new D1QueryError('test', 'SELECT 1')
    expect(err.code).toBe('WORKKIT_D1_QUERY')
    expect(err.statusCode).toBe(500)
    expect(err.retryable).toBe(false)
  })
})

describe('D1ConstraintError', () => {
  it('parses UNIQUE constraint from message', () => {
    const err = new D1ConstraintError('UNIQUE constraint failed: users.email', 'UNIQUE constraint failed')
    expect(err.constraintType).toBe('UNIQUE')
  })

  it('parses CHECK constraint', () => {
    const err = new D1ConstraintError('CHECK constraint failed', 'CHECK constraint failed')
    expect(err.constraintType).toBe('CHECK')
  })

  it('parses FOREIGN KEY constraint', () => {
    const err = new D1ConstraintError('FOREIGN KEY constraint failed', 'FOREIGN KEY constraint failed')
    expect(err.constraintType).toBe('FOREIGN_KEY')
  })

  it('parses NOT NULL constraint', () => {
    const err = new D1ConstraintError('NOT NULL constraint failed: users.name', 'NOT NULL constraint failed')
    expect(err.constraintType).toBe('NOT_NULL')
  })

  it('defaults to UNKNOWN for unrecognized', () => {
    const err = new D1ConstraintError('some constraint violation', 'weird thing')
    expect(err.constraintType).toBe('UNKNOWN')
  })

  it('is retryable', () => {
    const err = new D1ConstraintError('UNIQUE constraint failed', 'UNIQUE')
    expect(err.retryable).toBe(true)
    expect(err.retryStrategy.kind).toBe('exponential')
  })

  it('has statusCode 409', () => {
    const err = new D1ConstraintError('test', 'UNIQUE')
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('WORKKIT_D1_CONSTRAINT')
  })
})

describe('D1BatchError', () => {
  it('has correct code and statusCode', () => {
    const err = new D1BatchError('batch failed')
    expect(err.code).toBe('WORKKIT_D1_BATCH')
    expect(err.statusCode).toBe(500)
    expect(err.retryable).toBe(false)
  })

  it('includes failedIndex', () => {
    const err = new D1BatchError('statement 2 failed', 2)
    expect(err.failedIndex).toBe(2)
    expect(err.message).toContain('D1 batch failed')
  })

  it('failedIndex is optional', () => {
    const err = new D1BatchError('unknown failure')
    expect(err.failedIndex).toBeUndefined()
  })
})

describe('D1MigrationError', () => {
  it('includes migration name', () => {
    const err = new D1MigrationError('001_create_users', 'syntax error in SQL')
    expect(err.migrationName).toBe('001_create_users')
    expect(err.message).toContain('001_create_users')
    expect(err.message).toContain('syntax error in SQL')
  })

  it('has correct code and statusCode', () => {
    const err = new D1MigrationError('test', 'failed')
    expect(err.code).toBe('WORKKIT_D1_MIGRATION')
    expect(err.statusCode).toBe(500)
    expect(err.retryable).toBe(false)
  })
})

describe('classifyD1Error', () => {
  it('returns D1ConstraintError for UNIQUE constraint violations', () => {
    const err = classifyD1Error(new Error('UNIQUE constraint failed: users.email'))
    expect(err).toBeInstanceOf(D1ConstraintError)
    expect((err as D1ConstraintError).constraintType).toBe('UNIQUE')
  })

  it('returns D1ConstraintError for CHECK constraint violations', () => {
    const err = classifyD1Error(new Error('CHECK constraint failed: age_positive'))
    expect(err).toBeInstanceOf(D1ConstraintError)
  })

  it('returns D1ConstraintError for FOREIGN KEY constraint violations', () => {
    const err = classifyD1Error(new Error('FOREIGN KEY constraint failed'))
    expect(err).toBeInstanceOf(D1ConstraintError)
    expect((err as D1ConstraintError).constraintType).toBe('FOREIGN_KEY')
  })

  it('returns D1ConstraintError for NOT NULL constraint violations', () => {
    const err = classifyD1Error(new Error('NOT NULL constraint failed: users.name'))
    expect(err).toBeInstanceOf(D1ConstraintError)
    expect((err as D1ConstraintError).constraintType).toBe('NOT_NULL')
  })

  it('returns D1QueryError for missing table', () => {
    const err = classifyD1Error(new Error('no such table: widgets'), 'SELECT * FROM widgets')
    expect(err).toBeInstanceOf(D1QueryError)
    expect((err as D1QueryError).sql).toBe('SELECT * FROM widgets')
  })

  it('returns D1QueryError for missing column', () => {
    const err = classifyD1Error(new Error('no such column: foo'), 'SELECT foo FROM users')
    expect(err).toBeInstanceOf(D1QueryError)
  })

  it('returns D1QueryError for syntax errors', () => {
    const err = classifyD1Error(new Error('near "FROM": syntax error'), 'SELECT FROM')
    expect(err).toBeInstanceOf(D1QueryError)
  })

  it('returns D1Error for unknown errors', () => {
    const err = classifyD1Error(new Error('something went wrong'))
    expect(err).toBeInstanceOf(D1Error)
  })

  it('handles non-Error inputs', () => {
    const err = classifyD1Error('string error message')
    expect(err).toBeInstanceOf(D1Error)
  })

  it('passes sql and params to D1QueryError', () => {
    const err = classifyD1Error(
      new Error('no such table: widgets'),
      'SELECT * FROM widgets WHERE id = ?',
      [42],
    )
    expect(err).toBeInstanceOf(D1QueryError)
    expect((err as D1QueryError).sql).toBe('SELECT * FROM widgets WHERE id = ?')
    expect((err as D1QueryError).params).toEqual([42])
  })
})
