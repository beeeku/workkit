import { describe, it, expect } from 'vitest'
import { parseArgs, joinPath } from '../src/utils'

describe('parseArgs', () => {
  it('parses positional arguments', () => {
    const result = parseArgs(['init', 'my-project'])
    expect(result.positionals).toEqual(['init', 'my-project'])
    expect(result.flags).toEqual({})
  })

  it('parses --flag=value syntax', () => {
    const result = parseArgs(['--template=hono'])
    expect(result.flags['template']).toBe('hono')
  })

  it('parses --flag value syntax', () => {
    const result = parseArgs(['--template', 'hono'])
    expect(result.flags['template']).toBe('hono')
  })

  it('parses boolean flags', () => {
    const result = parseArgs(['--verbose'])
    expect(result.flags['verbose']).toBe(true)
  })

  it('parses --no-flag as false', () => {
    const result = parseArgs(['--no-color'])
    expect(result.flags['color']).toBe(false)
  })

  it('parses short flags with value', () => {
    const result = parseArgs(['-t', 'hono'])
    expect(result.flags['t']).toBe('hono')
  })

  it('parses short boolean flags', () => {
    const result = parseArgs(['-v'])
    expect(result.flags['v']).toBe(true)
  })

  it('handles -- separator', () => {
    const result = parseArgs(['--flag', '--', '--not-a-flag'])
    expect(result.flags['flag']).toBe(true)
    expect(result.positionals).toEqual(['--not-a-flag'])
  })

  it('handles mixed positionals and flags', () => {
    const result = parseArgs(['init', '--template', 'hono', 'my-project', '--verbose'])
    expect(result.positionals).toEqual(['init', 'my-project'])
    expect(result.flags['template']).toBe('hono')
    expect(result.flags['verbose']).toBe(true)
  })

  it('returns empty for no args', () => {
    const result = parseArgs([])
    expect(result.positionals).toEqual([])
    expect(result.flags).toEqual({})
  })

  it('handles --flag=value with empty value', () => {
    const result = parseArgs(['--name='])
    expect(result.flags['name']).toBe('')
  })

  it('handles --flag=value with equals in value', () => {
    const result = parseArgs(['--query=key=value'])
    expect(result.flags['query']).toBe('key=value')
  })

  it('handles multiple -- separators (only first matters)', () => {
    const result = parseArgs(['--', '--a', '--', '--b'])
    expect(result.positionals).toEqual(['--a', '--', '--b'])
    expect(result.flags).toEqual({})
  })

  it('short flag followed by another flag is treated as boolean', () => {
    const result = parseArgs(['-v', '--debug'])
    expect(result.flags['v']).toBe(true)
    expect(result.flags['debug']).toBe(true)
  })

  it('short flag followed by short flag is treated as boolean', () => {
    const result = parseArgs(['-a', '-b'])
    expect(result.flags['a']).toBe(true)
    expect(result.flags['b']).toBe(true)
  })

  it('handles --no-flag for various flag names', () => {
    const result = parseArgs(['--no-verbose', '--no-color', '--no-debug'])
    expect(result.flags['verbose']).toBe(false)
    expect(result.flags['color']).toBe(false)
    expect(result.flags['debug']).toBe(false)
  })

  it('handles flag value that looks like a number as string', () => {
    const result = parseArgs(['--port', '3000'])
    expect(result.flags['port']).toBe('3000')
    expect(typeof result.flags['port']).toBe('string')
  })
})

describe('joinPath edge cases', () => {
  it('handles empty parts', () => {
    expect(joinPath('', 'b')).toBe('/b')
  })

  it('handles multiple slashes', () => {
    expect(joinPath('a///', '///b')).toBe('a/b')
  })

  it('handles no arguments', () => {
    expect(joinPath()).toBe('')
  })
})

describe('joinPath', () => {
  it('joins path segments', () => {
    expect(joinPath('a', 'b', 'c')).toBe('a/b/c')
  })

  it('normalizes double slashes', () => {
    expect(joinPath('a/', '/b')).toBe('a/b')
  })

  it('handles single segment', () => {
    expect(joinPath('a')).toBe('a')
  })
})
