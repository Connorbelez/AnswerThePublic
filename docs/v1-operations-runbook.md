# V1 operations and release gate

This runbook is the production acceptance contract for FairLend Content
Requests. A release is eligible for deployment only after the automated gate,
the browser gate, and the post-migration invariant scan all pass.

## Automated release gate

Run from the repository root:

```bash
bun install --frozen-lockfile
bun run check
bun run test:e2e
```

`bun run check` executes TypeScript, ESLint, the complete Vitest suite, the
dedicated migration validation suite, and a production build. Playwright runs
separately because Chromium and WebKit must be installed on the runner.

| Acceptance area                                                                                                                                                                                  | Executable evidence                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Founder/operator canonical workflow, responsive layout, keyboard input, touch targets, reduced motion, autosave, offline recovery, and owner-cache purge                                         | `tests/e2e/foundation.spec.ts` on iPhone 13 WebKit and desktop Chromium                                                                                                                                    |
| Expert Interview Guest Access: Person assignment, token isolation, autosave/editor fencing, evidence recovery, immutable submission, lifecycle controls, notifications, and attributed synthesis | `tests/e2e/foundation.spec.ts`, `convex/guestAccess.test.ts`, `convex/guestAccessLifecycle.test.ts`, `convex/guestEvidence.test.ts`, `convex/guestNotifications.test.ts`, `convex/expertSynthesis.test.ts` |
| Anonymous public view, exact allowlist, read-only behavior, and immediate revocation                                                                                                             | `tests/e2e/foundation.spec.ts`, `convex/publicShares.test.ts`, `tests/contract/public-share-response.contract.test.ts`                                                                                     |
| Full agent/CLI/HTTP registry, fuzzy resolution, bulk partial results, immutable source/founder boundaries, and idempotency                                                                       | `tests/contract/agent-control-plane.contract.test.ts`, `tests/contract/content-request-adapters.contract.test.ts`                                                                                          |
| Private ChatGPT App schemas, confirmations, current-state fencing, revocation, and agent-only authorization                                                                                      | `tests/contract/chatgpt-app.contract.test.ts`, `tests/contract/agent-credential.contract.test.ts`, `tests/contract/workos-agent-credential.contract.test.ts`                                               |
| Claim contention, lease fencing/reclaim, retry exhaustion, and ambiguous completion replay                                                                                                       | `convex/agentJobs.test.ts`                                                                                                                                                                                 |
| Automerge offline/concurrent merge plus semantic singleton conflict/rebase/resolution                                                                                                            | `convex/founderInputs.test.ts`, `tests/contract/founder-automerge.contract.test.ts`, `convex/semanticConflicts.test.ts`                                                                                    |
| Aggregate-only product metrics and role isolation                                                                                                                                                | `convex/productMetrics.test.ts`                                                                                                                                                                            |
| Log payload privacy                                                                                                                                                                              | `tests/contract/operational-telemetry.contract.test.ts`                                                                                                                                                    |
| Backfill completeness                                                                                                                                                                            | `convex/migrations.test.ts` and `migrations:validateV1Invariants`                                                                                                                                          |

## Migration deployment gate

All backfills are idempotent. Run the applicable backfills after deploying the
compatible schema and before admitting normal traffic:

```bash
bunx convex run --prod migrations:backfillAssignmentFields '{}'
bunx convex run --prod migrations:backfillContentRequestTypes '{}'
bunx convex run --prod migrations:backfillNormalizedPrincipalEmails '{}'
bunx convex run --prod migrations:backfillNormalizedSourceUrls '{}'
bunx convex run --prod migrations:backfillPrimaryDeliverables '{}'
bunx convex run --prod migrations:backfillOriginalDeliveryTargets '{}'
bunx convex run --prod migrations:backfillFounderHandoffs '{}'
bunx convex run --prod migrations:backfillAgentJobClaimability '{}'
bunx convex run --prod migrations:backfillActiveVoiceCaptureCounts '{}'
bunx convex run --prod migrations:backfillOperatorWorkspace '{}'
```

