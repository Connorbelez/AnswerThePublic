# FairLend Content Requests

The production application for turning community questions, journalist requests,
and digital-PR opportunities into prioritized, research-backed content requests.

Tickets 01 and 02 establish the authenticated production shell and the first
end-to-end Content Request workflow. Authorized editors can create a Critical
manual request from the mobile web interface, HTTP API, or CLI, preserve original
source evidence, find it safely, and open its stable route. The remaining workflow
is tracked in `.scratch/fairlend-content-requests-v1/issues/`.

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

## Content Request contracts

Authenticated web users create requests at `/app/new` and open them at the stable
`/app/requests/:humanId` route. Only `title` is required. Optional source material
is captured as an immutable snapshot, and manual requests always begin as
`Critical`.

The initial HTTP contract is available at:

- `GET /api/v1/content-requests` — list requests; add `q` for safe lookup or
  `limit` for a bounded result.
- `POST /api/v1/content-requests` — create a manual request.
- `GET /api/v1/content-requests/:humanId` — retrieve a stable request.

The API accepts the signed-in WorkOS session or a WorkOS bearer access token.
Every create requires or generates a correlation ID and produces an audit event.
Fuzzy lookup returns candidates instead of guessing.

Local agents can use the same HTTP contract through the CLI:

```bash
export CONTENT_REQUESTS_API_URL="https://content-requests.example"
export CONTENT_REQUESTS_ACCESS_TOKEN="<workos-access-token>"
bun run content-requests -- create --title "Explain mortgage portability"
bun run content-requests -- find "mortgage portability"
bun run content-requests -- get CR-EXAMPLE
```

CLI exit code `2` means fuzzy lookup requires explicit disambiguation; HTTP or
authorization failures return exit code `1` with a machine-readable JSON body.

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
