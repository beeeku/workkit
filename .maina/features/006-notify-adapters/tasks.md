# Task Breakdown — @workkit/notify adapters (email + inapp)

1. update `package.json` exports + add `@react-email/render` optional peer
2. update `bunup.config.ts` multi-entry; verify build emits all three artifacts
3. impl:email/errors + impl:email/render + impl:email/attachments + impl:email/webhook
4. test:email/* → red→green
5. impl:email/adapter (uses ^)
6. impl:inapp/errors + impl:inapp/schema + impl:inapp/safe-link
7. test:inapp/safe-link → green
8. impl:inapp/feed (cursor encode/decode + queries)
9. test:inapp/feed → green
10. impl:inapp/sse (registry + handler)
11. test:inapp/sse → green
12. impl:inapp/adapter + impl:inapp/forget
13. test:inapp/adapter → green
14. wire `src/adapters/email/index.ts` + `src/adapters/inapp/index.ts`
15. update README with Adapters section
16. lint + typecheck + scoped tests
17. maina verify
18. changeset bumping `@workkit/notify` minor
19. maina commit + push + PR
20. request review

## Definition of Done

- All tests green
- Typecheck + lint clean
- maina verify clean
- LOC budgets held: email ≤500, inapp ≤350
- `bun pack` produces a tarball whose `package.json` `exports` resolves both subpaths
- `import "@workkit/notify/email"` and `import "@workkit/notify/inapp"` work (manual smoke)
- Single src/index.ts (notify core) export untouched
- Changeset added
- PR opened, links #27 + #28
- Review requested
