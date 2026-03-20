import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validate, validateSync, tryValidate, isStandardSchema } from '../src/validation'
import { ValidationError } from '@workkit/errors'

describe('validate', () => {
  it('validates a valid value', async () => {
    const schema = z.object({ name: z.string() })
    const result = await validate(schema, { name: 'Alice' })
    expect(result).toEqual({ name: 'Alice' })
  })

  it('throws ValidationError on invalid value', async () => {
    const schema = z.object({ name: z.string() })
    await expect(validate(schema, { name: 42 })).rejects.toThrow(ValidationError)
  })

  it('includes label in error message', async () => {
    const schema = z.object({ name: z.string() })
    try {
      await validate(schema, { name: 42 }, 'request body')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).message).toBe('Invalid request body')
    }
  })

  it('includes issues in the error', async () => {
    const schema = z.object({ name: z.string(), age: z.number() })
    try {
      await validate(schema, { name: 42, age: 'old' }, 'input')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      const ve = err as ValidationError
      expect(ve.issues.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('validates primitive types', async () => {
    const schema = z.string()
    const result = await validate(schema, 'hello')
    expect(result).toBe('hello')
  })

  it('validates arrays', async () => {
    const schema = z.array(z.number())
    const result = await validate(schema, [1, 2, 3])
    expect(result).toEqual([1, 2, 3])
  })

  it('transforms values', async () => {
    const schema = z.string().transform((s) => s.toUpperCase())
    const result = await validate(schema, 'hello')
    expect(result).toBe('HELLO')
  })

  it('uses default label when not provided', async () => {
    const schema = z.string()
    try {
      await validate(schema, 42)
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).message).toBe('Invalid value')
    }
  })
})

describe('validateSync', () => {
  it('validates synchronously with zod', () => {
    const schema = z.object({ id: z.string() })
    const result = validateSync(schema, { id: '123' })
    expect(result).toEqual({ id: '123' })
  })

  it('throws ValidationError on invalid sync value', () => {
    const schema = z.string()
    expect(() => validateSync(schema, 42)).toThrow(ValidationError)
  })
})

describe('tryValidate', () => {
  it('returns success for valid value', async () => {
    const schema = z.object({ name: z.string() })
    const result = await tryValidate(schema, { name: 'Alice' })
    expect(result).toEqual({ success: true, value: { name: 'Alice' } })
  })

  it('returns failure for invalid value', async () => {
    const schema = z.object({ name: z.string() })
    const result = await tryValidate(schema, { name: 42 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0)
    }
  })

  it('does not throw on invalid value', async () => {
    const schema = z.string()
    const result = await tryValidate(schema, 42)
    expect(result.success).toBe(false)
  })
})

describe('isStandardSchema', () => {
  it('returns true for zod schemas', () => {
    expect(isStandardSchema(z.string())).toBe(true)
  })

  it('returns false for plain objects', () => {
    expect(isStandardSchema({ type: 'string' })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isStandardSchema(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isStandardSchema(undefined)).toBe(false)
  })

  it('returns false for strings', () => {
    expect(isStandardSchema('hello')).toBe(false)
  })

  it('returns false for numbers', () => {
    expect(isStandardSchema(42)).toBe(false)
  })
})
