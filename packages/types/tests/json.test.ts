import { describe, it, expectTypeOf } from 'vitest'
import type {
  JsonValue,
  JsonSerializable,
  DeepPartial,
  DeepReadonly,
  JsonPrimitive,
  JsonObject,
  JsonArray,
} from '../src/json'

describe('json types', () => {
  describe('JsonValue', () => {
    it('accepts primitives', () => {
      expectTypeOf<string>().toMatchTypeOf<JsonValue>()
      expectTypeOf<number>().toMatchTypeOf<JsonValue>()
      expectTypeOf<boolean>().toMatchTypeOf<JsonValue>()
      expectTypeOf<null>().toMatchTypeOf<JsonValue>()
    })

    it('accepts objects and arrays', () => {
      expectTypeOf<{ name: string; count: number }>().toMatchTypeOf<JsonValue>()
      expectTypeOf<number[]>().toMatchTypeOf<JsonValue>()
    })
  })

  describe('JsonSerializable', () => {
    it('accepts valid JSON types', () => {
      type Simple = { name: string; count: number }
      expectTypeOf<JsonSerializable<Simple>>().not.toBeNever()
    })

    it('rejects functions', () => {
      type WithFunc = { name: string; fn: () => void }
      expectTypeOf<JsonSerializable<WithFunc>>().toBeNever()
    })

    it('rejects undefined', () => {
      type WithUndef = { name: string; x: undefined }
      expectTypeOf<JsonSerializable<WithUndef>>().toBeNever()
    })
  })

  describe('DeepPartial', () => {
    it('makes nested keys optional', () => {
      type User = { name: string; address: { city: string; zip: string } }
      type PartialUser = DeepPartial<User>
      expectTypeOf<{}>().toMatchTypeOf<PartialUser>()
      expectTypeOf<{ name: string }>().toMatchTypeOf<PartialUser>()
      expectTypeOf<{ address: { city: string } }>().toMatchTypeOf<PartialUser>()
    })
  })

  describe('DeepReadonly', () => {
    it('makes all properties readonly', () => {
      type User = { name: string; tags: string[] }
      type ReadonlyUser = DeepReadonly<User>
      expectTypeOf<ReadonlyUser>().toMatchTypeOf<{
        readonly name: string
        readonly tags: readonly string[]
      }>()
    })
  })

  describe('JsonPrimitive / JsonObject / JsonArray', () => {
    it('JsonPrimitive covers all primitives', () => {
      expectTypeOf<string>().toMatchTypeOf<JsonPrimitive>()
      expectTypeOf<number>().toMatchTypeOf<JsonPrimitive>()
      expectTypeOf<boolean>().toMatchTypeOf<JsonPrimitive>()
      expectTypeOf<null>().toMatchTypeOf<JsonPrimitive>()
    })

    it('JsonObject is a string-keyed record', () => {
      expectTypeOf<{ foo: string }>().toMatchTypeOf<JsonObject>()
    })

    it('JsonArray is an array of JsonValue', () => {
      expectTypeOf<number[]>().toMatchTypeOf<JsonArray>()
    })
  })
})
