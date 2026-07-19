# FairLend Content Requests

The production application for turning community questions, journalist requests,
and digital-PR opportunities into prioritized, research-backed content requests.

Tickets 01 through 07 establish the authenticated production shell and the first
end-to-end Content Request workflow. Authorized editors can create a Critical
manual request from the mobile web interface, HTTP API, or CLI, preserve original
source evidence, find it safely, and open its stable route. The remaining workflow
is tracked in `.scratch/fairlend-content-requests-v1/issues/`.

Each request has one accountable assignee and optional watchers. Assignment
changes retain a dedicated history and audit event, while new founder assignments
and Critical escalations create an in-app notification plus a transactional-email
outbox item. Elie's assignment-scoped library supports a touch-scroll stack and a
compact grid without changing the request's stable URL.

Operators work from five server-computed next-action queues: Needs Elie, Agent
drafting, Needs operator, Delivered, and Attention required. Queue membership is
derived from lifecycle, the latest agent job, open semantic conflicts, and active
required delivery receipts; it is never stored as a second mutable status.
Manual Critical work retains precedence within every queue. Cards expose
assignee, draft presence, job state, conflicts, and required-channel progress,
while filters preserve each request's stable route.

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
4. Provision the required Convex environment values, then run `bunx convex dev`
   to regenerate `_generated` files and synchronize the schema/auth
   configuration:

   ```sh
   bunx convex env set WORKOS_CLIENT_ID "client_..."
   bunx convex env set FAIRLEND_WORKOS_ORGANIZATION_ID "org_..."
   bunx convex env set PUBLIC_SHARE_TOKEN_SECRET "$(openssl rand -hex 32)"
   ```

   Set the public-share secret separately in every Convex deployment. Keep it
   stable: existing public URLs remain valid after rotation because only token
   hashes are stored, but idempotent retries of older create operations will be
   rejected with `PUBLIC_SHARE_SECRET_ROTATED`. Revoke or recreate those shares
   deliberately rather than returning a mismatched URL.

   The TanStack server also needs `FAIRLEND_CONVEX_AGENT_ADMIN_KEY`, a
   server-only Convex deploy/admin key. It is used only after WorkOS validates
   an `auth.md` installation credential, and only with Convex's acting-as mode
   so the existing `agent_editor` authorization and audit path remains in
   force. Never expose this key through a `VITE_` variable or client bundle.

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
and the height transition is disabled for reduced-motion preferences.

Typed founder input continuously autosaves to the request's single durable
founder document and reports `Saved`, `Saving`, or `Offline` without mounting a
second editor. Meaningful text advances Pending work to In progress; opening or
saving whitespace does not. Only the assigned founder can read or mutate raw
draft text. Operators and agents receive the minimal `hasFounderDraft` and
updated-at metadata needed to understand progress, never the private content.

The same input surface can capture voice with explicit record, pause, resume,
and stop controls. Audio is written to an owner-scoped IndexedDB queue before
upload, so an offline recording survives reload and synchronizes through Convex
Storage after connectivity returns. Its storage reference and provider
transcript remain attached to the same founder-input document. A completed
transcript is appended to the Automerge text only after the document is durably
synced; upload and transcription failures expose retry actions without changing
typed input. Configure the server-side transcription action with
`FAIRLEND_TRANSCRIPTION_API_URL`, `FAIRLEND_TRANSCRIPTION_API_KEY`, and the
optional `FAIRLEND_TRANSCRIPTION_MODEL`.

Founder text is an Automerge document persisted through an owner-scoped
`IndexedDBStorageAdapter`; a same-owner BroadcastChannel merges open tabs, while
the authenticated Convex transport stores content-addressed binary changes and
reconstructs the canonical document server-side instead of trusting submitted
text or heads. Long offline histories are synchronized in bounded batches with
automatic backoff, and a synchronous owner-scoped write-ahead draft protects
edits made during initialization or immediately before a reload. A service
worker keeps the current founder route, build assets, and Automerge WASM
available after connectivity is lost. Its page cache is namespaced to the active
verified principal, evicts a different owner's page cache before use, and is
purged on sign-out or an authentication response. Local heads are compared to
Convex's durable heads, so downstream submission can call the shared durable-sync
guard and wait without discarding local work.

