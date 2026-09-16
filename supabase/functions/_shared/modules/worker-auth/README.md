# Worker authentication

`assertWorkerAuthentication(request, expectedToken)` validates an internal
machine bearer before request payloads or privileged operations are processed.
Tokens are compared through fixed-size SHA-256 digests and are never logged.

This module does not replace Supabase user authentication. Compatibility with
legacy transport headers belongs in an application adapter, not this generic
module.
