---
title: "Database (D1)"
---

# Database (D1)

`@workkit/d1` wraps Cloudflare D1 with typed queries, a fluent query builder, automatic column transforms, migrations, batch operations, and classified errors.

## Quick Start

```ts
import { d1 } from '@workkit/d1'

const db = d1(env.DB, { transformColumns: 'camelCase' })

interface User {
  id: number
  name: string
  email: string
  createdAt: string  // camelCase thanks to transform
}

// Typed single-row query
const user = await db.first<User>('SELECT * FROM users WHERE id = ?', [1])
// user is User | null

// Typed multi-row query
const users = await db.all<User>('SELECT * FROM users WHERE active = ?', [true])
// users is User[]
```

## Creating a Client

```ts
import { d1 } from '@workkit/d1'

// Basic
const db = d1(env.DB)

// With options
const db = d1(env.DB, {
  transformColumns: 'camelCase',  // auto-convert snake_case columns
  logQueries: true,               // log SQL to console
})

// Custom column transform
const db = d1(env.DB, {
  transformColumns: (col) => col.toUpperCase(),
})
```

## Query Methods

### `first<T>(sql, params?)` -- Single Row

Returns `T | null`. Use for lookups by primary key or unique constraints:

```ts
const user = await db.first<User>('SELECT * FROM users WHERE id = ?', [42])

if (!user) {
  throw new NotFoundError('User', '42')
}
```

### `all<T>(sql, params?)` -- Multiple Rows

Returns `T[]`. Always returns an array (empty if no matches):

```ts
const admins = await db.all<User>(
  'SELECT * FROM users WHERE role = ? ORDER BY name',
  ['admin'],
)
```

### `run(sql, params?)` -- Mutations

Returns `D1RunResult` with metadata about the operation:

```ts
const result = await db.run(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['Alice', 'alice@example.com'],
)

console.log(result.meta.changes)      // 1
console.log(result.meta.last_row_id)  // 42
console.log(result.meta.duration)     // 0.5 (ms)
```

### `exec(sql)` -- Raw DDL

Executes raw SQL without parameter binding. Use for DDL statements and multi-statement scripts:

```ts
await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
```

## Fluent Query Builder

For dynamic queries, use the fluent builder API. All builders are type-safe and produce parameterized SQL.

### SELECT

```ts
// Simple select
const users = await db.select<User>('users')
  .where('active = ?', [true])
  .orderBy('name', 'asc')
  .limit(10)
  .all()

// Select specific columns
const names = await db.select<{ name: string }>('users')
  .columns('name')
  .where('role = ?', ['admin'])
  .all()

// Count
const count = await db.select('users')
  .where('active = ?', [true])
  .count()

// First matching row
const oldest = await db.select<User>('users')
  .orderBy('created_at', 'asc')
  .first()

// Complex where clauses
const filtered = await db.select<User>('users')
  .where('role = ?', ['admin'])
  .andWhere('created_at > ?', ['2024-01-01'])
  .orWhere('name LIKE ?', ['%test%'])
  .groupBy('role')
  .having('COUNT(*) > ?', [5])
  .all()

// Debug: inspect generated SQL
const { sql, params } = db.select<User>('users')
  .where('active = ?', [true])
  .toSQL()
// sql: "SELECT * FROM users WHERE active = ?"
// params: [true]
```

### INSERT

```ts
// Single insert
await db.insert('users')
  .values({ name: 'Alice', email: 'alice@example.com' })
  .run()

// Multi-row insert
await db.insert('users')
  .values([
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Bob', email: 'bob@example.com' },
  ])
  .run()

// Insert with conflict handling
await db.insert('users')
  .values({ name: 'Alice', email: 'alice@example.com' })
  .onConflict('ignore')
  .run()

// Upsert
await db.insert('users')
  .values({ name: 'Alice', email: 'alice@example.com' })
  .onConflict(['email'], { do: 'update', set: { name: 'Alice Updated' } })
  .run()

// Insert with RETURNING
const inserted = await db.insert('users')
  .values({ name: 'Alice', email: 'alice@example.com' })
  .returning<User>('id', 'name', 'email')
  .first()
// inserted is User | null
```

### UPDATE

