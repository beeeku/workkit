import type { ParsedCron, CronField } from './types'
import { ValidationError } from '@workkit/errors'

const DAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
}

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

interface FieldSpec {
  min: number
  max: number
  names?: Record<string, number>
}

const FIELD_SPECS: FieldSpec[] = [
  { min: 0, max: 59 },                          // minute
  { min: 0, max: 23 },                          // hour
  { min: 1, max: 31 },                          // day of month
  { min: 1, max: 12, names: MONTH_NAMES },      // month
  { min: 0, max: 7, names: DAY_NAMES },         // day of week (0 & 7 = Sunday)
]

/**
 * Resolve a token to a numeric value, handling names.
 */
function resolveToken(token: string, names?: Record<string, number>): number | null {
  const upper = token.toUpperCase()
  if (names && upper in names) return names[upper]
  const n = Number(token)
  if (Number.isNaN(n) || !Number.isInteger(n)) return null
  return n
}

/**
 * Parse a single cron field string into a set of allowed values.
 */
function parseField(field: string, spec: FieldSpec): CronField | null {
  const { min, max, names } = spec
  // effective max for day-of-week: treat 7 as valid input but normalize to 0
  const effectiveMax = spec.max === 7 ? 6 : max
  const result = new Set<number>()

  const parts = field.split(',')
  for (const part of parts) {
    // Handle step: */N or range/N
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    let base = part
    let step = 1

    if (stepMatch) {
      base = stepMatch[1]
      step = Number(stepMatch[2])
      if (step <= 0) return null
    }

    if (base === '*') {
      // Wildcard with optional step
      for (let i = min; i <= effectiveMax; i += step) {
        result.add(i)
      }
    } else if (base.includes('-')) {
      // Range
      const [startStr, endStr] = base.split('-')
      const start = resolveToken(startStr, names)
      const end = resolveToken(endStr, names)
      if (start === null || end === null) return null

      const normStart = start === 7 && spec.max === 7 ? 0 : start
      const normEnd = end === 7 && spec.max === 7 ? 0 : end

      if (normStart < min || normStart > effectiveMax) return null
      if (normEnd < min || normEnd > effectiveMax) return null
      if (normStart > normEnd) return null

      for (let i = normStart; i <= normEnd; i += step) {
        result.add(i)
      }
    } else {
      // Single value
      const val = resolveToken(base, names)
      if (val === null) return null

      // Normalize Sunday 7 → 0
      const normVal = val === 7 && spec.max === 7 ? 0 : val

      if (normVal < min || normVal > effectiveMax) return null
      result.add(normVal)
    }
  }

  return result.size > 0 ? result : null
}

/**
 * Parse a cron expression into a ParsedCron object.
 * Throws ValidationError on invalid input.
 */
export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new ValidationError(`Invalid cron expression: expected 5 fields, got ${fields.length}`, [
      { path: ['expression'], message: `Expected 5 fields, got ${fields.length}` },
    ])
  }

  const parsed: CronField[] = []
  for (let i = 0; i < 5; i++) {
    const result = parseField(fields[i], FIELD_SPECS[i])
    if (result === null) {
      throw new ValidationError(`Invalid cron field at position ${i}: "${fields[i]}"`, [
        { path: ['field', `${i}`], message: `Invalid value: "${fields[i]}"` },
      ])
    }
    parsed.push(result)
  }

  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek: parsed[4],
  }
}

/**
 * Check if a cron expression is valid.
 */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression)
    return true
  } catch {
    return false
  }
}

/**
 * Describe a cron expression in human-readable English.
 */
