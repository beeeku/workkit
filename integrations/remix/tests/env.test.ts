import { describe, it, expect } from 'vitest'
import { createEnvFactory } from '../src/env'
import {
  createMockContext,
  createStringValidator,
  createNumberValidator,
} from './helpers'

describe('createEnvFactory', () => {
  it('should validate and return typed env', () => {
    const getEnv = createEnvFactory({
      API_KEY: createStringValidator({ min: 1 }),
    })

    const context = createMockContext({ API_KEY: 'test-key' })
    const env = getEnv(context)

    expect(env.API_KEY).toBe('test-key')
  })

  it('should validate multiple bindings', () => {
    const getEnv = createEnvFactory({
      API_KEY: createStringValidator(),
      PORT: createNumberValidator(),
    })

    const context = createMockContext({ API_KEY: 'key', PORT: 3000 })
    const env = getEnv(context)

    expect(env.API_KEY).toBe('key')
    expect(env.PORT).toBe(3000)
  })

  it('should throw on invalid env', () => {
    const getEnv = createEnvFactory({
      API_KEY: createStringValidator({ min: 1 }),
    })

    const context = createMockContext({ API_KEY: '' })
    expect(() => getEnv(context)).toThrow()
  })

  it('should throw on missing binding', () => {
    const getEnv = createEnvFactory({
      API_KEY: createStringValidator(),
    })

    const context = createMockContext({})
    expect(() => getEnv(context)).toThrow()
  })

  it('should cache result for same context object', () => {
    let validateCount = 0
    const countingValidator = {
      '~standard': {
        version: 1 as const,
        vendor: 'test' as const,
        validate: (value: unknown) => {
          validateCount++
          return { value }
        },
      },
    }

    const getEnv = createEnvFactory({ KEY: countingValidator })
    const context = createMockContext({ KEY: 'val' })

    getEnv(context)
    getEnv(context)
    getEnv(context)

    expect(validateCount).toBe(1)
  })

  it('should re-validate for different context objects', () => {
    let validateCount = 0
    const countingValidator = {
      '~standard': {
        version: 1 as const,
        vendor: 'test' as const,
        validate: (value: unknown) => {
          validateCount++
          return { value }
        },
      },
    }

    const getEnv = createEnvFactory({ KEY: countingValidator })

    const context1 = createMockContext({ KEY: 'val1' })
    const context2 = createMockContext({ KEY: 'val2' })

    getEnv(context1)
    getEnv(context2)

    expect(validateCount).toBe(2)
  })

  it('should not leak between different factory instances', () => {
    const getEnv1 = createEnvFactory({
      KEY_A: createStringValidator(),
    })

    const getEnv2 = createEnvFactory({
      KEY_B: createStringValidator(),
    })

    const context1 = createMockContext({ KEY_A: 'a' })
    const context2 = createMockContext({ KEY_B: 'b' })

    const env1 = getEnv1(context1)
    const env2 = getEnv2(context2)

    expect(env1).toHaveProperty('KEY_A', 'a')
    expect(env2).toHaveProperty('KEY_B', 'b')
  })

  it('should work with number constraints', () => {
    const getEnv = createEnvFactory({
      PORT: createNumberValidator({ min: 1, max: 65535 }),
    })

    const context = createMockContext({ PORT: 8080 })
    const env = getEnv(context)
    expect(env.PORT).toBe(8080)
  })

  it('should reject invalid number constraints', () => {
    const getEnv = createEnvFactory({
      PORT: createNumberValidator({ min: 1, max: 65535 }),
    })

    const context = createMockContext({ PORT: 0 })
    expect(() => getEnv(context)).toThrow()
  })
})
