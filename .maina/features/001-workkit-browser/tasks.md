# Task Breakdown

## Tasks

Each task is completable in one commit. Test tasks precede implementation tasks (red → green).

1. **scaffold**: package.json, tsconfig.json, bunup.config.ts, vitest.config.ts, README stub, empty src/index.ts. No src logic yet.
2. **test:errors**: write `tests/errors.test.ts` mapping cases (rate-limit headers → `RateLimitError`, timeout → `TimeoutError`, validation → `ValidationError`).
3. **impl:errors**: write `src/errors.ts` to make tests green.
4. **test:withPage**: write `tests/page.test.ts` with mock binding asserting (a) close on success, (b) close on user throw and rethrow, (c) close on abort, (d) `setJavaScriptEnabled(false)` called by default, (e) `js: true` opt-in respected.
5. **impl:withPage**: write `src/page.ts` to make tests green.
6. **test:loadFonts**: write `tests/fonts.test.ts` asserting (a) success with font.check truthy, (b) timeout maps to `TimeoutError`, (c) font 404 (font.check false) maps to `ValidationError` (or named `FontLoadError`), (d) configurable timeout.
7. **impl:loadFonts**: write `src/fonts.ts` to make tests green.
8. **test:browser**: write `tests/browser.test.ts` asserting (a) session acquisition returns expected shape, (b) `keepAlive` flag propagates, (c) close-on-end semantics, (d) error from binding maps through `errors.ts`.
9. **impl:browser**: write `src/browser.ts` to make tests green.
10. **wire:index**: re-export public API from `src/index.ts`.
11. **fixtures**: add `tests/visual-fixtures/{basic,font,image}.html`.
12. **verify**: `maina verify` → fix lint/type/findings.
13. **visual-baseline**: `maina verify --visual` to establish PNG baselines for fixtures (committed under `tests/__visual__/` or wherever maina writes them).
14. **review**: `maina review` → fix findings.
15. **changeset**: `.changeset/workkit-browser-init.md` declaring `@workkit/browser@0.1.0`.
16. **commit**: `maina commit -m "feat(browser): add @workkit/browser — Browser Rendering primitive (#23)"`.
17. **PR**: push branch + `gh pr create` against master with reference to issue #23.
18. **request-copilot**: request Copilot reviewer.
19. **fix-copilot**: address review feedback in follow-up commits, re-run `maina verify`.

## Dependencies

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19
```

Critical path is fully linear. Visual baseline (13) must run after impl is complete (10) and after verify is clean (12).

## Definition of Done

- [ ] All unit tests pass via `bun test`
- [ ] Biome lint clean (`biome check .`)
- [ ] TypeScript compiles (`turbo typecheck`)
- [ ] `maina verify` passes (no findings, or only acknowledged warnings)
- [ ] `maina verify --visual` baselines established and committed
- [ ] `maina review` clean
- [ ] `maina slop` clean
- [ ] Changeset added
- [ ] PR opened against master, links issue #23
- [ ] Copilot review requested
- [ ] Copilot feedback addressed
- [ ] LOC budget held: total `src/**` ≤ 200 lines (target 80-150)
- [ ] `withPage` leak-free under thrown handler AND aborted signal (test-covered)
- [ ] `javaScriptEnabled: false` is default (test-covered)
- [ ] Errors normalized through `@workkit/errors` (test-covered)
- [ ] `@workkit/testing` integration present
- [ ] Single `src/index.ts` export verified
- [ ] README documents: security defaults (JS off, no URL helper), `keepAlive` leak risk, font timeout semantics, visual regression usage
