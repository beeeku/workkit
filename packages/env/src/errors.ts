import { WorkkitError } from '@workkit/errors'
import type { RetryStrategy, WorkkitErrorOptions } from '@workkit/errors'

/**
 * A single environment validation issue.
 */
export interface EnvIssue {
  /** The environment variable or binding name */
  key: string
  /** Human-readable error message */
  message: string
  /** Path within the value (for nested schemas) */
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined
  /** The actual value received (for debugging) */
  received?: unknown
}

/**
 * Error thrown when environment validation fails.
 * Collects ALL issues before throwing so the developer sees every problem at once.
 */
export class EnvValidationError extends WorkkitError {
  readonly code = 'WORKKIT_VALIDATION' as const
  readonly statusCode = 400
  readonly retryable = false
  readonly defaultRetryStrategy: RetryStrategy = { kind: 'none' }

  /** Structured access to all validation issues */
  readonly issues: readonly EnvIssue[]

  constructor(issues: EnvIssue[], options?: WorkkitErrorOptions) {
    const formatted = formatIssues(issues)
    super(`Environment validation failed:\n\n${formatted}`, options)
    this.name = 'EnvValidationError'
    this.issues = issues
  }
}

function formatIssues(issues: EnvIssue[]): string {
  const lines: string[] = []

  const missing = issues.filter((i) => i.received === undefined)
  const invalid = issues.filter((i) => i.received !== undefined)

  if (missing.length > 0) {
    lines.push('  Missing:')
    for (const issue of missing) {
      lines.push(`    ✗ ${issue.key} — ${issue.message}`)
    }
  }

  if (invalid.length > 0) {
    lines.push('  Invalid:')
    for (const issue of invalid) {
      const received = formatReceived(issue.received)
      lines.push(`    ✗ ${issue.key} — ${issue.message} (received: ${received})`)
    }
  }

  lines.push('')
  lines.push(
    `  ${issues.length} issue${issues.length === 1 ? '' : 's'} found. ` +
      'Check your wrangler.toml bindings and .dev.vars file.',
  )

  return lines.join('\n')
}

function formatReceived(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string')
    return value.length > 50 ? `"${value.slice(0, 50)}..."` : `"${value}"`
  if (typeof value === 'object') return Object.prototype.toString.call(value)
  return String(value)
}
