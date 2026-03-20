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