```ts
await db.update('users')
  .set({ name: 'Alice Smith', role: 'admin' })
  .where('id = ?', [42])
  .run()

// Update with RETURNING
const updated = await db.update('users')
  .set({ role: 'admin' })
  .where('email = ?', ['alice@example.com'])
  .returning<User>()
  .all()
```

### DELETE

```ts
await db.delete('users')
  .where('id = ?', [42])
  .run()

// Delete with RETURNING
const deleted = await db.delete('users')
  .where('active = ?', [false])
  .returning<{ id: number }>('id')
  .all()
```

## Prepared Statements

Create reusable statements that can be executed multiple times with different parameters:

```ts
const findUser = db.prepare<User>('SELECT * FROM users WHERE id = ?')

const user1 = await findUser.first([1])
const user2 = await findUser.first([2])
const allActive = await findUser.all([true])
```

Prepared statements also integrate with batch operations:

```ts
const insertUser = db.prepare('INSERT INTO users (name) VALUES (?)')

await db.batch([
  insertUser.bind(['Alice']),
  insertUser.bind(['Bob']),
  insertUser.bind(['Charlie']),
])
```

## Batch Operations

Execute multiple statements atomically. All statements succeed or all fail:

```ts
const results = await db.batch([
  db.prepare('INSERT INTO users (name) VALUES (?)').bind(['Alice']),
  db.prepare('INSERT INTO users (name) VALUES (?)').bind(['Bob']),
  db.prepare('UPDATE counters SET count = count + 2 WHERE name = ?').bind(['users']),
])

// results is D1BatchResult[] -- one per statement
for (const result of results) {
  console.log(result.success, result.meta.changes)
}
```

## Migrations

Run SQL migrations in order, tracking which have been applied:

```ts
import { migrate, migrationStatus } from '@workkit/d1'

const migrations = [
  {
    name: '001_create_users',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
  },
  {
    name: '002_add_role',
    sql: `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`,
  },
  {
    name: '003_create_posts',
    sql: `
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
  },
]

// Apply pending migrations
const result = await migrate(env.DB, migrations, { log: true })
console.log(`Applied ${result.applied} migrations`)

// Check status without applying
const status = await migrationStatus(env.DB, migrations)
console.log(`Applied: ${status.applied.length}, Pending: ${status.pending.length}`)
```

Migrations are tracked in a `_migrations` table (configurable via `tableName` option). Already-applied migrations are skipped. If a migration fails, a `D1MigrationError` is thrown with the migration name and original error.

## Column Transforms

When `transformColumns: 'camelCase'` is set, all column names in results are converted from `snake_case` to `camelCase`:

```ts
const db = d1(env.DB, { transformColumns: 'camelCase' })

// Database column: created_at -> TypeScript property: createdAt
const user = await db.first<{ createdAt: string }>('SELECT created_at FROM users LIMIT 1')
```

For custom transformations:

```ts
const db = d1(env.DB, {
  transformColumns: (col) => col.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
})
```

## Error Handling

D1 errors are automatically classified into specific error types:

```ts
import { D1QueryError, D1ConstraintError, D1BatchError, D1MigrationError } from '@workkit/d1'

try {
  await db.run('INSERT INTO users (email) VALUES (?)', ['duplicate@example.com'])
} catch (error) {
  if (error instanceof D1ConstraintError) {
    // Unique constraint violation
    // error.code === 'WORKKIT_D1_CONSTRAINT'
    // error.statusCode === 409
    return Response.json({ error: 'Email already exists' }, { status: 409 })
  }
  if (error instanceof D1QueryError) {
    // SQL syntax error, missing table, etc.
    // error.code === 'WORKKIT_D1_QUERY'
    console.error('Query failed:', error.message)
  }
}
```

You can also classify raw D1 errors:

```ts
import { classifyD1Error } from '@workkit/d1'

try {
  await env.DB.prepare('bad sql').run()
} catch (error) {
  throw classifyD1Error(error, 'bad sql')
}
```

## Raw Access

For operations the wrapper does not cover, access the underlying `D1Database`:

```ts
const db = d1(env.DB)
const raw = db.raw  // D1Database

// Use raw binding directly
const pragma = await raw.prepare('PRAGMA table_info(users)').all()
```
