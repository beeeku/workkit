/**
 * Cron Tasks — Scheduled tasks with D1 state tracking
 *
 * Demonstrates building reliable scheduled jobs with:
 *   - @workkit/cron for task routing, middleware, and cron matching
 *   - @workkit/d1 for tracking job execution state
 *   - Distributed locking to prevent duplicate execution
 *   - Timeout and retry middleware for resilience
 */
import { parseEnv } from '@workkit/env'
import { d1 as d1Validator, kv as kvValidator } from '@workkit/env/validators'
import { createCronHandler, withTimeout, withRetry, withLock } from '@workkit/cron'
import { d1 } from '@workkit/d1'
import { z } from 'zod'
import type { ScheduledEvent, ExecutionContext } from '@workkit/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobRun {
  id: number
  job_name: string
  status: 'running' | 'success' | 'failed'
  started_at: string
  finished_at: string | null
  error_message: string | null
  duration_ms: number | null
}

// ─── Environment Schema ───────────────────────────────────────────────────────

const envSchema = {
  DB: d1Validator(),
  LOCK_KV: kvValidator(),
  ALERT_WEBHOOK: z.string().url().optional(),
}

// ─── Task: Cleanup Expired Sessions ───────────────────────────────────────────
//
// Runs every hour. Deletes sessions older than 24 hours and logs the count.
//
// BEFORE (raw scheduled handler):
//   export default {
//     async scheduled(event, env, ctx) {
//       if (event.cron === '0 * * * *') {
//         // One giant if/else chain for all cron patterns
//         const stmt = env.DB.prepare('DELETE FROM sessions WHERE ...')
//         await stmt.run()
//       } else if (event.cron === '*/5 * * * *') {
//         // Another task...
//       }
//     }
//   }
//
// AFTER (workkit):
//   - Each task is a named, isolated function
//   - Middleware applies per-task (timeout, retry, locking)
//   - Cron matching is automatic
//   - State tracking is structured

async function cleanupSessions(
  event: ScheduledEvent,
  env: any,
  ctx: ExecutionContext,
): Promise<void> {
  const validatedEnv = await parseEnv(env, envSchema)
  const db = d1(validatedEnv.DB, { transformColumns: 'camelCase' })
  const startTime = Date.now()

  // Record that the job started
  await db.insert('job_runs').values({
    job_name: 'cleanup-sessions',
    status: 'running',
    started_at: new Date().toISOString(),
  }).run()

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const result = await db.run(
      'DELETE FROM sessions WHERE expires_at < ?',
      [cutoff],
    )

    const duration = Date.now() - startTime
    console.log(`[cleanup-sessions] Deleted ${result.changes} expired sessions in ${duration}ms`)

    // Record success
    await db.run(
      `UPDATE job_runs SET status = 'success', finished_at = ?, duration_ms = ?
       WHERE job_name = 'cleanup-sessions' AND status = 'running'`,
      [new Date().toISOString(), duration],
    )
  } catch (error) {
    const duration = Date.now() - startTime
    const message = error instanceof Error ? error.message : String(error)

    await db.run(
      `UPDATE job_runs SET status = 'failed', finished_at = ?, duration_ms = ?, error_message = ?
       WHERE job_name = 'cleanup-sessions' AND status = 'running'`,
      [new Date().toISOString(), duration, message],
    )

    throw error // Let middleware handle retries
  }
}

// ─── Task: Generate Daily Report ──────────────────────────────────────────────
//
// Runs at midnight UTC. Aggregates daily metrics and stores the report.

async function generateDailyReport(
  event: ScheduledEvent,
  env: any,
  ctx: ExecutionContext,
): Promise<void> {
  const validatedEnv = await parseEnv(env, envSchema)
  const db = d1(validatedEnv.DB, { transformColumns: 'camelCase' })

  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  // Aggregate metrics from various tables
  const [userCount, newUsers, activeUsers] = await Promise.all([
    db.select('users').count(),
    db.first<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE created_at >= ?',
      [yesterday],
    ),
    db.first<{ count: number }>(
      'SELECT COUNT(DISTINCT user_id) as count FROM sessions WHERE created_at >= ?',
      [yesterday],
    ),
  ])

  // Store the daily report
  await db.insert('daily_reports').values({
    report_date: today,
    total_users: userCount,
    new_users: newUsers?.count ?? 0,
    active_users: activeUsers?.count ?? 0,
    generated_at: new Date().toISOString(),
  }).onConflict(['report_date'], { do: 'update', set: {
    total_users: userCount,
    new_users: newUsers?.count ?? 0,
    active_users: activeUsers?.count ?? 0,
    generated_at: new Date().toISOString(),
  }}).run()

  console.log(`[daily-report] Generated report for ${today}: ${userCount} total, ${newUsers?.count ?? 0} new, ${activeUsers?.count ?? 0} active`)
}

// ─── Task: Health Check Ping ──────────────────────────────────────────────────
//
// Runs every 5 minutes. Pings external services and records their status.

async function healthCheckPing(
  event: ScheduledEvent,
  env: any,
  ctx: ExecutionContext,
): Promise<void> {
  const validatedEnv = await parseEnv(env, envSchema)
  const db = d1(validatedEnv.DB)

  const endpoints = [
    { name: 'api', url: 'https://api.example.com/health' },
    { name: 'auth', url: 'https://auth.example.com/health' },
  ]

  for (const endpoint of endpoints) {
    const start = Date.now()
    let status = 'up'
    let responseTime = 0

    try {
      const response = await fetch(endpoint.url, {
        signal: AbortSignal.timeout(10_000),
      })
      responseTime = Date.now() - start
      status = response.ok ? 'up' : 'degraded'
    } catch {
      responseTime = Date.now() - start
      status = 'down'
    }

    await db.run(
      `INSERT INTO health_checks (endpoint_name, status, response_time_ms, checked_at)
       VALUES (?, ?, ?, ?)`,
      [endpoint.name, status, responseTime, new Date().toISOString()],
    )
  }
}

// ─── Cron Handler ─────────────────────────────────────────────────────────────
//
// createCronHandler routes incoming cron triggers to matching tasks.
// Middleware applies to ALL tasks: timeout prevents runaway jobs,
// retry handles transient failures.

const handler = createCronHandler({
  tasks: {
    'cleanup-sessions': {
      schedule: '0 * * * *', // Every hour
      handler: cleanupSessions,
    },
    'daily-report': {
      schedule: '0 0 * * *', // Midnight UTC
      handler: generateDailyReport,
    },
    'health-check': {
      schedule: '*/5 * * * *', // Every 5 minutes
      handler: healthCheckPing,
    },
  },

  // Middleware applied to every task
  middleware: [
    withTimeout(30_000),              // Kill tasks after 30 seconds
    withRetry(2, { baseDelay: 1000 }), // Retry up to 2 times with exponential backoff
  ],

  onNoMatch(event) {
    console.warn(`[cron] No task matched cron pattern: ${event.cron}`)
  },
})

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  // HTTP handler for manual triggering and status checks
  async fetch(request: Request, rawEnv: Record<string, unknown>): Promise<Response> {
    const env = await parseEnv(rawEnv, envSchema)
    const db = d1(env.DB, { transformColumns: 'camelCase' })
    const url = new URL(request.url)

    if (url.pathname === '/status') {
      // Show recent job runs
      const runs = await db.all<JobRun>(
        'SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 20',
      )
      return Response.json({ runs })
    }

    return Response.json({ message: 'Cron tasks worker. GET /status for recent runs.' })
  },

  // Cron trigger handler
  scheduled: handler,
}
