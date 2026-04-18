# Task Breakdown — @workkit/pdf

## Tasks

Test tasks precede implementation (red → green).

1. **scaffold**: package.json, tsconfig, bunup, vitest, README stub.
2. **test:escape** → **impl:escape** — `escape()` HTML-escapes; `raw()` brands as Raw; concatenation auto-escapes plain strings; `Escaped`/`Raw` brand identity.
3. **test:safeKey** → **impl:safeKey** — joins parts; rejects `..`, `\`, leading `/`, control chars, empty parts; throws `ValidationError` (or pdf-specific `PdfPathError`).
4. **test:presets** → **impl:presets** — A4 / Letter / Legal dimension constants; margin presets `narrow`/`normal`/`wide`; passthrough for custom margin values.
5. **test:header** → **impl:header** — composes header/footer template; auto-escapes plain strings; respects `raw()`; produces puppeteer-compatible HTML; `disclaimerRequired` enforcement.
6. **test:render** → **impl:render** — `renderPDF(html, opts)` returns `Uint8Array`; consumes `withPage` from `@workkit/browser`; passes options through; honors abort signal; loads fonts when supplied; returns bytes.
7. **test:store** → **impl:store** — `storedPDF(html, opts)` round-trips through R2 mock; tags metadata; presigns with default 3600s; clamps TTL > 24h to error; rejects unsafe key.
8. **wire** `src/index.ts` exports + types.
9. **lint + typecheck + scoped tests**.
10. **maina verify**.
11. **changeset** for `@workkit/pdf@0.1.0`.
12. **maina commit**.
13. **push + PR** against master.
14. **request review**.

## Dependencies

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14
```

Critical path linear. 6 and 7 share the `@workkit/browser` mock surface — define it once in a `tests/_mocks.ts` helper.

## Definition of Done

- [ ] `bun --filter @workkit/pdf test` green
- [ ] `bun --filter @workkit/pdf typecheck` clean
- [ ] `biome check packages/pdf` clean
- [ ] `maina verify` clean
- [ ] LOC budget ≤250 source lines (target 100-200)
- [ ] Header/footer escapes plain strings by default; `raw()` opt-in tested
- [ ] `safeKey()` rejects path traversal and control chars (tested)
- [ ] Presigned URL TTL default 3600s, hard cap 86400s (tested)
- [ ] No HTML body content in logs (manual review)
- [ ] `@workkit/testing` integration present
- [ ] Single `src/index.ts` export
- [ ] Changeset added
- [ ] PR opened, links #24
- [ ] Review requested
