# 10 — Harden and release the complete guest workflow

**What to build:** Verify and finish the complete administrator, respondent, and local-agent workflow as one releasable production capability. Close integration gaps, prove mobile-first accessibility and respondent isolation, ensure tokens cannot leak through observability, and protect the existing read-only Public Share from regression. This is an integration-and-verification slice, not permission to redesign approved behavior or absorb unrelated cleanup.

**Blocked by:** 05 — Enforce one active editor with explicit takeover; 06 — Capture audio, attachments, and transcripts; 07 — Support expiry, revocation, renewal, and grant history; 08 — Deliver actionable grant notifications; 09 — Synthesize selected multi-respondent Submissions.

**Status:** completed

- [x] One browser-level acceptance journey covers Person selection, generation/copy fallback, no-sign-in brief, both answer modes, autosave, media, submission, admin inspection, feedback, reopening, expiry, renewal, revocation, and synthesis selection.
- [x] Mobile respondent and desktop administrator layouts retain the approved Focused Proofline hierarchy and expose no desktop-only required workflow.
- [x] Keyboard, focus restoration, progressive disclosure, screen-reader naming, confirmation semantics, sticky-action reachability, and reduced motion meet the project accessibility standard.
- [x] Two-grant isolation tests prove that projections, workspace writes, assets, feedback, and Submissions cannot cross grant boundaries.
- [x] Authorization tests prove a token cannot change its request, assigned Person, expiry, grant state, administrator feedback, or synthesis selection.
- [x] Plaintext tokens are absent from storage, logs, analytics, audit payloads, administrator lists, structured errors, and test snapshots.
- [x] Invalid, expired, revoked, and stale-editor states expose only their approved safe projections and recovery actions.
- [x] Existing Standard Requests, founder flows, agent jobs, notifications, retention, and migrations remain green.
- [x] The legacy Public Share remains unauthenticated, immediately revocable, read-only, and distinct from Guest Access Grant terminology and behavior.
- [x] Typechecking, lint, focused tests, the complete test suite, and production build pass; any pre-existing unrelated failure is evidenced rather than silently ignored.
- [x] Documentation describes the production workflow, CLI/MCP operations, token security, recovery behavior, and operational checks.