The backfills schedule subsequent pages themselves. After scheduled work has
settled, run the read-only invariant query:

```bash
bunx convex run --prod migrations:validateV1Invariants '{}'
```

The deployment gate is satisfied only when `done` is `true` and `issues` is
empty. If `done` is `false`, pass the returned `continueCursor` as `cursor` and
repeat until the terminal page. Issue codes identify the exact repair surface:
assignment fields, canonical source URL (including unresolved collisions),
active voice count, request type, one retained primary deliverable, one retained
required original target, reconstructed founder handoff, operator projection,
or agent-job claimability. “Retained” means active children for an active
request and archived children for a fully archived request; an in-progress
archive correctly remains blocked until its children settle. Do not tighten
optional legacy schema fields until this scan is clean.

## Product metrics

Operators, administrators, and registered agent editors can query a bounded
window through the same agent control plane used by the CLI and ChatGPT App:

```bash
bun run content-requests -- control metrics.get --json '{"from":1782864000000,"to":1785542400000}'
```

The window must be valid epoch milliseconds and no longer than 366 days. With
no arguments, the query covers the prior 30 days. It scans at most 10,000 audit
events and sets `truncated: true` if the window exceeds that bounded read.

The payload contains only aggregate counts, rates, and durations:

- first opens, founder submissions, ready responses, completed responses,
  expirations, terminal drafting outcomes, and scheduled retries;
- median creation-to-first-open, creation-to-founder-submission,
  founder-submission-to-ready, and ready-to-completed-delivery milliseconds;
- the terminal drafting-failure rate and the completed-delivery-before-expiration
  rate for requests that have an expiration;
- agent-draft deliveries, substantial operator rewrites, rewrite rate, and the
  percentage delivered without substantial rewriting. A rewrite is substantial
  when an operator-delivered version replaces at least 20% of the agent draft's
  normalized word tokens; punctuation, formatting, and small edits do not count.

It never returns request identifiers, source bodies, founder input, transcripts,
credentials, correlation IDs, or public-share tokens. Operational request logs
use a separate closed allowlist containing only event name, operation label,
outcome, HTTP status, duration, and bounded item count.

## Operational response

- `truncated: true`: query a smaller metrics window. Do not treat the partial
  aggregate as a complete period.
- `agent_job.failed`: inspect the operator Attention required queue. Retry by
  creating/claiming authorized work; never mutate the frozen job input.
- semantic conflict: select one of the recorded values in the operator conflict
  panel. A stale resolution rebases rather than overwrites concurrent work.
- revoked public share or agent credential: issue a new share/credential only
  after confirming the revocation was intentional. Revocation is immediate and
  must not be bypassed with cached content.
- expired or revoked Guest Access Grant: renew from the authenticated request
  workspace only after confirming the assigned Person and request. Never recover
  a grant by reusing its old plaintext token; renewal rotates the token and
  preserves the response history.
- failed guest upload: use the upload-failure notification, when present, to
  locate the request. In the authenticated request workspace, open **Guest
  responses** and inspect the attributable asset under **Response evidence**.
  Leave targeted feedback if the respondent needs recovery instructions.
- failed guest transcription: open the request directly and inspect **Guest
  responses** → **Response evidence** in the authenticated request workspace.
  Transcription failures do not create administrator notifications. Ask the
  respondent to use the existing response link to retry transcription, reselect
  the source file, or explicitly discard the asset; reopen a submitted workspace
  first when further edits are required.
- for either guest asset failure, monitor the upload-session, transcription,
  unclaimed-storage, and notification-outbox recovery jobs until the terminal
  state is recorded. Do not treat an unsettled or failed asset as submitted
  evidence.
- offline founder edit: keep the route open or reopen it under the same WorkOS
  principal. The Automerge queue syncs when connectivity returns; signing out
  intentionally purges the owner-scoped page and draft cache.
