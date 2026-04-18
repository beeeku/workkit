# Task Breakdown — @workkit/notify (core)

## Tasks (linear, TDD)

1. scaffold (package.json, tsconfig, bunup, vitest, README stub)
2. impl:errors (small, used everywhere)
3. test:idempotency → impl:idempotency
4. test:quiet-hours → impl:quiet-hours
5. impl:adapters (registry + types)
6. test:define → impl:define + impl:config (priority allowlist)
7. impl:preferences + impl:opt-out + impl:records (D1 query helpers)
8. test:dispatch → impl:dispatch (orchestrator)
9. impl:send (enqueue) + impl:consumer (createNotifyConsumer)
10. impl:webhooks
11. test:forget → impl:forget
12. wire src/index.ts
13. README + cost/security notes
14. lint + typecheck + scoped tests
15. maina verify
16. changeset
17. maina commit + push + PR
18. request review

## Definition of Done

- [ ] All tests green
- [ ] Typecheck + lint clean
- [ ] maina verify clean
- [ ] LOC budget ≤900 source
- [ ] D1 schema documented
- [ ] Adapter interface stable + tested via mock adapter
- [ ] Opt-out re-checked at dispatch (test)
- [ ] Quiet-hours midnight wrap (test)
- [ ] Idempotency UNIQUE collision returns `duplicate` (test)
- [ ] All-channel-opted-out → `skipped` (test)
- [ ] forgetUser cascade (test)
- [ ] Single src/index.ts export
- [ ] Changeset
- [ ] PR opened, links #26
- [ ] Review requested
