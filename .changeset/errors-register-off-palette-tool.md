---
"@workkit/errors": patch
"@workkit/agent": patch
---

**Register `WORKKIT_AGENT_OFF_PALETTE_TOOL` in the central error code union.** `OffPaletteToolError` (added in #88 / strictTools) was carrying its code via `as unknown as WorkkitErrorCode` because the `@workkit/errors` union was out of diff-only scope for that PR. The cast worked at runtime but defeated exhaustive-switch analysis for consumers pattern-matching on `err.code`.

The code now lives in the `WorkkitErrorCode` union and `OffPaletteToolError` declares it as a literal `as const` — no behavior change, just type integrity.

Closes #93.
