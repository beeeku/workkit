# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Replace the regex-based SQL parser in `packages/testing/src/d1.ts` with a
thin wrapper around a real SQLite engine. The engine is chosen at runtime:

```
                    createMockD1(initialTables?)
                              |
                              v
                     +--------+--------+
                     |  d1.ts (wrapper) |
                     |  - tracker       |
                     |  - injector      |
                     |  - initialTables |
                     |    seed          |
                     +--------+--------+
                              |
                              v
                     +--------+--------+
                     |   adapter.ts    |
                     |   (interface)   |
                     +--------+--------+
                     /                 \
           +--------+--+          +----+--------+
           | bun:sqlite |          | node:sqlite |
           +-----------+          +-------------+
```

- **Integration points:** only `packages/testing/src/d1.ts`. `index.ts`
  re-exports unchanged. No other `@workkit/*` package imports the d1 mock's
  internals.

## Key Technical Decisions

- **`bun:sqlite` + `node:sqlite`** — zero runtime deps, both are first-party
  SQLite builtins. Selected at runtime via `typeof Bun !== 'undefined'`.
- **Minimal adapter interface** — `{ exec, prepare }`. Keeps engine-specific
  quirks contained; both engines expose nearly-identical sync APIs.
- **`initialTables` schema inference** — take keys of first row, emit
  `CREATE TABLE name (key1, key2, ...)` with no type affinity (SQLite's
  default "BLOB affinity" / "dynamic type" is fine for test data).
- **`D1PreparedStatement` wrapper** preserves `.bind().first()/all()/run()/raw()`
  semantics. `first(colName)` extracts named column. `raw()` returns arrays.
- **Tracker classification** — first keyword of trimmed SQL: `SELECT` → read,
  `INSERT`/`UPDATE`/`ON CONFLICT` → write, `DELETE` → delete.
- **Batch** — `BEGIN`/`COMMIT` around the statements; on error `ROLLBACK`.
- **`dump()`** — both engines support `.serialize()`. Return its `ArrayBuffer`.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/testing/src/adapter.ts` | Dual-runtime SQLite adapter | New |
| `packages/testing/src/d1.ts` | Rewritten wrapper over adapter | Modified |
| `packages/testing/tests/d1.test.ts` | Add 5 regression tests for issue #48 | Modified |
| `packages/testing/package.json` | Bump `engines.node` to `>=22` | Modified |
| `.changeset/*.md` | Minor bump for `@workkit/testing` | New |

## Tasks

TDD: every implementation task has a preceding test task.

- [ ] **T1** — Add regression tests for issue #48 gaps to `d1.test.ts` (fail against current implementation)
- [ ] **T2** — Write `adapter.ts` interface + bun + node implementations
- [ ] **T3** — Rewrite `createMockD1` against adapter; keep `initialTables`, tracker, injector
- [ ] **T4** — Run full test file; ensure all new + existing tests pass
- [ ] **T5** — Bump `engines.node`, add changeset
- [ ] **T6** — `maina verify` → `maina review` → fix findings

## Failure Modes

- **Consumer on Node <22** — hard fail at import time with a clear message
  ("requires Node >=22 for node:sqlite"). Safer than silent wrong behavior.
- **`initialTables` row with differing keys across rows** — first row defines
  schema; subsequent rows with extra keys will fail SQLite insert. Acceptable
  (surfaces as a loud error, which matches the "fail loud" posture).
- **SQL the engine rejects** — propagates as a real SQLite error, not a
  silent empty result. This is the whole point.
- **Batch partial failure** — wrapped in `BEGIN/COMMIT`, so rolls back.
  Matches real D1 batch semantics (atomic).

## Testing Strategy

- Unit tests only (existing pattern). `bun test packages/testing/tests/d1.test.ts`.
- Regression tests: five tests, one per gap in issue #48, each exercising a
  concrete query from entryexit's repro.
- Keep existing tests for tracker, injector, `initialTables`, `createFailingD1`.
- No new integration tests — `@cloudflare/vitest-pool-workers` remains the
  recommended path for full-runtime coverage.

## Wiki Context

### Related Modules

- **cluster-109** (13 entities) — `modules/cluster-109.md`
- **cluster-78** (2 entities) — `modules/cluster-78.md`

### Suggestions

- Module 'cluster-109' already has 13 entities — consider extending it
