# 02 — Create, retrieve, and find Content Requests

**What to build:** Operators and agents can create a minimally specified manual Content Request, retrieve it from a stable route, and find it reliably by ID, name, or fuzzy match.

**Blocked by:** 01 — Production application foundation

**Status:** done

- [x] Manual creation requires only the minimum identity and workflow fields; remaining context is optional.
- [x] Manual requests default to Critical and preserve immutable source material.
- [x] Created requests are available through the web application, HTTP contract, and CLI contract.
- [x] Exact ID outranks exact name, and exact name outranks fuzzy matches.
- [x] Ambiguous fuzzy agent lookups return candidates rather than guessing.
- [x] Every creation and lookup-sensitive mutation is authorized and audited.
- [x] Workflow-contract and browser tests verify the complete creation-to-open journey.