Each durable materialization is also pushed to the dedicated `convex-timeline`
component with actor, correlation, and timestamp attribution. Undo and redo
remain founder-only, idempotent, audited, and visible in the founder's version
history panel. The timeline retains 50 bounded instant-undo snapshots and
projects only attribution metadata to the browser. Every durable materialization
also enters a paginated immutable archive, so Elie can enumerate and restore
versions older than the timeline window without loading unbounded full-text
snapshots; the content-addressed Automerge stream remains the canonical merge
history. Ordinary text concurrency is merged by Automerge character operations.
Incompatible singleton updates use the shared semantic-conflict
workflow instead: both the durable current value and proposed value are
preserved as `Attention required`, and only an editor can resolve one of those
recorded values through the operator panel and audited mutation. If the current
value changes again before resolution, the workflow rebases to a new conflict
instead of overwriting the third value.

## Deployment

The primary production adapter targets Vercel through Nitro. The linked
`fairlend-content-requests` project uses `vercel.json`, a frozen Bun install,
and `bun run build`. Configure the production WorkOS and Convex values in the
Vercel and Convex dashboards, run the full verification gate, then deploy with
`bunx vercel deploy --prod --yes`. The release and rollback sequence is
documented in `docs/v1-operations-runbook.md`.

Cloudflare Workers remains a supported alternate target. Configure the WorkOS
values as Worker secrets/bindings and `VITE_CONVEX_URL` as a Worker variable,
then run `bun run deploy`; that command creates a production build before
Wrangler deploys it.

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
- `GET /api/v1/agent-jobs` and `POST /api/v1/agent-jobs` — inspect or claim the
  next drafting job with a bounded lease.
- `GET /api/v1/agent-jobs/:jobId` — read the immutable source/founder versions
  for a claimed job. `POST` heartbeats, completes, or fails the lease.
- `GET|POST /api/v1/content-requests/:humanId/deliverables` and
  `POST /api/v1/deliverables/:deliverableId` — list/create derivatives, create
  immutable candidates, explicitly promote versions, and reassign primary.
- `GET /api/v1/content-requests/:humanId/semantic-conflicts` and
  `POST /api/v1/semantic-conflicts/:conflictId` — inspect and explicitly resolve
  incompatible assignee, primary-deliverable, or promoted-version changes.
- `GET|POST /api/v1/content-requests/:humanId/delivery-targets` and
  `POST /api/v1/delivery-targets/:targetId` — manage required/optional channels,
  explicitly confirm delivery against an exact promoted version, or reopen a
  receipt without deleting its history.
- `GET|POST /api/v1/control` (HTTP/ChatGPT) and
  `GET|POST /api/v1/cli/control` (CLI provenance) — discover or execute the
  complete authorized V1 operation registry. `POST` accepts one
  `{ "command": ... }` or up to 25
  ordered `{ "commands": [...] }` entries, supports top-level `fields`
  projection, cursor/limit arguments, and stable per-command
  `idempotencyKey` values. Errors always expose stable `code` and `message`
  fields.
- `GET|POST /api/chatgpt/mcp` — private, revocation-aware Streamable HTTP MCP
  adapter for ChatGPT. It exposes the complete shared V1 registry as read,
  write, and explicitly confirmed consequential tools; see
  [`docs/private-chatgpt-app.md`](docs/private-chatgpt-app.md).

The API accepts the signed-in WorkOS session or a WorkOS bearer access token.
Every create requires or generates a correlation ID and produces an audit event.
Fuzzy lookup returns candidates instead of guessing.

Agent installations use the WorkOS AuthKit `auth.md` flow and the
`agent-editor` role. Provision one WorkOS installation credential per agent or
deployment instead of sharing a bearer token. Its `jti` is preserved as the
audit `credentialId` for access tokens; API keys use their stable WorkOS
registration ID. Every request revalidates revocation with WorkOS before Convex
acts as the registered `agent_editor`, so revoking one installation removes
only that installation's access. Tokens are never stored by this application or
accepted in query strings.

