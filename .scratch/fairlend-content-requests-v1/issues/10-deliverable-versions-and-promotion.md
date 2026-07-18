# 10 — Manage deliverable versions and promotion

**What to build:** Operators and agents can create multiple useful outputs without destabilizing the approved primary response or losing the exact history of what changed.

**Blocked by:** 09 — Submit founder input and execute an agent job

**Status:** ready-for-agent

- [ ] Every request has exactly one primary response and may have multiple derivatives.
- [ ] Deliverable versions are immutable and attributable.
- [ ] The first successful primary draft can auto-promote.
- [ ] Regeneration creates a candidate and never silently replaces a promoted version.
- [ ] Authorized promotion and primary reassignment are explicit and audited.
- [ ] Secondary deliverables do not block primary completion unless tied to a required target.
- [ ] Web, CLI, HTTP, and tests expose consistent candidate and promoted state.
