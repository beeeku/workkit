# Feature: createMockD1 backed by real SQLite

Tracks GitHub issue #48.

## Problem Statement

`@workkit/testing`'s `createMockD1` is a regex-based SQL parser that silently
returns incorrect results for standard query shapes, causing tests to pass
against broken code. Five gaps surfaced by real usage in entryexit.ai:

1. Literal values mid-`VALUES (...)` shift all subsequent bound params left
2. `SELECT COUNT(*) AS <alias>` only works when `<alias>` is literally `count`
3. `UPDATE ... RETURNING` with a subquery in `WHERE` breaks WHERE parsing
4. `ON CONFLICT(...) DO UPDATE SET ... excluded.x` is not parsed
5. `INSERT OR IGNORE` is matched syntactically but uniqueness is not enforced

A mock that silently returns wrong data is worse than no mock — tests pass
that would fail in production.

## Target User

- Primary: Workers developers writing unit tests against D1. Today they either
  tolerate the silent-wrong mock or pivot to `@cloudflare/vitest-pool-workers`
  (slower startup per test file).
- Secondary: `@workkit/testing`'s own test suite.

## User Stories

- As a Workers developer, I want `createMockD1` to execute my SQL with real
  SQLite semantics so that tests fail when my code is wrong and pass when it's
  right.
- As `@workkit/testing` maintainer, I want to stop owning a bespoke SQL
  parser so new SQL features don't require parser patches.

## Success Criteria

- [ ] All five gaps from issue #48 have regression tests that pass
- [ ] Existing tracker (`MockOperations`) tests still pass
- [ ] Existing error-injection (`ErrorInjection`) tests still pass
- [ ] `initialTables` seeding still works (schema inferred from first row)
- [ ] No new runtime dependencies added (constitution rule 1)
- [ ] `bun test` green on macOS and Linux CI
- [ ] Public API signature of `createMockD1` unchanged

## Scope

### In Scope

- Replace the regex parser in `packages/testing/src/d1.ts` with a real SQLite
  engine via a dual-runtime adapter (`bun:sqlite` on Bun, `node:sqlite` on Node)
- Preserve `MockOperations` tracker (classify reads/writes/deletes by leading
  keyword)
- Preserve `ErrorInjection` wrapper (`failAfter`, `failOn`, `withLatency`)
- Preserve `initialTables` ergonomics: infer column names from first row,
  emit `CREATE TABLE ... (col TEXT, ...)`, then `INSERT` rows
- Bump `engines.node` to `>=22` (where `node:sqlite` lives)
- Drop lenient shims: auto-create-on-INSERT, case-insensitive column quirks
- Update `packages/testing/tests/d1.test.ts` to add regression coverage
- Add changeset (minor bump for `@workkit/testing`)

### Out of Scope

- `createFailingD1` — unchanged
- Other mocks (KV, R2, Queue, DO) — unchanged
- Replacing `@cloudflare/vitest-pool-workers` as a recommendation for
  integration tests that need full Workers runtime

## Design Decisions

**Engine: `bun:sqlite` + `node:sqlite`, selected at runtime.**
Alternatives considered:

- `sql.js` (wasm) — adds ~1MB dep, needs constitution justification. Rejected:
  builtins achieve the same correctness with zero deps.
- `better-sqlite3` (native binding) — native install fragility in CI. Rejected.
- `bun:sqlite` alone — breaks Node consumers (miniflare-based test setups).
  Rejected.

**Hard break vs soft migration.** Chose hard: drop lenient behaviors even
though they change observable behavior. Current user count is 1 (author);
intended user count is "every Workers dev" — better to get semantics right
before wider adoption than to carry quirks forward.

**Adapter shape.** Minimal: `{ exec(sql), prepare(sql) -> { run, all, get } }`.
Two concrete implementations, one-time runtime detection.

## Open Questions

None — all resolved in brainstorm.
