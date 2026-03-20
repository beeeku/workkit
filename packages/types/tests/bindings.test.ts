import { describe, it, expectTypeOf } from 'vitest'
import type {
  TypedKVNamespace,
  TypedD1Result,
  TypedR2Object,
  TypedQueue,
  TypedMessage,
  TypedMessageBatch,
  TypedDurableObjectStorage,
  D1Meta,
  QueueContentType,
} from '../src/bindings'

type User = { name: string; email: string }
type CustomMeta = { author: string; version: string }

describe('bindings types', () => {
  describe('TypedKVNamespace', () => {
    it('get returns typed value or null', () => {
      type GetReturn = ReturnType<TypedKVNamespace<User>['get']>
      expectTypeOf<GetReturn>().toEqualTypeOf<Promise<User | null>>()
    })

    it('put accepts typed value', () => {
      type PutParams = Parameters<TypedKVNamespace<User>['put']>
      expectTypeOf<PutParams[1]>().toEqualTypeOf<User>()
    })

    it('has raw KVNamespace escape hatch', () => {
      expectTypeOf<TypedKVNamespace<User>['raw']>().toEqualTypeOf<KVNamespace>()
    })
  })

  describe('TypedD1Result', () => {
    it('results is typed array', () => {
      expectTypeOf<TypedD1Result<User>['results']>().toEqualTypeOf<User[]>()
    })

    it('has meta information', () => {
      expectTypeOf<TypedD1Result<User>['meta']>().toEqualTypeOf<D1Meta>()
    })
  })

  describe('TypedR2Object', () => {
    it('customMetadata uses generic type', () => {
      expectTypeOf<TypedR2Object<CustomMeta>['customMetadata']>().toEqualTypeOf<CustomMeta>()
    })

    it('has standard R2 fields', () => {
      expectTypeOf<TypedR2Object['key']>().toBeString()
      expectTypeOf<TypedR2Object['size']>().toBeNumber()
      expectTypeOf<TypedR2Object['etag']>().toBeString()
    })
  })

  describe('TypedQueue', () => {
    it('send accepts typed body', () => {
      type SendParams = Parameters<TypedQueue<User>['send']>
      expectTypeOf<SendParams[0]>().toEqualTypeOf<User>()
    })
  })

  describe('TypedMessage', () => {
    it('body is typed', () => {
      expectTypeOf<TypedMessage<User>['body']>().toEqualTypeOf<User>()
    })

    it('has message metadata', () => {
      expectTypeOf<TypedMessage<User>['id']>().toBeString()
      expectTypeOf<TypedMessage<User>['attempts']>().toBeNumber()
    })
  })

  describe('TypedMessageBatch', () => {
    it('messages array contains typed messages', () => {
      type Msgs = TypedMessageBatch<User>['messages']
      expectTypeOf<Msgs>().toMatchTypeOf<readonly TypedMessage<User>[]>()
    })
  })

  describe('TypedDurableObjectStorage', () => {
    it('get returns generic type', () => {
      // The single-key overload returns T | undefined
      type Storage = TypedDurableObjectStorage
      expectTypeOf<Storage['get']>().toBeFunction()
    })

    it('has alarm methods', () => {
      type Storage = TypedDurableObjectStorage
      expectTypeOf<Storage['getAlarm']>().toBeFunction()
      expectTypeOf<Storage['setAlarm']>().toBeFunction()
      expectTypeOf<Storage['deleteAlarm']>().toBeFunction()
    })
  })

  describe('QueueContentType', () => {
    it('covers expected values', () => {
      expectTypeOf<'text'>().toMatchTypeOf<QueueContentType>()
      expectTypeOf<'json'>().toMatchTypeOf<QueueContentType>()
      expectTypeOf<'bytes'>().toMatchTypeOf<QueueContentType>()
      expectTypeOf<'v8'>().toMatchTypeOf<QueueContentType>()
    })
  })
})
