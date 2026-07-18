# FairLend Content Requests

The production application for turning community questions, journalist requests,
and digital-PR opportunities into prioritized, research-backed content requests.

This repository is currently at **Ticket 01: production application foundation**.
It provides the authenticated TanStack Start shell, the WorkOS boundary, the
Convex principal model, and isolated contract/browser test harnesses. Request
creation and the approved Variant G editor canvas are intentionally delivered by
the following tickets in `.scratch/fairlend-content-requests-v1/issues/`.

## Stack

- TanStack Start and TanStack Router
- Convex
- WorkOS AuthKit
- Tailwind CSS v4
- shadcn/ui using the RHEA preset in `components.json`
- Vitest, `convex-test`, and Playwright

## Local setup

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env.local` and supply the WorkOS and Convex values.
3. In WorkOS, register `http://localhost:3000/api/auth/callback` as a redirect
   URI and `http://localhost:3000/api/auth/sign-in` as the sign-in endpoint.
4. Set `WORKOS_CLIENT_ID` and `FAIRLEND_WORKOS_ORGANIZATION_ID` in the Convex
   deployment, then run `bunx convex dev` to regenerate `_generated` files and
   synchronize the schema/auth configuration.
5. Run the app with `bun run dev`.

The checked-in generated Convex types let type checking and isolated contract
tests run before a developer connects a deployment. `convex codegen` becomes the
source of truth once a deployment is configured.

## WorkOS roles

| WorkOS role slug | Application role | Intended principal |
| --- | --- | --- |
| `founder` | `founder` | Elie / founder workflow |
| `operator-editor` | `operator_editor` | Operator and editorial workspace |
| `agent-editor` | `agent_editor` | CLI, API, and ChatGPT agent editors |
| `administrator` | `administrator` | System administration |

Convex derives the principal role and organization entirely from the signed
WorkOS token. The WorkOS callback provisions the principal using a zero-argument
Convex mutation; ordinary application loads are query-only, and profile display
data comes from the verified WorkOS session rather than caller-controlled
mutation arguments.

## Deployment

The production adapter targets Cloudflare Workers. Configure the WorkOS values
as Worker secrets/bindings and configure `VITE_CONVEX_URL` as a Worker variable
(the server reads it at runtime), then run `bun run deploy`. That command always
creates a clean production build before Wrangler deploys it; browser-test
artifacts are isolated and deleted.

## Verification

```bash
bun run typecheck
bun run lint
bun run test:contract
bun run test:e2e
bun run build
```

`bun run check` runs the CI-compatible typecheck, lint, full Vitest suite, and
production build. Playwright is separate because its browser binaries must be
installed first with `bunx playwright install chromium webkit`.

The browser harness injects an identity only when the development-only
`FAIRLEND_E2E_AUTH_KEY` is supplied as a server-only binding to a dedicated
`.e2e-dist` build. Normal production builds omit the `e2e` mode and tree-shake
the fixture entry path; `bun run deploy` always rebuilds the clean `dist` output.