Local agents can use the same HTTP contract through the CLI:

```bash
export CONTENT_REQUESTS_API_URL="https://content-requests.example"
export CONTENT_REQUESTS_ACCESS_TOKEN="<workos-access-token>"
bun run content-requests -- create --title "Explain mortgage portability"
bun run content-requests -- find "mortgage portability"
bun run content-requests -- get CR-EXAMPLE
bun run content-requests -- ingest --file ./scout-report.md --idempotency-key scout-20260718-am
bun run content-requests -- job-claim --lease-token "$LEASE_TOKEN"
bun run content-requests -- job-input "$JOB_ID"
bun run content-requests -- job-heartbeat "$JOB_ID" --lease-token "$LEASE_TOKEN" --lease-generation "$LEASE_GENERATION"
bun run content-requests -- job-complete "$JOB_ID" --lease-token "$LEASE_TOKEN" --lease-generation "$LEASE_GENERATION" --file ./response.md
bun run content-requests -- deliverables CR-EXAMPLE
bun run content-requests -- version "$DELIVERABLE_ID" --file ./regenerated.md --summary "Tighter opening" --idempotency-key version-20260718-01
bun run content-requests -- promote "$DELIVERABLE_ID" --version-id "$VERSION_ID" --expected-version-id "$CURRENT_PROMOTED_VERSION_ID" --idempotency-key promote-20260718-01
bun run content-requests -- primary CR-EXAMPLE --deliverable-id "$DELIVERABLE_ID" --expected-primary-id "$CURRENT_PRIMARY_ID" --idempotency-key primary-20260718-01
bun run content-requests -- conflicts CR-EXAMPLE
bun run content-requests -- conflict-resolve "$CONFLICT_ID" --value "$SELECTED_ID" --idempotency-key resolve-20260718-01
bun run content-requests -- targets CR-EXAMPLE
bun run content-requests -- target-retention "$TARGET_ID" --retention archived --idempotency-key archive-target-20260718-01
bun run content-requests -- target-confirm "$TARGET_ID" --version-id "$VERSION_ID" --idempotency-key delivery-20260718-01
bun run content-requests -- target-reopen "$TARGET_ID" --idempotency-key reopen-20260718-01
bun run content-requests -- control request.workspace --json '{"queue":"needs_operator","limit":20}' --fields page,continueCursor
bun run content-requests -- control request.resolve --json '{"query":"mortgage renewal"}'
bun run content-requests -- control metrics.get --json '{"from":1782864000000,"to":1785542400000}'
bun run content-requests -- control share.create --file ./share-command.json --idempotency-key share-20260718-01
bun run content-requests -- bulk --file ./commands.json --idempotency-key batch-20260718-01
```

The generic `control` command is the canonical agent-economical surface and has
parity with the HTTP operation registry; the named CLI commands remain for
interactive convenience. `bulk` input is either an array of command objects or
`{ "commands": [...] }`. The control plane deliberately has no source update,
founder-input update, or delete operation. `request.update` is restricted to
the editorial metadata allowlist (`title`, `aliases`, `priority`, and
`timingLabel`); it cannot alter raw source or founder material. Agents draft
through deliverable versions, explicitly promote an exact version, and archive
records instead of hard-deleting them.

Collection operations use datastore cursors and preserve `nextCursor` while
applying `fields` to each item in `page`, so `--fields humanId,title` reduces
payload size without making records beyond the first 100 unreachable. Mutable
derived context is stored as immutable attributable versions; use
`context.versions` with `contextId`, `cursor`, and `limit` to inspect history.

Bulk mutations require either a per-command `idempotencyKey` or a batch
`x-idempotency-key`; the server deterministically suffixes a batch key by item
index. For `job.claim`, that stable key is also the authoritative lease token,
so an ambiguous retry cannot claim a second job. Bulk execution is ordered but
intentionally non-atomic. Authentication and authorization are evaluated once
before execution, and the response has
one `{ index, ok, data }` or `{ index, ok, status, error }` result per command,
so a later failure never hides earlier commits and retries remain deterministic.

