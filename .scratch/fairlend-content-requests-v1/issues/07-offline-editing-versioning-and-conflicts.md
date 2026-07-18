# 07 — Support offline editing, versioning, and conflicts

**What to build:** Elie can continue working without connectivity, recover full history, and synchronize safely when multiple devices or actors make changes.

**Blocked by:** 06 — Capture autosaved founder text input

**Status:** ready-for-agent

- [ ] Automerge and Convex synchronize ordinary concurrent document edits automatically.
- [ ] Offline edits remain available after reload and synchronize after reconnection.
- [ ] The dedicated Convex versioning component provides undo, redo, and attributable history.
- [ ] Submission waits for durable synchronization without discarding local work.
- [ ] Incompatible singleton-field changes preserve both values and create an Attention required conflict.
- [ ] Conflict resolution is authorized, audited, and testable through the shared workflow contract.
