---
"@workkit/approval": patch
"@workkit/mcp": patch
"@workkit/mail": patch
---

chore(deps): raise runtime dependency floors to current in-range releases

- `@workkit/approval`, `@workkit/mcp`: `hono` `^4.7.10` → `^4.13.11`
- `@workkit/mail`: `mimetext` `^3.0.24` → `^3.0.28`, `postal-mime` `^2.4.1` → `^2.7.6`

Same major versions; no API changes. The `hono` floor moves past the
4.12.x advisories (CORS credential reflection, `bodyLimit` bypass, cache
`Vary` leakage, `parseBody` nesting DoS, and others fixed through 4.13.5),
so consumers resolving an older 4.x get a patched copy.
