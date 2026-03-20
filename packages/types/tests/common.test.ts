import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  assertNever,
  type MaybePromise,
  type Prettify,
  type RequireKeys,
  type OptionalKeys,
  type PrefixedKey,
  type NonEmptyArray,
  type Dict,
  type ReadonlyDict,
  type KeysMatching,
  type StringWithPrefix,
} from '../src/common'

describe('common', () => {
  describe('assertNever', () => {
    it('throws on any value', () => {
      expect(() => assertNever('unexpected' as never)).toThrow('Unexpected value: unexpected')
    })

    it('works in exhaustive switch patterns', () => {
      type Status = 'active' | 'inactive'
      const check = (status: Status): string => {
        switch (status) {
          case 'active':
            return 'yes'
          case 'inactive':
            return 'no'
          default:
            return assertNever(status)
        }
      }
      expect(check('active')).toBe('yes')
      expect(check('inactive')).toBe('no')
    })
  })

  describe('type-level tests', () => {
    it('MaybePromise accepts sync and async values', () => {
      expectTypeOf(42).toMatchTypeOf<MaybePromise<number>>()
      expectTypeOf(Promise.resolve(42)).toMatchTypeOf<MaybePromise<number>>()
    })

    it('Prettify flattens intersections', () => {
      type A = { a: string }
      type B = { b: number }
      type AB = Prettify<A & B>
      expectTypeOf<AB>().toEqualTypeOf<{ a: string; b: number }>()
    })

    it('RequireKeys makes specific keys required', () => {
      type Base = { a?: string; b?: number; c: boolean }
      type WithRequired = RequireKeys<Base, 'a' | 'b'>
      expectTypeOf<WithRequired>().toMatchTypeOf<{ a: string; b: number; c: boolean }>()
    })

    it('OptionalKeys makes specific keys optional', () => {
      type Base = { a: string; b: number; c: boolean }
      type WithOptional = OptionalKeys<Base, 'a' | 'b'>
      expectTypeOf<WithOptional>().toMatchTypeOf<{ a?: string; b?: number; c: boolean }>()
    })

    it('PrefixedKey enforces string prefix', () => {
      const userKey: PrefixedKey<'user:'> = 'user:123'
      expectTypeOf(userKey).toMatchTypeOf<StringWithPrefix<'user:'>>()
      // @ts-expect-error — missing prefix
      const _badKey: PrefixedKey<'user:'> = 'order:456'
    })

    it('NonEmptyArray requires at least one element', () => {
      const good: NonEmptyArray<number> = [1]
      expectTypeOf(good).toMatchTypeOf<NonEmptyArray<number>>()
      // @ts-expect-error — empty array
      const _bad: NonEmptyArray<number> = []
    })

    it('Dict and ReadonlyDict are string-keyed records', () => {
      const dict: Dict<number> = { a: 1, b: 2 }
      expectTypeOf(dict).toMatchTypeOf<Record<string, number>>()

      const roDict: ReadonlyDict<number> = { a: 1 }
      expectTypeOf(roDict).toMatchTypeOf<Readonly<Record<string, number>>>()
    })

    it('KeysMatching extracts keys by value type', () => {
      type Obj = { name: string; age: number; active: boolean; count: number }
      type NumberKeys = KeysMatching<Obj, number>
      expectTypeOf<NumberKeys>().toEqualTypeOf<'age' | 'count'>()
    })
  })
})
