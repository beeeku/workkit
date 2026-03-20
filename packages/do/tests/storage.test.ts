import { describe, it, expect, vi } from 'vitest'
import { expectTypeOf } from 'expect-type'
import { typedStorage } from '../src/storage'
import { createMockStorage } from './helpers'

describe('typedStorage', () => {
	interface TestSchema {
		count: number
		name: string
		active: boolean
		tags: string[]
		nested: { x: number; y: number }
	}

	it('should wrap a storage instance', () => {
		const raw = createMockStorage()
		const storage = typedStorage<TestSchema>(raw)
		expect(storage).toBeDefined()
	})

	describe('get', () => {
		it('should return undefined for missing keys', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.get('count')
			expect(result).toBeUndefined()
		})

		it('should return the value for existing keys', async () => {
			const raw = createMockStorage()
			raw._data.set('count', 42)
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.get('count')
			expect(result).toBe(42)
		})

		it('should return typed values', async () => {
			const raw = createMockStorage()
			raw._data.set('name', 'hello')
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.get('name')
			expectTypeOf(result).toEqualTypeOf<string | undefined>()
			expect(result).toBe('hello')
		})

		it('should return complex types', async () => {
			const raw = createMockStorage()
			const tags = ['a', 'b', 'c']
			raw._data.set('tags', tags)
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.get('tags')
			expect(result).toEqual(['a', 'b', 'c'])
		})

		it('should return nested objects', async () => {
			const raw = createMockStorage()
			raw._data.set('nested', { x: 1, y: 2 })
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.get('nested')
			expect(result).toEqual({ x: 1, y: 2 })
		})
	})

	describe('put', () => {
		it('should store a value', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			await storage.put('count', 42)
			expect(raw._data.get('count')).toBe(42)
		})

		it('should store string values', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			await storage.put('name', 'hello')
			expect(raw._data.get('name')).toBe('hello')
		})

		it('should store boolean values', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			await storage.put('active', true)
			expect(raw._data.get('active')).toBe(true)
		})

		it('should store array values', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			await storage.put('tags', ['x', 'y'])
			expect(raw._data.get('tags')).toEqual(['x', 'y'])
		})

		it('should store nested objects', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			await storage.put('nested', { x: 10, y: 20 })
			expect(raw._data.get('nested')).toEqual({ x: 10, y: 20 })
		})

		it('should overwrite existing values', async () => {
			const raw = createMockStorage()
			raw._data.set('count', 1)
			const storage = typedStorage<TestSchema>(raw)
			await storage.put('count', 99)
			expect(raw._data.get('count')).toBe(99)
		})
	})

	describe('delete', () => {
		it('should return true when key exists', async () => {
			const raw = createMockStorage()
			raw._data.set('count', 42)
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.delete('count')
			expect(result).toBe(true)
		})

		it('should return false when key does not exist', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.delete('count')
			expect(result).toBe(false)
		})

		it('should remove the value from storage', async () => {
			const raw = createMockStorage()
			raw._data.set('name', 'hello')
			const storage = typedStorage<TestSchema>(raw)
			await storage.delete('name')
			expect(raw._data.has('name')).toBe(false)
		})
	})

	describe('list', () => {
		it('should return all stored entries', async () => {
			const raw = createMockStorage()
			raw._data.set('count', 42)
			raw._data.set('name', 'test')
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.list()
			expect(result.size).toBe(2)
			expect(result.get('count')).toBe(42)
			expect(result.get('name')).toBe('test')
		})

		it('should return empty map when storage is empty', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.list()
			expect(result.size).toBe(0)
		})
	})

	describe('transaction', () => {
		it('should execute a transaction callback', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			const result = await storage.transaction(async (txn) => {
				await txn.put('count', 10)
				return 'done'
			})
			expect(result).toBe('done')
			expect(raw._data.get('count')).toBe(10)
		})

		it('should provide a typed storage in the transaction', async () => {
			const raw = createMockStorage()
			const storage = typedStorage<TestSchema>(raw)
			await storage.transaction(async (txn) => {
				await txn.put('name', 'txn-test')
				const val = await txn.get('name')
				expect(val).toBe('txn-test')
			})
		})

		it('should rollback on error', async () => {
			const raw = createMockStorage()
			raw._data.set('count', 5)
			const storage = typedStorage<TestSchema>(raw)
			await expect(
				storage.transaction(async (txn) => {
					await txn.put('count', 999)
					throw new Error('rollback')
				}),
			).rejects.toThrow('rollback')
			// After rollback, original value should be restored
			expect(raw._data.get('count')).toBe(5)
		})
	})
})
