import { describe, it, expect } from 'vitest'
import { describeCron, nextRun, isValidCron, parseCron } from '../src/parser'

describe('isValidCron()', () => {
  it('accepts standard five-field cron', () => {
    expect(isValidCron('0 * * * *')).toBe(true)
  })

  it('accepts all wildcards', () => {
    expect(isValidCron('* * * * *')).toBe(true)
  })

  it('accepts step values', () => {
    expect(isValidCron('*/5 * * * *')).toBe(true)
  })

  it('accepts ranges', () => {
    expect(isValidCron('1-30 * * * *')).toBe(true)
  })

  it('accepts lists', () => {
    expect(isValidCron('1,15,30 * * * *')).toBe(true)
  })

  it('accepts day-of-week names', () => {
    expect(isValidCron('0 0 * * MON')).toBe(true)
  })

  it('accepts month names', () => {
    expect(isValidCron('0 0 1 JAN *')).toBe(true)
  })

  it('accepts mixed range with step', () => {
    expect(isValidCron('1-30/5 * * * *')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidCron('')).toBe(false)
  })

  it('rejects too few fields', () => {
    expect(isValidCron('* * *')).toBe(false)
  })

  it('rejects too many fields', () => {
    expect(isValidCron('* * * * * *')).toBe(false)
  })

  it('rejects invalid characters', () => {
    expect(isValidCron('abc * * * *')).toBe(false)
  })

  it('rejects out-of-range minute', () => {
    expect(isValidCron('60 * * * *')).toBe(false)
  })

  it('rejects out-of-range hour', () => {
    expect(isValidCron('0 24 * * *')).toBe(false)
  })

  it('rejects out-of-range day-of-month', () => {
    expect(isValidCron('0 0 32 * *')).toBe(false)
  })

  it('rejects out-of-range month', () => {
    expect(isValidCron('0 0 * 13 *')).toBe(false)
  })

  it('rejects out-of-range day-of-week', () => {
    expect(isValidCron('0 0 * * 8')).toBe(false)
  })

  it('rejects inverted range', () => {
    expect(isValidCron('30-5 * * * *')).toBe(false)
  })

  it('accepts day-of-week 0 (Sunday)', () => {
    expect(isValidCron('0 0 * * 0')).toBe(true)
  })

  it('accepts day-of-week 7 (Sunday alias)', () => {
    expect(isValidCron('0 0 * * 7')).toBe(true)
  })
})

describe('parseCron()', () => {
  it('parses wildcard as full range', () => {
    const parsed = parseCron('* * * * *')
    expect(parsed.minute.size).toBe(60) // 0-59
    expect(parsed.hour.size).toBe(24) // 0-23
    expect(parsed.dayOfMonth.size).toBe(31) // 1-31
    expect(parsed.month.size).toBe(12) // 1-12
    expect(parsed.dayOfWeek.size).toBe(7) // 0-6
  })

  it('parses specific values', () => {
    const parsed = parseCron('5 3 * * *')
    expect(parsed.minute).toEqual(new Set([5]))
    expect(parsed.hour).toEqual(new Set([3]))
  })

  it('parses step values', () => {
    const parsed = parseCron('*/15 * * * *')
    expect(parsed.minute).toEqual(new Set([0, 15, 30, 45]))
  })

  it('parses ranges', () => {
    const parsed = parseCron('1-5 * * * *')
    expect(parsed.minute).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  it('parses lists', () => {
    const parsed = parseCron('1,15,30 * * * *')
    expect(parsed.minute).toEqual(new Set([1, 15, 30]))
  })

  it('parses range with step', () => {
    const parsed = parseCron('0-30/10 * * * *')
    expect(parsed.minute).toEqual(new Set([0, 10, 20, 30]))
  })

  it('parses day-of-week names (case insensitive)', () => {
    const parsed = parseCron('0 0 * * MON')
    expect(parsed.dayOfWeek).toEqual(new Set([1]))
  })

  it('parses month names', () => {
    const parsed = parseCron('0 0 1 JAN *')
    expect(parsed.month).toEqual(new Set([1]))
  })

  it('normalizes day-of-week 7 to 0', () => {
    const parsed = parseCron('0 0 * * 7')
    expect(parsed.dayOfWeek.has(0)).toBe(true)
    expect(parsed.dayOfWeek.has(7)).toBe(false)
  })

  it('parses complex expression', () => {
    const parsed = parseCron('*/5 9-17 * 1,6 MON-FRI')
    expect(parsed.minute).toEqual(new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]))
    expect(parsed.hour).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]))
    expect(parsed.month).toEqual(new Set([1, 6]))
    expect(parsed.dayOfWeek).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  it('throws on invalid cron', () => {
    expect(() => parseCron('invalid')).toThrow()
  })
})

