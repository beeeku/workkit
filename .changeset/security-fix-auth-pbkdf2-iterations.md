---
"@workkit/auth": patch
---

Raise default PBKDF2 iteration count from 100 000 to 600 000 to align with
NIST SP 800-132 (2023) recommendations for PBKDF2-HMAC-SHA256.  Existing
hashes stored with the old iteration count continue to verify correctly because
the iteration count is embedded in the `PasswordHash` struct.
