import { describe, it, expect } from 'vitest'
import { createAction } from '../src/action'
import { ValidationError } from '@workkit/errors'
import {
  createMockActionArgs,
  createStringValidator,
  createObjectValidator,
  createEmailValidator,
} from './helpers'

describe('createAction', () => {
  describe('without body validation', () => {
    it('should call handler and return JSON response', async () => {
      const action = createAction({
        handler: async ({ params }) => {
          return { deleted: params.id }
        },
      })

      const args = createMockActionArgs({ params: { id: '42' } })
      const response = await action(args)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ deleted: '42' })
    })

    it('should pass raw env without env validation', async () => {
      const action = createAction({
        handler: async ({ env }) => {
          return { key: env.SECRET }
        },
      })

      const args = createMockActionArgs({ env: { SECRET: 'abc' } })
      const response = await action(args)
      expect(await response.json()).toEqual({ key: 'abc' })
    })

    it('should pass through Response objects', async () => {
      const action = createAction({
        handler: async () => {
          return new Response(null, { status: 204 })
        },
      })

      const args = createMockActionArgs()
      const response = await action(args)
      expect(response.status).toBe(204)
    })
  })

  describe('with body validation', () => {
    it('should parse and validate JSON body', async () => {
      const bodySchema = createObjectValidator({
        name: createStringValidator({ min: 1 }),
        email: createEmailValidator(),
      })

      const action = createAction({
        body: bodySchema,
        handler: async ({ body }) => {
          return { received: body }
        },
      })

      const args = createMockActionArgs({
        body: { name: 'Alice', email: 'alice@test.com' },
      })
      const response = await action(args)
      expect(await response.json()).toEqual({
        received: { name: 'Alice', email: 'alice@test.com' },
      })
    })

    it('should return 400 on body validation failure', async () => {
      const bodySchema = createObjectValidator({
        name: createStringValidator({ min: 1 }),
      })

      const action = createAction({
        body: bodySchema,
        handler: async ({ body }) => {
          return { received: body }
        },
      })

      const args = createMockActionArgs({
        body: { name: '' },
      })

      try {
        await action(args)
        expect.unreachable('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const validationError = error as ValidationError
        expect(validationError.statusCode).toBe(400)
        expect(validationError.issues.length).toBeGreaterThan(0)
      }
    })

    it('should reject missing required fields', async () => {
      const bodySchema = createObjectValidator({
        name: createStringValidator(),
      })

      const action = createAction({
        body: bodySchema,
        handler: async ({ body }) => {
          return { received: body }
        },
      })

      const args = createMockActionArgs({ body: {} })
      await expect(action(args)).rejects.toThrow(ValidationError)
    })

    it('should reject invalid email', async () => {
      const bodySchema = createObjectValidator({
        email: createEmailValidator(),
      })

      const action = createAction({
        body: bodySchema,
        handler: async ({ body }) => {
          return { received: body }
        },
      })

      const args = createMockActionArgs({ body: { email: 'not-an-email' } })
      await expect(action(args)).rejects.toThrow(ValidationError)
    })

    it('should handle form data content type', async () => {
      const bodySchema = createObjectValidator({
        name: createStringValidator(),
      })

      const action = createAction({
        body: bodySchema,
        handler: async ({ body }) => {
          return { received: body }
        },
      })

      // Create FormData request
      const formData = new FormData()
      formData.append('name', 'Alice')

      const request = new Request('https://example.com/test', {
        method: 'POST',
        body: formData,
      })

      const args = {
        request,
        params: {},
        context: {
          cloudflare: {
            env: {},
            ctx: {
              waitUntil: () => {},
              passThroughOnException: () => {},
            } as ExecutionContext,
          },
        },
      }

      const response = await action(args)
      expect(await response.json()).toEqual({
        received: { name: 'Alice' },
      })
    })
  })

  describe('with env validation', () => {
    it('should validate env and parse body', async () => {
      const bodySchema = createObjectValidator({
        name: createStringValidator(),
      })

      const action = createAction(
        { env: { API_KEY: createStringValidator({ min: 1 }) } },
        {
          body: bodySchema,
          handler: async ({ env, body }) => {
            return { key: env.API_KEY, name: body.name }
          },
        },
      )

      const args = createMockActionArgs({
        env: { API_KEY: 'secret' },
        body: { name: 'Bob' },
      })

      const response = await action(args)
      expect(await response.json()).toEqual({ key: 'secret', name: 'Bob' })
    })

    it('should throw on invalid env with body validation', async () => {
      const bodySchema = createObjectValidator({
        name: createStringValidator(),
      })

      const action = createAction(
        { env: { API_KEY: createStringValidator({ min: 1 }) } },
        {
          body: bodySchema,
          handler: async ({ env, body }) => {
            return { key: env.API_KEY, name: body.name }
          },
        },
      )

      const args = createMockActionArgs({
        env: { API_KEY: '' },
        body: { name: 'Bob' },
      })

      await expect(action(args)).rejects.toThrow()
    })

    it('should validate env without body validation', async () => {
      const action = createAction(
        { env: { API_KEY: createStringValidator({ min: 1 }) } },
        {
          handler: async ({ env }) => {
            return { key: env.API_KEY }
          },
        },
      )

      const args = createMockActionArgs({ env: { API_KEY: 'secret' } })
      const response = await action(args)
      expect(await response.json()).toEqual({ key: 'secret' })
    })
  })

  describe('error propagation', () => {
    it('should propagate handler errors', async () => {
      const action = createAction({
        handler: async () => {
          throw new Error('Action failed')
        },
      })

      const args = createMockActionArgs()
      await expect(action(args)).rejects.toThrow('Action failed')
    })

    it('should propagate Response throws', async () => {
      const action = createAction({
        handler: async () => {
          throw new Response('Forbidden', { status: 403 })
        },
      })

      const args = createMockActionArgs()
      await expect(action(args)).rejects.toBeInstanceOf(Response)
    })
  })
})
