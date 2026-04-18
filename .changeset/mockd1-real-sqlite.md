---
"@workkit/testing": minor
---

Back `createMockD1` with a real SQLite engine (`bun:sqlite` on Bun, `node:sqlite` on Node ≥22) instead of a regex-based parser. Fixes five classes of silently-wrong results reported in #48: literal values mid-`VALUES (...)` no longer shift bound params; `SELECT COUNT(*) AS <alias>` works for any alias; `UPDATE ... RETURNING` with a subquery in `WHERE` is supported; `ON CONFLICT(...) DO UPDATE SET ... excluded.x` is honored; `INSERT OR IGNORE` actually enforces uniqueness.

Public API of `createMockD1` is unchanged. Breaking behaviors (removed lenient shims): tables are no longer auto-created on `INSERT` — emit `CREATE TABLE` explicitly or seed via `initialTables` with non-empty rows; column lookups are now case-sensitive to match D1. `engines.node` raised to `>=22` (for `node:sqlite`).