Founder submission first verifies that every local Automerge head is durable,
then atomically records Founder complete and queues exactly one primary-response
job. Agents should heartbeat long-running jobs; an expired lease is reclaimable.
Transient failures retry up to three claims. Exhaustion notifies operators and a
successful first draft is promoted once and advances the request to Ready to
respond. Promotion and primary reassignment use compare-and-propose values from
the latest `deliverables` response. If another writer changed the singleton in
the meantime, the API returns `attention_required` with a durable semantic
conflict instead of overwriting it; editors resolve that conflict explicitly.
Stable `--idempotency-key` values make ambiguous CLI retries safe. Deployments
upgrading legacy data must run the paginated
`migrations.backfillPrimaryDeliverables` internal mutation once; reruns are
safe. Then run `migrations.backfillOriginalDeliveryTargets` to create the
required original-destination checklist item for pre-existing requests. Finally,
run the paginated `migrations.backfillOperatorWorkspace` mutation. It records
the bounded historical-receipt flag on legacy targets and materializes the
authoritative operator queue/search projection; it is idempotent and schedules
subsequent 50-request pages automatically.

Every new request receives one required original-opportunity target. Additional
targets default optional. Clipboard actions never mutate delivery state. A
receipt snapshots the exact promoted version, destination, confirming actor,
credential, timestamp, and optional note. Reopen clears only the target's active
receipt pointer; receipt and event history remain immutable. Agent identities
cannot confirm delivery from an assertion in the request body: they must supply
a one-time integration-success record created by a trusted backend adapter.

Automated requests can carry an explicit expiration. Scout timing labels are
converted only when they contain an unambiguous ISO date or a standalone
deadline-shaped `within N hours/days` phrase; reply-SLA and dependency wording
is intentionally left unscheduled. Equivalent relative labels retain the first
observed deadline instead of sliding on re-ingestion. The minute
worker expires only unstarted automated requests, cancels queued/unclaimed jobs,
and moves protected founder or started-agent work to `Attention required` for an
editor decision. Manual work never auto-expires. Editors can explicitly expire,
restore with a replacement date, archive, and restore from the request page.
Archive restoration uses operation provenance and a fenced, paginated
transition coordinator, so oversized legacy aggregates remain operable and a
deliverable or destination that was already archived is not accidentally
reactivated. The request stays non-mutable until every child resource and search
projection settles. In-flight jobs are
fenced and preserved as resumable archived work, then returned to the queue with
a fresh lease after restoration. Deployments upgrading an existing job table
must run `bunx convex run --prod migrations:backfillAgentJobClaimability '{}'`
once; the resumable migration populates the indexed claim timestamp used by the
bounded worker claim path and is safe to rerun. Run
`bunx convex run --prod migrations:backfillActiveVoiceCaptureCounts '{}'` at
the same time so expiration can use a materialized progress signal instead of
scanning audio children. Oversized legacy voice sets are protected by an
overflow sentinel and a generation-fenced, resumable exact recount. The minute
cron leases each due row before dispatch and is only a bounded coordinator;
each due request expires in its own fenced mutation, so slow work neither
duplicates dispatch nor starves later rows. Exhausted job leases are reaped from
a bounded materialized due index. V1 enforces per-request limits of 50 deliverables, 50 delivery
targets, 50 voice captures, and one drafting job. The operator library has
durable Expired and Archived filters, and every transition is correlated and
audited. A materially
new obligation is created as a linked Manual/Critical child through the follow-up
form; child snapshots may retain the same thread URL but intentionally do not
claim the parent's canonical deduplication identity. Delivery reopening remains
limited to correcting a receipt on the original request.

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
Exit code `3` means a bulk response committed at least one item but one or more
per-item operations failed; inspect each indexed result before retrying.

## Verification

The production acceptance matrix, migration sequence, invariant scan, metric
definitions, privacy contract, and incident actions are maintained in
[`docs/v1-operations-runbook.md`](docs/v1-operations-runbook.md).

```bash
bun run typecheck
bun run lint
bun run test:contract
bun run validate:migrations
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
