---
"@workkit/cron": patch
---

`nextRun()` now implements POSIX / Vixie-cron semantics for the
`dayOfMonth` and `dayOfWeek` fields: when **both** fields are explicitly
restricted (neither is `*`), the expression fires if **either** condition
is satisfied (OR), not only when both match simultaneously (AND).

For example, `0 8 1 * 1` previously fired only on Mondays that fell on the
1st of the month; it now correctly fires on every Monday **and** on every 1st
of the month at 08:00 UTC.

When only one day field is restricted the existing behaviour is preserved.
