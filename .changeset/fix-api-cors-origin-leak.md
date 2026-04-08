---
"@workkit/api": patch
---

CORS `resolveOrigin`: when the configured `origin` is an array and the
incoming request origin is **not** in the whitelist, the function now returns
an empty string instead of leaking the first allowed origin.  Previously a
browser could incorrectly accept the response as a same-origin match in some
edge cases.
