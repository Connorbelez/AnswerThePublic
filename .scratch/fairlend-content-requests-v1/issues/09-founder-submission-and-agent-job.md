# 09 — Submit founder input and execute an agent job

**What to build:** Elie's durable submission automatically hands responsibility to a local agent, which can claim one job safely and produce the first ready primary response.

**Blocked by:** 07 — Support offline editing, versioning, and conflicts

**Status:** ready-for-agent

- [ ] Explicit submission atomically records Founder complete and creates one idempotent drafting job.
- [ ] A local agent can claim the job through a time-bounded lease and heartbeat it.
- [ ] Expired leases are safely reclaimable and duplicate completion cannot create duplicate output.
- [ ] Transient failures retry; exhausted retries create Attention required and notify operators.
- [ ] First successful output creates and promotes a primary response and advances Ready to respond.
- [ ] Job input references stable immutable source and founder-input versions.
- [ ] UI, CLI, HTTP, audit, and workflow-contract tests observe the full handoff.
