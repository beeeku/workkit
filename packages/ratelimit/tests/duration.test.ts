import { describe, it, expect } from 'vitest'
import { parseDuration } from '../src/duration'

describe('parseDuration', () => {
  describe('valid durations', () => {
    it('parses seconds', () => {
      expect(parseDuration('1s')).toBe(1_000)
      expect(parseDuration('5s')).toBe(5_000)
      expect(parseDuration('30s')).toBe(30_000)
    })

    it('parses minutes', () => {
      expect(parseDuration('1m')).toBe(60_000)
      expect(parseDuration('5m')).toBe(300_000)
      expect(parseDuration('15m')).toBe(900_000)
    })

    it('parses hours', () => {
      expect(parseDuration('1h')).toBe(3_600_000)
      expect(parseDuration('6h')).toBe(21_600_000)
      expect(parseDuration('24h')).toBe(86_400_000)
    })

    it('parses days', () => {
      expect(parseDuration('1d')).toBe(86_400_000)
      expect(parseDuration('7d')).toBe(604_800_000)
    })

    it('handles large values', () => {
      expect(parseDuration('100s')).toBe(100_000)
      expect(parseDuration('60m')).toBe(3_600_000)
    })
  })

  describe('invalid durations', () => {
    it('throws on empty string', () => {
      expect(() => parseDuration('' as any)).toThrow()
    })

    it('throws on missing unit', () => {
      expect(() => parseDuration('100' as any)).toThrow()
    })

    it('throws on invalid unit', () => {
      expect(() => parseDuration('1x' as any)).toThrow()
    })

    it('throws on missing value', () => {
      expect(() => parseDuration('s' as any)).toThrow()
    })

    it('throws on negative value', () => {
      expect(() => parseDuration('-1s' as any)).toThrow()
    })

    it('throws on decimal value', () => {
      expect(() => parseDuration('1.5s' as any)).toThrow()
    })

    it('throws on zero value', () => {
      expect(() => parseDuration('0s' as any)).toThrow()
    })
  })
})
