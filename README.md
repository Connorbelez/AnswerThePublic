# FairLend Content Requests

The production application for turning community questions, journalist requests,
and digital-PR opportunities into prioritized, research-backed content requests.

Tickets 01 through 05 establish the authenticated production shell and the first
end-to-end Content Request workflow. Authorized editors can create a Critical
manual request from the mobile web interface, HTTP API, or CLI, preserve original
source evidence, find it safely, and open its stable route. The remaining workflow
is tracked in `.scratch/fairlend-content-requests-v1/issues/`.

Each request has one accountable assignee and optional watchers. Assignment
changes retain a dedicated history and audit event, while new founder assignments
and Critical escalations create an in-app notification plus a transactional-email
outbox item. Elie's assignment-scoped library supports a touch-scroll stack and a
compact grid without changing the request's stable URL.

Maintained scout reports now enter through one deterministic ingestion boundary.
The complete Markdown document is parsed and validated before any database call;
one Convex mutation then upserts the report, immutable opportunity evidence, and
mutable context deck atomically. Generated draft copy is intentionally excluded
from deliverables. Known tracking parameters are removed from canonical HTTP(S)
URLs for conservative deduplication, while semantic query parameters remain.

Set `FAIRLEND_APP_URL`, `FAIRLEND_PRINCIPAL_PROVISIONING_KEY`, plus the
transactional-email endpoint and API key in the Convex deployment. Assignment
writes an in-app notification and durable email outbox record atomically, then
schedules the provider-agnostic dispatcher. A minute cron recovers queued,
retryable, and lease-expired sends; claim fencing and the stable provider
idempotency key prevent stale workers from corrupting the result. Email payloads
contain only the recipient, template identifier, and authenticated deep link—never
source or founder content.

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

| WorkOS role slug  | Application role  | Intended principal                  |
| ----------------- | ----------------- | ----------------------------------- |
| `founder`         | `founder`         | Elie / founder workflow             |
| `operator-editor` | `operator_editor` | Operator and editorial workspace    |
| `agent-editor`    | `agent_editor`    | CLI, API, and ChatGPT agent editors |
| `administrator`   | `administrator`   | System administration               |

Convex derives the principal role and organization entirely from the signed
WorkOS token. The WorkOS callback provisions the principal and verified email
using a server-only shared provisioning secret; ordinary application loads are
query-only, and profile display data comes from the verified WorkOS session
rather than caller-controlled mutation arguments.

### Ticket 03 assignment migration

The first Ticket 03 deployment intentionally keeps assignment and queue-index
fields optional so the schema accepts Ticket 02 records. After deploying it, run
`bunx convex run --prod migrations:backfillAssignmentFields '{}'`. The migration is
idempotent, processes bounded pages, schedules the next page, and initializes the
creator as accountable assignee. Verify no records are missing the three fields
before tightening their schema validators in a follow-up deployment.

Before enabling Ticket 04 ingestion in an upgraded deployment, also run
`bunx convex run --prod migrations:backfillNormalizedSourceUrls '{}'`. This
idempotent migration derives conservative canonical URLs from legacy immutable
source snapshots so pre-ingestion records participate in URL deduplication.
Canonical collisions are not guessed: the migration records an unresolved
`normalized_source_url_collision` remediation item and leaves the duplicate
aggregate untouched for operator resolution.

## Founder context experience

Assigned founder routes use the approved Variant G Unified Canvas. The Context
Deck remains the dominant reading surface and combines immutable original
question/source material with available operator cues, talking points, research,
citations, missing research, guardrails, and delivery hints. Each context item
can be hidden or restored independently; pinning keeps it mounted even when its
visibility toggle is off, and pinned content is never line-clamped.
Deck preferences are stored per principal and request in Convex, use immutable
context identities rather than display categories, and automatically reveal new
context items that were not present when the preference set was last saved.

The founder-input surface remains mounted beneath the deck at a compact fixed
height and expands only through its explicit control to approximately half the
mobile viewport. It is intentionally not draggable or user-resizable. Expansion
focuses the text field, native controls preserve keyboard and touch semantics,
and the height transition is disabled for reduced-motion preferences. Durable
draft persistence and offline collaboration begin in Tickets 06 and 07; this
ticket does not claim a false saved state.

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
- `POST /api/v1/scout-ingestions` — validate and atomically ingest one complete
  maintained scout report using `{ "markdown": "...", "idempotencyKey": "..." }`.

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
bun run content-requests -- ingest --file ./scout-report.md --idempotency-key scout-20260718-am
```

Scout ingestion returns `201` with `applied` or `200` with
`idempotent_replay`. Reusing an idempotency key for different Markdown returns
`409 IDEMPOTENCY_KEY_REUSED`; invalid or incomplete Markdown returns `422
INVALID_SCOUT_REPORT` with line-addressed diagnostics and performs no writes.
Re-ingestion replaces only agent-derived context. The first source snapshot and
all founder input remain immutable. Creating a manual request with the same
normalized canonical URL promotes the existing aggregate to Manual/Critical
instead of creating a duplicate.

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
