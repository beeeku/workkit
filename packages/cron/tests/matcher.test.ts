import { describe, it, expect } from 'vitest'
import { matchCron } from '../src/matcher'

describe('matchCron()', () => {
  describe('exact match', () => {
    it('matches identical expressions', () => {
      expect(matchCron('0 * * * *', '0 * * * *')).toBe(true)
    })

    it('matches step expressions', () => {
      expect(matchCron('*/5 * * * *', '*/5 * * * *')).toBe(true)
    })

    it('matches complex expressions', () => {
      expect(matchCron('0 0 * * MON', '0 0 * * MON')).toBe(true)
    })

    it('rejects different expressions', () => {
      expect(matchCron('0 * * * *', '*/5 * * * *')).toBe(false)
    })

    it('rejects partially matching expressions', () => {
      expect(matchCron('0 * * * *', '0 0 * * *')).toBe(false)
    })
  })

  describe('wildcard matching', () => {
    it('matches all-wildcards against itself', () => {
      expect(matchCron('* * * * *', '* * * * *')).toBe(true)
    })

    it('does not match wildcard against specific value', () => {
      expect(matchCron('* * * * *', '0 * * * *')).toBe(false)
    })
  })

  describe('name normalization', () => {
    it('matches day name to numeric equivalent', () => {
      expect(matchCron('0 0 * * 1', '0 0 * * MON')).toBe(true)
    })

    it('matches month name to numeric equivalent', () => {
      expect(matchCron('0 0 1 1 *', '0 0 1 JAN *')).toBe(true)
    })

    it('is case insensitive for names', () => {
      expect(matchCron('0 0 * * mon', '0 0 * * MON')).toBe(true)
    })
  })

  describe('semantic equivalence', () => {
    it('matches Sunday 0 and 7', () => {
      expect(matchCron('0 0 * * 0', '0 0 * * 7')).toBe(true)
    })

    it('matches equivalent list and range', () => {
      expect(matchCron('1,2,3 * * * *', '1-3 * * * *')).toBe(true)
    })

    it('matches equivalent step and list', () => {
      expect(matchCron('0,15,30,45 * * * *', '*/15 * * * *')).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('returns false for invalid pattern', () => {
      expect(matchCron('invalid', '0 * * * *')).toBe(false)
    })

    it('returns false for invalid event cron', () => {
      expect(matchCron('0 * * * *', 'invalid')).toBe(false)
    })

    it('returns false for both invalid', () => {
      expect(matchCron('invalid', 'also-invalid')).toBe(false)
    })
  })
})
