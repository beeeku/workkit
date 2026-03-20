import type { FileSystem } from '../utils'

export interface SeedOptions {
  file: string
  table: string
  format?: 'json' | 'csv'
}

export interface SeedRecord {
  [key: string]: string | number | boolean | null
}

export interface SeedResult {
  table: string
  records: number
  statements: string[]
}

/**
 * Detect file format from extension.
 */
export function detectFormat(filePath: string): 'json' | 'csv' {
  if (filePath.endsWith('.csv')) return 'csv'
  return 'json'
}

/**
 * Parse JSON seed data.
 * Expects an array of objects.
 */
export function parseJsonSeed(content: string): SeedRecord[] {
  const parsed = JSON.parse(content)

  if (!Array.isArray(parsed)) {
    throw new Error('JSON seed file must contain an array of objects')
  }

  for (let i = 0; i < parsed.length; i++) {
    if (typeof parsed[i] !== 'object' || parsed[i] === null || Array.isArray(parsed[i])) {
      throw new Error(`JSON seed record at index ${i} must be a plain object`)
    }
  }

  return parsed as SeedRecord[]
}

/**
 * Parse CSV seed data.
 * First line is headers, remaining lines are records.
 * Supports quoted fields with commas.
 */
export function parseCsvSeed(content: string): SeedRecord[] {
  const lines = content.trim().split('\n')
  if (lines.length < 2) {
    throw new Error('CSV seed file must have at least a header row and one data row')
  }

  const headers = parseCsvLine(lines[0]!)

  if (headers.length === 0) {
    throw new Error('CSV seed file has no columns')
  }

  const records: SeedRecord[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue

    const values = parseCsvLine(line)
    const record: SeedRecord = {}

    for (let j = 0; j < headers.length; j++) {
      const header = headers[j]!
      const value = values[j] ?? ''
      record[header] = parseCsvValue(value)
    }

    records.push(record)
  }

  return records
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  fields.push(current.trim())
  return fields
}

/**
 * Parse a CSV value into appropriate JS type.
 */
export function parseCsvValue(value: string): string | number | boolean | null {
  if (value === '' || value.toLowerCase() === 'null') return null
  if (value.toLowerCase() === 'true') return true
  if (value.toLowerCase() === 'false') return false

  const num = Number(value)
  if (!isNaN(num) && value !== '') return num

  return value
}

/**
 * Escape a SQL value for INSERT statements.
 */
export function escapeSqlValue(value: string | number | boolean | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  // Escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Generate SQL INSERT statements from records.
 */
export function generateInsertStatements(
  table: string,
  records: SeedRecord[],
): string[] {
  if (records.length === 0) return []

  // Validate table name
  if (!/^[a-zA-Z_]\w*$/.test(table)) {
    throw new Error(`Invalid table name: "${table}"`)
  }

  const statements: string[] = []

  for (const record of records) {
    const columns = Object.keys(record)
    const values = columns.map((col) => escapeSqlValue(record[col]!))
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`,
    )
  }

  return statements
}

/**
 * Execute the seed command (generates SQL, does not execute against DB).
 */
export async function executeSeed(
  options: SeedOptions,
  fs: FileSystem,
): Promise<SeedResult> {
  if (!await fs.exists(options.file)) {
    throw new Error(`Seed file not found: ${options.file}`)
  }

  const content = await fs.readFile(options.file)
  const format = options.format ?? detectFormat(options.file)

  let records: SeedRecord[]
  if (format === 'csv') {
    records = parseCsvSeed(content)
  } else {
    records = parseJsonSeed(content)
  }

  const statements = generateInsertStatements(options.table, records)

  return {
    table: options.table,
    records: records.length,
    statements,
  }
}
