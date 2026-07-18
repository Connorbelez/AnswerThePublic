# 15 — Complete the agent CLI and HTTP control plane

**What to build:** Authenticated agents can operate the entire V1 system economically and safely without depending on the human frontend.

**Blocked by:** 04 — Ingest and deduplicate scout reports; 11 — Track delivery targets and response receipts; 13 — Handle expiration, archival, and follow-ups; 14 — Publish revocable public request views

**Status:** ready-for-agent

- [ ] CLI and HTTP API expose authorized parity for every V1 resource and transition.
- [ ] Agents can address work by queue, exact ID, exact name, or fuzzy match with safe disambiguation.
- [ ] Compact field selection, pagination, bulk operations, idempotency keys, and machine-readable errors minimize agent cost.
- [ ] WorkOS agent identities and individually revocable installation keys resolve to agent-editor permissions.
- [ ] Immutable source/founder input, promotion, delivery proof, archive-only, and no-hard-delete invariants hold for agents.
- [ ] Every mutation records actor, credential, correlation ID, operation, and version references.
- [ ] Adapter tests verify mapping to the shared workflow contract without duplicating domain matrices.
