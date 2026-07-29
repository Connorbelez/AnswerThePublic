# 07 — Support expiry, revocation, renewal, and grant history

**What to build:** Give administrators full control and visibility over each Guest Access Grant after generation. They can independently revoke or renew a grant; renewal rotates the token and reconnects the preserved Response Workspace. Expiry and revocation block access without deleting work, and a durable timeline explains the complete grant lifecycle.

**Blocked by:** 03 — Answer and autosave text in both response modes.

**Status:** completed

- [x] Each grant derives Generated, Opened, In progress, Submitted, Expired, or Revoked from durable facts.
- [x] The admin view shows assigned Person, expiry, latest activity, progress, submission state, and chronological events.
- [x] Revoking one grant invalidates only that token and does not affect other grants or delete retained work.
- [x] Expired access shows a safe expiry experience without exposing response content.
- [x] Renewal rotates the token verifier, increments its version, invalidates every previous URL, establishes a new 48-hour expiry, and preserves the same workspace.
- [x] Person assignment remains immutable through renewal; correction requires revoke and regenerate.
- [x] Generated, Opened, first progress, Submitted, Expired, Revoked, Renewed, Reopened, and Taken over events are attributable and idempotent.
- [x] CLI, MCP, and HTTP expose list, revoke, and renew through the shared contract with correct safety classifications.
- [x] Retention follows the parent Content Request regardless of access state.
- [x] Time-controlled persistence, token-rotation, multi-grant, retention, agent-contract, and browser tests prove the complete lifecycle.
