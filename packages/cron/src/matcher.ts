import { parseCron } from './parser'
import type { CronField } from './types'

/**
 * Check if two sets are equal.
 */
function setsEqual(a: CronField, b: CronField): boolean {
  if (a.size !== b.size) return false
  for (const val of a) {
    if (!b.has(val)) return false
  }
  return true
}

/**
 * Check if a task's cron schedule matches an incoming event's cron expression.
 * Uses semantic comparison: parses both expressions and compares the resolved
 * value sets, so equivalent expressions match regardless of notation.
 *
 * @param taskSchedule The cron expression defined on the task
 * @param eventCron The cron expression from the ScheduledEvent
 * @returns true if the schedules are semantically equivalent
 */
export function matchCron(taskSchedule: string, eventCron: string): boolean {
  try {
    const task = parseCron(taskSchedule)
    const event = parseCron(eventCron)

    return (
      setsEqual(task.minute, event.minute) &&
      setsEqual(task.hour, event.hour) &&
      setsEqual(task.dayOfMonth, event.dayOfMonth) &&
      setsEqual(task.month, event.month) &&
      setsEqual(task.dayOfWeek, event.dayOfWeek)
    )
  } catch {
    return false
  }
}