export function describeCron(expression: string): string {
  const parsed = parseCron(expression)

  const isAllMinutes = parsed.minute.size === 60
  const isAllHours = parsed.hour.size === 24
  const isAllDays = parsed.dayOfMonth.size === 31
  const isAllMonths = parsed.month.size === 12
  const isAllDow = parsed.dayOfWeek.size === 7

  const minuteVal = parsed.minute.size === 1 ? [...parsed.minute][0] : null
  const hourVal = parsed.hour.size === 1 ? [...parsed.hour][0] : null
  const dayVal = parsed.dayOfMonth.size === 1 ? [...parsed.dayOfMonth][0] : null
  const monthVal = parsed.month.size === 1 ? [...parsed.month][0] : null
  const dowVal = parsed.dayOfWeek.size === 1 ? [...parsed.dayOfWeek][0] : null

  // Every minute
  if (isAllMinutes && isAllHours && isAllDays && isAllMonths && isAllDow) {
    return 'Every minute'
  }

  // Check for step patterns in minutes
  const minuteStep = detectStep(parsed.minute, 0, 59)

  // Every N minutes
  if (minuteStep && minuteStep > 1 && isAllHours && isAllDays && isAllMonths && isAllDow) {
    return `Every ${minuteStep} minutes`
  }

  // Format time string
  const formatTime = (h: number, m: number) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

  // Every N hours at minute M
  const hourStep = detectStep(parsed.hour, 0, 23)
  if (minuteVal !== null && hourStep && hourStep > 1 && isAllDays && isAllMonths && isAllDow) {
    return `Every ${hourStep} hours at minute ${minuteVal}`
  }

  // Every hour at minute M
  if (minuteVal !== null && isAllHours && isAllDays && isAllMonths && isAllDow) {
    return `Every hour at minute ${minuteVal}`
  }

  // Specific day of week
  if (minuteVal !== null && hourVal !== null && isAllDays && isAllMonths && dowVal !== null) {
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dowVal]
    return `Every ${dayName} at ${formatTime(hourVal, minuteVal)}`
  }

  // Monthly (specific day)
  if (minuteVal !== null && hourVal !== null && dayVal !== null && isAllMonths && isAllDow) {
    return `On day ${dayVal} of every month at ${formatTime(hourVal, minuteVal)}`
  }

  // Specific month and day
  if (minuteVal !== null && hourVal !== null && dayVal !== null && monthVal !== null && isAllDow) {
    const monthName = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'][monthVal]
    return `On day ${dayVal} of ${monthName} at ${formatTime(hourVal, minuteVal)}`
  }

  // Daily at specific time
  if (minuteVal !== null && hourVal !== null && isAllDays && isAllMonths && isAllDow) {
    return `Every day at ${formatTime(hourVal, minuteVal)}`
  }

  // Fallback: return the expression
  return `Cron: ${expression}`
}

/**
 * Detect if a set of values represents a step pattern (e.g., 0,15,30,45 = step 15).
 * Returns the step value or null if not a step pattern.
 */
function detectStep(values: CronField, min: number, max: number): number | null {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length <= 1) return sorted.length === 1 ? null : null
  if (sorted[0] !== min) return null

  const step = sorted[1] - sorted[0]
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== step) return null
  }

  // Verify it covers the full range
  const expected = Math.floor((max - min) / step) + 1
  if (sorted.length === expected) return step

  return null
}

/**
 * Calculate the next run time for a cron expression.
 * @param expression Cron expression
 * @param from Starting date (default: now)
 * @returns Date of next execution
 */
export function nextRun(expression: string, from?: Date): Date {
  const parsed = parseCron(expression)
  const date = from ? new Date(from.getTime()) : new Date()

  // Start from the next minute
  date.setUTCSeconds(0, 0)
  date.setUTCMinutes(date.getUTCMinutes() + 1)

  // Limit search to prevent infinite loops (max 2 years)
  const maxIterations = 525960 // ~365 * 24 * 60 * 2
  let iterations = 0

  while (iterations < maxIterations) {
    iterations++

    if (!parsed.month.has(date.getUTCMonth() + 1)) {
      // Advance to next month
      date.setUTCMonth(date.getUTCMonth() + 1)
      date.setUTCDate(1)
      date.setUTCHours(0, 0, 0, 0)
      continue
    }

    if (!parsed.dayOfMonth.has(date.getUTCDate())) {
      date.setUTCDate(date.getUTCDate() + 1)
      date.setUTCHours(0, 0, 0, 0)
      continue
    }

    if (!parsed.dayOfWeek.has(date.getUTCDay())) {
      date.setUTCDate(date.getUTCDate() + 1)
      date.setUTCHours(0, 0, 0, 0)
      continue
    }

    if (!parsed.hour.has(date.getUTCHours())) {
      date.setUTCHours(date.getUTCHours() + 1)
      date.setUTCMinutes(0, 0, 0)
      continue
    }

    if (!parsed.minute.has(date.getUTCMinutes())) {
      date.setUTCMinutes(date.getUTCMinutes() + 1)
      date.setUTCSeconds(0, 0)
      continue
    }

    return date
  }

  throw new ValidationError('Could not find next run within 2 years', [
    { path: ['expression'], message: 'No valid execution time found within search range' },
  ])
}
