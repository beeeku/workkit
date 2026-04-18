# Task Breakdown — @workkit/notify-email

1. scaffold (package.json, tsconfig, bunup, vitest, README stub)
2. impl:errors
3. test:render → impl:render (HTML render + plain-text fallback)
4. test:attachments → impl:attachments (R2 fetch + concurrency + size cap)
5. test:webhook → impl:webhook (Resend event parser + Svix verifySignature + replay)
6. test:adapter → impl:adapter (emailAdapter + Resend POST)
7. wire src/index.ts + README
8. lint + typecheck + scoped tests
9. maina verify
10. changeset
11. maina commit + push + PR
12. request review

## Definition of Done

- All tests green
- Typecheck + lint clean
- maina verify clean
- LOC ≤300
- Webhook signature + replay window covered (test)
- Auto opt-out on hard bounce + complaint covered (test)
- React Email + plain HTML both supported (test)
- Attachment size cap enforced (test)
- Single src/index.ts export
- Changeset
- PR opened, links #27
- Review requested
