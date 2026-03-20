import { describe, it, expect } from 'vitest'
import { BindingError, BindingNotFoundError } from '../../src/categories/binding'
import { WorkkitError } from '../../src/base'

describe('BindingError', () => {
  it('has correct code, statusCode, retryable=false', () => {
    const error = new BindingError('KV binding misconfigured')
    expect(error.code).toBe('WORKKIT_BINDING_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(false)
    expect(error.retryStrategy).toEqual({ kind: 'none' })
  })

  it('extends WorkkitError', () => {
    const error = new BindingError('test')
    expect(error).toBeInstanceOf(WorkkitError)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('BindingNotFoundError', () => {
  it('auto-generates message from binding name', () => {
    const error = new BindingNotFoundError('MY_KV')
    expect(error.message).toBe(
      'Binding "MY_KV" not found in environment. Check your wrangler.toml configuration.',
    )
  })

  it('sets bindingName property', () => {
    const error = new BindingNotFoundError('MY_KV')
    expect(error.bindingName).toBe('MY_KV')
  })

  it('includes bindingName in context', () => {
    const error = new BindingNotFoundError('MY_KV')
    expect(error.context).toEqual(expect.objectContaining({ bindingName: 'MY_KV' }))
  })

  it('has correct code and statusCode', () => {
    const error = new BindingNotFoundError('DB')
    expect(error.code).toBe('WORKKIT_BINDING_NOT_FOUND')
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(false)
  })

  it('extends WorkkitError', () => {
    const error = new BindingNotFoundError('MY_KV')
    expect(error).toBeInstanceOf(WorkkitError)
  })
})
