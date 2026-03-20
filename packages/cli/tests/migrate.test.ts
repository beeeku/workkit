import { describe, it, expect } from 'vitest'
import {
  discoverMigrations,
  validateMigrationName,
  detectNumberingGaps,
  buildMigrationPlan,
  formatMigrationStatus,
} from '../src/commands/migrate'
import { createMockFs } from './helpers'

describe('migrate command', () => {
  describe('discoverMigrations', () => {
    it('discovers .sql files in directory', async () => {
      const fs = createMockFs({
        '/migrations/001_create_users.sql': 'CREATE TABLE users (id INTEGER PRIMARY KEY);',
        '/migrations/002_create_posts.sql': 'CREATE TABLE posts (id INTEGER PRIMARY KEY);',
      })
      const migrations = await discoverMigrations('/migrations', fs)
      expect(migrations).toHaveLength(2)
      expect(migrations[0]!.name).toBe('001_create_users')
      expect(migrations[1]!.name).toBe('002_create_posts')
    })

    it('sorts files alphabetically', async () => {
      const fs = createMockFs({
        '/migrations/003_add_index.sql': 'CREATE INDEX idx;',
        '/migrations/001_create_users.sql': 'CREATE TABLE users (id INT);',
        '/migrations/002_create_posts.sql': 'CREATE TABLE posts (id INT);',
      })
      const migrations = await discoverMigrations('/migrations', fs)
      expect(migrations[0]!.name).toBe('001_create_users')
      expect(migrations[1]!.name).toBe('002_create_posts')
      expect(migrations[2]!.name).toBe('003_add_index')
    })

    it('ignores non-.sql files', async () => {
      const fs = createMockFs({
        '/migrations/001_create.sql': 'CREATE TABLE t;',
        '/migrations/readme.md': '# Migrations',
      })
      const migrations = await discoverMigrations('/migrations', fs)
      expect(migrations).toHaveLength(1)
    })

    it('returns empty array for non-existent directory', async () => {
      const fs = createMockFs()
      const migrations = await discoverMigrations('/missing', fs)
      expect(migrations).toHaveLength(0)
    })

    it('reads SQL content from each file', async () => {
      const sql = 'CREATE TABLE test (id INTEGER);'
      const fs = createMockFs({ '/migrations/001_test.sql': sql })
      const migrations = await discoverMigrations('/migrations', fs)
      expect(migrations[0]!.sql).toBe(sql)
    })
  })

  describe('validateMigrationName', () => {
    it('accepts valid names', () => {
      expect(validateMigrationName('001_create_users').valid).toBe(true)
      expect(validateMigrationName('123_add-index').valid).toBe(true)
    })

    it('rejects names without numeric prefix', () => {
      const result = validateMigrationName('create_users')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('numeric prefix')
    })

    it('rejects empty names', () => {
      expect(validateMigrationName('').valid).toBe(false)
    })

    it('rejects names with special characters', () => {
      expect(validateMigrationName('001_create users').valid).toBe(false)
    })
  })

  describe('detectNumberingGaps', () => {
    it('detects gaps in numbering', () => {
      const migrations = [
        { name: '001_a', path: '', sql: '' },
        { name: '003_b', path: '', sql: '' },
      ]
      const warnings = detectNumberingGaps(migrations)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('1')
      expect(warnings[0]).toContain('3')
    })

    it('returns empty for consecutive numbering', () => {
      const migrations = [
        { name: '001_a', path: '', sql: '' },
        { name: '002_b', path: '', sql: '' },
        { name: '003_c', path: '', sql: '' },
      ]
      expect(detectNumberingGaps(migrations)).toHaveLength(0)
    })

    it('handles empty array', () => {
      expect(detectNumberingGaps([])).toHaveLength(0)
    })

    it('handles single migration', () => {
      const migrations = [{ name: '001_a', path: '', sql: '' }]
      expect(detectNumberingGaps(migrations)).toHaveLength(0)
    })
  })

  describe('buildMigrationPlan', () => {
    it('builds plan from directory', async () => {
      const fs = createMockFs({
        '/migrations/001_a.sql': 'sql1',
        '/migrations/002_b.sql': 'sql2',
      })
      const plan = await buildMigrationPlan({ dir: '/migrations' }, fs)
      expect(plan.total).toBe(2)
      expect(plan.files).toHaveLength(2)
    })

    it('returns empty plan for empty directory', async () => {
      const fs = createMockFs()
      const plan = await buildMigrationPlan({ dir: '/empty' }, fs)
      expect(plan.total).toBe(0)
    })
  })

  describe('formatMigrationStatus', () => {
    it('shows migration count and names', () => {
      const output = formatMigrationStatus({
        total: 2,
        files: [
          { name: '001_create', path: '', sql: '' },
          { name: '002_update', path: '', sql: '' },
        ],
      })
      expect(output).toContain('2 migration(s)')
      expect(output).toContain('001_create')
      expect(output).toContain('002_update')
    })

    it('shows message for no migrations', () => {
      const output = formatMigrationStatus({ total: 0, files: [] })
      expect(output).toContain('No migration files found')
    })
  })
})
