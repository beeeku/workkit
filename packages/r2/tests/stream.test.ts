import { describe, it, expect } from 'vitest'
import { streamToBuffer, streamToText, streamToJson } from '../src/stream'
import { stringToStream } from './helpers/mock-r2'
import { ValidationError } from '@workkit/errors'

describe('streamToBuffer()', () => {
  it('converts a stream to ArrayBuffer', async () => {
    const stream = stringToStream('hello world')
    const buffer = await streamToBuffer(stream)
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(buffer.byteLength).toBe(11)
  })

  it('preserves binary data', async () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 253])
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(original)
        controller.close()
      },
    })
    const buffer = await streamToBuffer(stream)
    const result = new Uint8Array(buffer)
    expect(result).toEqual(original)
  })

  it('handles empty stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
    const buffer = await streamToBuffer(stream)
    expect(buffer.byteLength).toBe(0)
  })

  it('handles multi-chunk stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello '))
        controller.enqueue(new TextEncoder().encode('world'))
        controller.close()
      },
    })
    const buffer = await streamToBuffer(stream)
    expect(new TextDecoder().decode(buffer)).toBe('hello world')
  })

  it('throws ValidationError for null stream', async () => {
    await expect(streamToBuffer(null)).rejects.toThrow(ValidationError)
  })

  it('throws ValidationError for undefined stream', async () => {
    await expect(streamToBuffer(undefined as any)).rejects.toThrow(ValidationError)
  })

  it('throws ValidationError for non-stream value', async () => {
    await expect(streamToBuffer('not a stream' as any)).rejects.toThrow(ValidationError)
  })
})

describe('streamToText()', () => {
  it('converts a stream to UTF-8 string', async () => {
    const stream = stringToStream('hello world')
    const text = await streamToText(stream)
    expect(text).toBe('hello world')
  })

  it('handles unicode content', async () => {
    const stream = stringToStream('Hello, 世界! 🌍')
    const text = await streamToText(stream)
    expect(text).toBe('Hello, 世界! 🌍')
  })

  it('handles empty stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
    const text = await streamToText(stream)
    expect(text).toBe('')
  })

  it('throws ValidationError for null stream', async () => {
    await expect(streamToText(null)).rejects.toThrow(ValidationError)
  })
})

describe('streamToJson()', () => {
  it('parses JSON from stream', async () => {
    const data = { name: 'Bikash', items: [1, 2, 3] }
    const stream = stringToStream(JSON.stringify(data))
    const result = await streamToJson<typeof data>(stream)
    expect(result).toEqual(data)
  })

  it('parses nested JSON', async () => {
    const data = { a: { b: { c: 42 } } }
    const stream = stringToStream(JSON.stringify(data))
    const result = await streamToJson(stream)
    expect(result).toEqual(data)
  })

  it('parses JSON arrays', async () => {
    const data = [1, 2, 3, 'four']
    const stream = stringToStream(JSON.stringify(data))
    const result = await streamToJson(stream)
    expect(result).toEqual(data)
  })

  it('parses JSON primitives', async () => {
    const stream = stringToStream('42')
    const result = await streamToJson<number>(stream)
    expect(result).toBe(42)
  })

  it('throws ValidationError for invalid JSON', async () => {
    const stream = stringToStream('not valid json {{{')
    await expect(streamToJson(stream)).rejects.toThrow(ValidationError)
  })

  it('throws ValidationError for null stream', async () => {
    await expect(streamToJson(null)).rejects.toThrow(ValidationError)
  })

  it('preserves type parameter', async () => {
    interface User {
      name: string
      age: number
    }
    const stream = stringToStream(JSON.stringify({ name: 'Alice', age: 30 }))
    const user = await streamToJson<User>(stream)
    expect(user.name).toBe('Alice')
    expect(user.age).toBe(30)
  })
})
