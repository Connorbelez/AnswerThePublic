# 02 — Generate a Person-assigned response link

**What to build:** Give administrators a complete path from a Content Request to a usable response link. They select a registered Person through autocomplete, default to the founder, optionally create a missing Person inline, and click **Generate & copy link**. The unguessable token is assigned immutably to that Person, scoped to one request, stored only as a verifier, expires in 48 hours, and opens a no-sign-in guest brief. The existing read-only Public Share remains separate.

**Blocked by:** 01 — Make Expert Interviews first-class Content Requests.

**Status:** completed

- [x] The admin selector searches organization-scoped people by display name and email and defaults to the configured founder.
- [x] A missing Person can be created inline without leaving the Content Request.
- [x] Grant creation immutably records the selected Person, request, organization, creator, and exact 48-hour expiry.
- [x] Tokens contain at least 256 bits of secure randomness; plaintext is returned once and never persisted or logged.
- [x] **Generate & copy link** attempts clipboard copy and always exposes a manual Copy fallback.
- [x] FairLend does not send the link through any outbound channel.
- [x] The token opens one request’s approved guest brief without authentication or a guest identity selector.
- [x] Invalid tokens reveal no request metadata and access attempts are bounded using the existing share-access precedent.
- [x] Multiple independent grants may exist for one Content Request.
- [x] UI, shared service, CLI/MCP schema, persistence, security, and browser-level tests prove the complete path.
