# 17 — Harden and verify V1 end to end

**What to build:** The complete system is demonstrably safe, accessible, observable, performant, and ready for real FairLend operation across founder, operator, agent, and public journeys.

**Blocked by:** 08 — Capture founder voice input; 12 — Build the operator action workspace; 13 — Handle expiration, archival, and follow-ups; 14 — Publish revocable public request views; 15 — Complete the agent CLI and HTTP control plane; 16 — Expose the private ChatGPT App

**Status:** ready-for-agent

- [ ] Canonical founder, operator, agent, and public journeys pass the agreed workflow-contract and browser suites.
- [ ] Accessibility, reduced motion, keyboard use, touch targets, responsive layout, and offline recovery meet acceptance criteria.
- [ ] Concurrent job claiming, idempotent completion, merge conflicts, and retry behavior survive stress tests.
- [ ] Security tests verify authorization, public-field isolation, credential revocation, and immutable-field enforcement.
- [ ] Logs exclude source bodies, founder input, transcripts, credentials, and share tokens.
- [ ] Product metrics cover founder submission, ready response, delivery, expiration, failures, and rewrite rate.
- [ ] Full type checking, linting, tests, production build, and migration validation pass.
