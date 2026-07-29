# 05 — Enforce one active editor with explicit takeover

**What to build:** Make a Response Workspace safe to continue across devices. The current device holds a short renewable editor lease. A second device sees that editing is active and may explicitly take over. Takeover invalidates the previous editor so stale clients cannot silently overwrite newer work.

**Blocked by:** 03 — Answer and autosave text in both response modes.

**Status:** completed

- [x] Entering an editable workspace acquires or resumes a server-enforced editor lease with a generation and expiry.
- [x] The active client heartbeats the lease without generating user notifications.
- [x] Only the current lease holder and generation may mutate the Response Workspace.
- [x] A second device receives a clear read-only conflict state with an explicit takeover action.
- [x] Takeover increments the lease generation, records an event, and immediately rejects writes from the prior editor.
- [x] An expired lease can be acquired without destructive takeover.
- [x] Ambiguous heartbeat and takeover retries are idempotent and do not create multiple active editors.
- [x] Lease identifiers and token material are excluded from guest-visible projections and logs.
- [x] Concurrency tests plus a two-context browser scenario prove acquisition, heartbeat, expiry, takeover, and stale-write rejection.
