# 01 — Make Expert Interviews first-class Content Requests

**What to build:** Promote Expert Interview from a context-title convention into a first-class Content Request type and durable Expert Interview package. An agent can create the complete package through the shared application contract, and an administrator can open the resulting production brief with ordered Knowledge Gaps, citations, Interview Questions, motivations, audience, framing, FairLend posture, founder contribution, and priority operator instructions. This is an expand-only compatibility change: Standard Requests remain the default and existing CLI, MCP, and HTTP operations keep working.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] Content Requests distinguish `standard` and `expert_interview`, with `standard` applied compatibly to existing records.
- [x] Expert Interview package data is persisted as first-class ordered domain data rather than inferred solely from context titles.
- [x] The package preserves the complete Interview Brief, ordered gaps and questions, motivations, citations, and operator instructions.
- [x] Operator/local-agent creation produces a Critical Content Request and preserves direct instructions above inferred choices.
- [x] The shared application contract remains the sole creation/read boundary for HTTP, CLI, MCP, and UI adapters.
- [x] Existing expert-interview agent operations remain compatible.
- [x] Administrators can open the production request detail and see the complete package in stable question order.
- [x] Standard Requests, founder workflows, and read-only Public Shares remain unchanged.
- [x] Contract, persistence, migration, and browser acceptance tests cover the externally visible behavior.
