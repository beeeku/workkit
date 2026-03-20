# @workkit/d1

> Typed D1 client with query builder, column transforms, and classified errors

[![npm](https://img.shields.io/npm/v/@workkit/d1)](https://www.npmjs.com/package/@workkit/d1)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@workkit/d1)](https://bundlephobia.com/package/@workkit/d1)

## Install

```bash
bun add @workkit/d1
```

## Usage

### Before (raw D1 API)

```ts
// Verbose prepared statements, manual snake_case conversion, generic errors
const stmt = env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id)
const result = await stmt.first()
const user = result as any // hope for the best
// result.created_at — stuck with snake_case from DB

// Errors are generic — was it a constraint violation? A syntax error?
try {
  await env.DB.prepare("INSERT INTO users (id) VALUES (?)").bind(id).run()
} catch (e) {
  // "D1_ERROR" — thanks, very helpful
}
```

### After (workkit d1)

```ts
import { d1 } from "@workkit/d1"

const db = d1(env.DB, { transformColumns: "camelCase" })

// Simple queries
const user = await db.first<User>("SELECT * FROM users WHERE id = ?", [id])
// user.createdAt — auto-transformed to camelCase

// Fluent query builder
const admins = await db
  .select<User>("users")
  .where("role = ?", ["admin"])
  .orderBy("created_at", "DESC")
  .limit(10)
  .all()

// Insert with returning
const newUser = await db
  .insert("users")
  .values({ id: "123", name: "Alice", role: "admin" })
  .returning<User>()

// Classified errors
try {
  await db.insert("users").values({ id: "123" }).run()
} catch (e) {
  if (e instanceof D1ConstraintError) {
    // UNIQUE constraint failed — handle specifically
  }
}
```

## API

### `d1(binding, options?)`

Create a typed D1 client.

**Options:**
- `transformColumns` — `"camelCase"` or a custom `(column: string) => string` function
- `logQueries` — Log SQL to console (default: `false`)

**Query Methods:**
- **`first<T>(sql, params?)`** — Get first row or `null`
- **`all<T>(sql, params?)`** — Get all rows
- **`run(sql, params?)`** — Execute a write query, returns `D1RunResult`
- **`exec(sql)`** — Execute raw SQL (multiple statements)
- **`batch(statements)`** — Execute multiple statements atomically
- **`prepare(sql)`** — Create a typed prepared statement

**Query Builder:**
- **`select<T>(table)`** — `.where()`, `.orderBy()`, `.limit()`, `.offset()`, `.all()`, `.first()`
- **`insert(table)`** — `.values()`, `.onConflict()`, `.returning()`, `.run()`
- **`update(table)`** — `.set()`, `.where()`, `.returning()`, `.run()`
- **`delete(table)`** — `.where()`, `.returning()`, `.run()`

### Error Classes

- **`D1QueryError`** — SQL syntax or execution errors
- **`D1ConstraintError`** — UNIQUE/FOREIGN KEY/CHECK constraint violations
- **`D1BatchError`** — Batch execution failures
- **`D1MigrationError`** — Migration-specific errors
- **`classifyD1Error(err)`** — Classify raw D1 errors into typed classes

## License

MIT
