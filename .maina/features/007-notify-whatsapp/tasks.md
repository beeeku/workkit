# Task Breakdown — @workkit/notify/whatsapp

1. update `package.json` exports + bunup entry for `./whatsapp`
2. impl:errors + impl:schema (D1 migration SQL)
3. test:keywords → impl:keywords (multi-locale STOP matcher)
4. test:phone → impl:phone (E.164 + cipher hook)
5. test:opt-in → impl:opt-in (`isOptedIn`, `recordOptIn`, `revokeOptIn`)
6. test:session-window → impl:session-window (inbound log + 24h check)
7. test:marketing-pause → impl:marketing-pause (`MarketingPauseRegistry`)
8. test:media-cache → impl:media-cache (etag→mediaId)
9. test:provider:meta → impl:providers/meta (send + parseWebhook + verifySignature + uploadMedia + handleVerificationChallenge)
10. impl:providers/twilio + impl:providers/gupshup (stubs)
11. test:adapter → impl:adapter (orchestrator)
12. impl:forget
13. wire `src/adapters/whatsapp/index.ts`
14. README + changeset
15. lint + typecheck + scoped tests
16. maina verify
17. maina commit + push + PR
18. request review

## Definition of Done

- All tests green
- Typecheck + lint clean
- maina verify clean
- LOC ≤700 source for whatsapp subpath
- Meta provider end-to-end (mocked fetch + mocked D1)
- Twilio + Gupshup throw with explicit "not implemented" message
- 24h session window auto-routing (test)
- Opt-in proof check pre-send; `OptInRequiredError` (test)
- Multi-locale STOP keyword matching (EN/HI/ES/FR)
- DND callback only invoked for `category: marketing` (test)
- Quality-rating webhook flips marketing-pause flag (test)
- Webhook GET-verification challenge handler (test)
- Single src/adapters/whatsapp/index.ts export
- Changeset
- PR opened, links #29
- Review requested
