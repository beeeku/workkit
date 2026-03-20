import { describe, it, expectTypeOf } from 'vitest'
import type {
  BindingDef,
  BindingTypeCheck,
  EnvSchema,
  InferEnv,
  EnvParseSuccess,
  EnvParseFailure,
  EnvParseResult,
  EnvValidationError,
} from '../src/env'

describe('env types', () => {
  describe('EnvParseResult', () => {
    it('discriminates on success', () => {
      type Result = EnvParseResult<{ API_KEY: string }>
      const success: EnvParseSuccess<{ API_KEY: string }> = {
        success: true,
        env: { API_KEY: 'test' },
      }
      expectTypeOf(success).toMatchTypeOf<Result>()
    })

    it('failure has errors array', () => {
      const failure: EnvParseFailure = {
        success: false,
        errors: [
          {
            binding: 'API_KEY',
            message: 'missing',
            expected: 'string',
            received: 'undefined',
          },
        ],
      }
      expectTypeOf(failure.errors[0]!).toMatchTypeOf<EnvValidationError>()
    })
  })

  describe('BindingTypeCheck', () => {
    it('has required shape', () => {
      const check: BindingTypeCheck = {
        __bindingType: 'KVNamespace',
        validate: (value: unknown) => value != null,
      }
      expectTypeOf(check.__bindingType).toBeString()
      expectTypeOf(check.validate).toBeFunction()
    })
  })

  describe('EnvSchema', () => {
    it('is a record of binding definitions', () => {
      expectTypeOf<EnvSchema>().toMatchTypeOf<Record<string, BindingDef>>()
    })
  })
})
