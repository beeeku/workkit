# Task Breakdown

## Tasks

TDD: test tasks precede implementation.

- [x] T1 — Add regression tests for the five issue-#48 gaps in `packages/testing/tests/d1.test.ts`
- [x] T2 — Write `packages/testing/src/adapter.ts` with dual `bun:sqlite` / `node:sqlite` backend
- [x] T3 — Rewrite `createMockD1` in `packages/testing/src/d1.ts` on top of the adapter; preserve `MockOperations` tracker, `ErrorInjection` wrapper, and `initialTables` seeding
- [x] T4 — Bump `engines.node` to `>=22`; update `bunup.config.ts` and `tsconfig.json` entries
- [x] T5 — Add changeset (`.changeset/mockd1-real-sqlite.md`)
- [x] T6 — `maina verify` + `maina review` + `maina slop` green
- [x] T7 — Open PR #49, address Copilot + CodeRabbit review feedback

## Dependencies

T1 → T2 → T3 → T4 → T5 → T6 → T7. Linear critical path; no parallelism.

## Definition of Done

- [x] Full `@workkit/testing` vitest suite passes (212 tests)
- [x] `bun run lint` clean
- [x] `bun run typecheck` clean across workspace
- [x] `bun run constitution:check --diff-only` passes
- [x] All five issue-#48 regression tests pass (and the prior regex parser is deleted)
- [x] PR CI green on Node 22