describe('describeCron()', () => {
  it('describes every minute', () => {
    expect(describeCron('* * * * *')).toBe('Every minute')
  })

  it('describes every hour', () => {
    const desc = describeCron('0 * * * *')
    expect(desc).toBe('Every hour at minute 0')
  })

  it('describes every N minutes', () => {
    const desc = describeCron('*/5 * * * *')
    expect(desc).toBe('Every 5 minutes')
  })

  it('describes every N hours', () => {
    const desc = describeCron('0 */2 * * *')
    expect(desc).toBe('Every 2 hours at minute 0')
  })

  it('describes daily at midnight', () => {
    const desc = describeCron('0 0 * * *')
    expect(desc).toBe('Every day at 00:00')
  })

  it('describes daily at specific time', () => {
    const desc = describeCron('30 14 * * *')
    expect(desc).toBe('Every day at 14:30')
  })

  it('describes weekly on Monday', () => {
    const desc = describeCron('0 0 * * MON')
    expect(desc).toBe('Every Monday at 00:00')
  })

  it('describes weekly on Sunday', () => {
    const desc = describeCron('0 0 * * 0')
    expect(desc).toBe('Every Sunday at 00:00')
  })

  it('describes monthly', () => {
    const desc = describeCron('0 0 1 * *')
    expect(desc).toBe('On day 1 of every month at 00:00')
  })

  it('describes specific month and day', () => {
    const desc = describeCron('0 0 15 6 *')
    expect(desc).toBe('On day 15 of June at 00:00')
  })

  it('returns the cron expression for complex patterns', () => {
    const desc = describeCron('*/5 9-17 * 1,6 MON-FRI')
    // Complex patterns just return the expression
    expect(typeof desc).toBe('string')
    expect(desc.length).toBeGreaterThan(0)
  })
})

describe('nextRun()', () => {
  it('returns a Date', () => {
    const result = nextRun('* * * * *')
    expect(result).toBeInstanceOf(Date)
  })

  it('returns a future date', () => {
    const result = nextRun('* * * * *')
    expect(result.getTime()).toBeGreaterThanOrEqual(Date.now())
  })

  it('respects minute field', () => {
    const result = nextRun('0 * * * *')
    expect(result.getUTCMinutes()).toBe(0)
  })

  it('respects hour and minute', () => {
    const result = nextRun('30 14 * * *')
    expect(result.getUTCMinutes()).toBe(30)
    expect(result.getUTCHours()).toBe(14)
  })

  it('accepts a "from" date', () => {
    const from = new Date('2025-01-01T00:00:00Z')
    const result = nextRun('0 12 * * *', from)
    expect(result.getUTCHours()).toBe(12)
    expect(result.getUTCMinutes()).toBe(0)
    expect(result.getTime()).toBeGreaterThan(from.getTime())
  })

  it('advances to next day if time already passed', () => {
    const from = new Date('2025-01-01T13:00:00Z')
    const result = nextRun('0 12 * * *', from)
    expect(result.getUTCDate()).toBe(2)
    expect(result.getUTCHours()).toBe(12)
  })

  it('respects day-of-week', () => {
    // 2025-01-01 is Wednesday (3)
    const from = new Date('2025-01-01T00:00:00Z')
    const result = nextRun('0 0 * * 5', from) // Friday
    expect(result.getUTCDay()).toBe(5)
    expect(result.getUTCDate()).toBe(3) // Friday Jan 3, 2025
  })

  it('respects month', () => {
    const from = new Date('2025-03-15T00:00:00Z')
    const result = nextRun('0 0 1 6 *', from) // June 1st
    expect(result.getUTCMonth()).toBe(5) // June (0-indexed)
    expect(result.getUTCDate()).toBe(1)
  })

  it('throws on invalid cron', () => {
    expect(() => nextRun('invalid')).toThrow()
  })
})
