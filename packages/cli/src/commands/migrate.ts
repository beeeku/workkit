import type { FileSystem } from '../utils'

export interface MigrationFile {
  name: string
  path: string
  sql: string
}

export interface MigrateOptions {
  dir: string
  status?: boolean
  tableName?: string
}

export interface MigrationPlan {
  files: MigrationFile[]
  total: number
}

/**
 * Discover migration files in a directory.
 * Files must be .sql and are sorted alphabetically.
 */
export async function discoverMigrations(
  dir: string,
  fs: FileSystem,
): Promise<MigrationFile[]> {
  if (!await fs.exists(dir)) {
    return []
  }

  const entries = await fs.readDir(dir)
  const sqlFiles = entries
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const migrations: MigrationFile[] = []
  for (const file of sqlFiles) {
    const path = `${dir}/${file}`
    const sql = await fs.readFile(path)
    const name = file.replace(/\.sql$/, '')
    migrations.push({ name, path, sql })
  }

  return migrations
}

/**
 * Validate migration file naming convention.
 * Expected: NNN_description.sql (e.g., 001_create_users.sql)
 */
export function validateMigrationName(name: string): { valid: boolean; reason?: string } {
  if (!name) {
    return { valid: false, reason: 'Migration name is empty' }
  }

  // Must start with digits followed by underscore
  if (!/^\d+_/.test(name)) {
    return { valid: false, reason: `Migration "${name}" should start with a numeric prefix (e.g., 001_description)` }
  }

  // Must only contain alphanumeric, underscore, hyphen
  if (!/^[\w-]+$/.test(name)) {
    return { valid: false, reason: `Migration "${name}" contains invalid characters` }
  }

  return { valid: true }
}

/**
 * Check for gaps in migration numbering.
 */
export function detectNumberingGaps(migrations: MigrationFile[]): string[] {
  const warnings: string[] = []
  const numbers = migrations
    .map((m) => {
      const match = m.name.match(/^(\d+)/)
      return match ? parseInt(match[1]!, 10) : null
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)

  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1]!
    const curr = numbers[i]!
    if (curr - prev > 1) {
      warnings.push(`Gap in migration numbering: ${prev} → ${curr}`)
    }
  }

  return warnings
}

/**
 * Build a migration plan (dry run).
 */
export async function buildMigrationPlan(
  options: MigrateOptions,
  fs: FileSystem,
): Promise<MigrationPlan> {
  const migrations = await discoverMigrations(options.dir, fs)

  return {
    files: migrations,
    total: migrations.length,
  }
}

/**
 * Format migration status for display.
 */
export function formatMigrationStatus(plan: MigrationPlan): string {
  if (plan.total === 0) {
    return 'No migration files found.'
  }

  const lines = [`Found ${plan.total} migration(s):\n`]
  for (const file of plan.files) {
    lines.push(`  ${file.name}`)
  }

  return lines.join('\n')
}
