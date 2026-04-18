# 0001. createMockD1 backed by real SQLite

Date: 2026-04-18

## Status

Accepted

## Context

`@workkit/testing`'s `createMockD1` is implemented as a regex-based SQL
parser. Issue #48 documents five concrete query shapes from real consumer
code where the parser silently returns wrong data:

1. Literal values mid-`VALUES (...)` shift subsequent bound params left
2. `SELECT COUNT(*) AS <alias>` only works when alias is `count`
3. `UPDATE ... RETURNING` with a subquery in `WHERE` breaks
4. `ON CONFLICT(...) DO UPDATE SET ... excluded.x` is not parsed
5. `INSERT OR IGNORE` uniqueness is not enforced

A mock that returns silently-wrong data is worse than no mock: tests pass
against broken code. This is trust-debt on the entire `@workkit/testing`
package, not just the D1 mock.

## Decision

Replace the regex parser with a dual-runtime SQLite adapter:
`bun:sqlite` on Bun, `node:sqlite` on Node ≥22. The public API of
`createMockD1` is unchanged; only internal execution semantics change.

Alternatives considered and rejected:

- **`sql.js` (wasm)** — adds a ~1MB dep and requires a
  `dep-justification:` line per constitution rule 1. Builtin engines
  achieve the same correctness with zero deps.
- **`better-sqlite3` (native binding)** — install fragility on locked-down
  CI / exotic arches.
- **`bun:sqlite` alone** — breaks Node-based miniflare consumers at
  import time.
- **Patching the five gaps in the regex parser** — accretive complexity;
  future gaps keep surfacing.
- **Deleting `createMockD1` entirely** — loses the speed moat over
  miniflare, which is the sole reason the mock exists.

## Consequences

### Positive

- Correct SQL semantics by construction. All five issue-#48 gaps close
  for free, plus any future standard-SQL shapes.
- Zero runtime dependencies. Constitution rule 1 satisfied without an
  opt-out.
- Smaller `d1.ts` — parser and WHERE tokenizer code (~400 LOC) deleted.
- `@workkit/testing` regains credibility as a correct testing surface.

### Negative

- Raises `engines.node` floor to `>=22`. Node 20 hit EOL on 2026-04-30,
  so this is defensible but is a minor version bump.
- Some lenient current behaviors break: auto-create-table-on-INSERT,
  case-insensitive column lookups. Consumers who relied on these must
  emit explicit `CREATE TABLE` or use `initialTables`.

### Neutral

- Two engine implementations to keep in sync behind one adapter. The
  APIs are near-identical (both are "prepare → run/all/get" shapes);
  the adapter layer is ~30 LOC per engine.

## High-Level Design

### System Overview

`createMockD1` returns a D1-shaped object that forwards prepared
statements to a real in-memory SQLite connection. A thin adapter layer
abstracts `bun:sqlite` vs `node:sqlite` so the D1 wrapper is
engine-agnostic.

### Component Boundaries

- `src/adapter.ts` — engine selection + common interface
- `src/d1.ts` — D1-shaped wrapper (tracker, injector, `initialTables`
  seeding, statement wrapping)
- `src/index.ts` — re-export surface, unchanged

No cross-package imports. No new package-level dependencies.

### Data Flow

```text
consumer
  -> createMockD1({table: [{id:1,name:'x'}]})
     -> openAdapter()                       # selects bun or node
     -> adapter.exec("CREATE TABLE table (id, name)")
     -> adapter.exec("INSERT INTO table VALUES (1,'x')")
  -> db.prepare(sql).bind(...).first()
     -> tracker.record(classify(sql))       # read/write/delete
     -> injector.check()                    # fail/latency simulation
     -> adapter.prepare(sql).get(params)
     -> shape result to D1 expectations
```

### External Dependencies

None (runtime). `bun:sqlite` and `node:sqlite` are builtins.

## Low-Level Design

### Interfaces & Types

```ts
// adapter.ts
export interface SqliteAdapter {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface SqliteStatement {
  run(params: unknown[]): { changes: number; lastInsertRowid: number };
  all(params: unknown[]): Record<string, unknown>[];
  get(params: unknown[]): Record<string, unknown> | undefined;
}

export function openAdapter(): SqliteAdapter;
```

### Function Signatures

```ts
// d1.ts — public surface unchanged
export function createMockD1(
  initialTables?: Record<string, Record<string, unknown>[]>,
): D1Database & MockOperations & ErrorInjection;

export function createFailingD1(error: Error | string): D1Database;
```

### DB Schema Changes

N/A (in-memory test mock).

### Sequence of Operations

1. `createMockD1(seed?)` opens an adapter.
2. For each `[tableName, rows]` in `seed`: infer column names from
   `Object.keys(rows[0])`, emit `CREATE TABLE tableName (col1, col2,
   ...)`, then `INSERT` each row via a prepared statement.
3. Return a D1-shaped wrapper whose `.prepare(sql)` returns an object
   with `.bind(...args)` that produces the usual
   `{first, all, run, raw}` methods. Each method:
   - runs injector check (may throw or delay)
   - classifies sql for tracker
   - calls adapter statement method
   - shapes result to D1 format (e.g. `all()` returns
     `{ results, success, meta }`)
4. `batch(statements)` wraps the list in `BEGIN` / `COMMIT`, rolling
   back on error.

### Error Handling

- SQLite errors propagate as native `Error` instances. No swallowing.
- On Node <22, `require('node:sqlite')` throws — let it propagate with
  a clarifying wrapper message.
- Injector errors supersede SQL errors (simulate failure before work).

### Edge Cases

- `initialTables` with an empty row array: `CREATE TABLE` only, no
  inserts. Acceptable.
- `initialTables` with rows that have divergent keys: first row defines
  schema; a later row with a new key will raise a loud insert error,
  which is the correct behavior.
- `prepare(sql)` with multi-statement SQL: routed to `exec()` (both
  `bun:sqlite` and `node:sqlite` require single statements in
  `prepare`).
- `dump()`: returns an empty `ArrayBuffer`. The underlying SQLite engines
  expose serialization, but no current test needs the payload; deferred
  unless a consumer hits this.
