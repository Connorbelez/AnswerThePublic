# 01 — Production application foundation

**What to build:** A deployable production shell that proves authenticated users can enter the FairLend Content Requests application through the same shared application boundary that future web, CLI, API, and ChatGPT App capabilities will use.

**Blocked by:** None — can start immediately

**Status:** done

- [x] TanStack Start, Convex, WorkOS, Tailwind, and shadcn/ui with the RHEA preset are integrated as the production stack.
- [x] Founder, operator/editor, agent-editor, and administrator roles have an explicit authorization model.
- [x] A signed-in user can load the responsive application shell and see their identity and role.
- [x] An unauthenticated visitor is routed through the intended sign-in boundary.
- [x] A shared application-service contract is used by the shell instead of direct persistence access.
- [x] Convex functions use explicit argument and return validation and indexed query patterns.
- [x] The agreed workflow-contract and Playwright browser test harnesses run in isolation.
- [x] Type checking, linting, production build, and focused tests pass in CI-compatible commands.
