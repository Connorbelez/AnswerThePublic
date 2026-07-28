# Opportunity automation

The project-owned opportunity automation invokes the installed
`$orchestrate-fairlend-opportunities` compound skill. One run performs two
explicit stages: it first produces the maintained human-readable scout report,
then locally validates and atomically ingests that complete report into the
configured Convex dev deployment. The HTTP API boundary remains available for
credentialed non-development installations.

## Runtime contract

The automation runs from this repository and reads the maintained research
contract at
`artifacts/fairlend-community-media-opportunity-scout.md`.
Every generated report is written to `.artifacts/opportunity-scout/` before any
remote mutation. Generated reports are intentionally ignored by Git; successful
ingestion preserves the report and raw opportunity evidence in the application.

Run the same boundary manually with:

```sh
bun --env-file=.env.local run scout:orchestrate -- \
  --file .artifacts/opportunity-scout/<report>.md \
  --validate-only

bun --env-file=.env.local run scout:orchestrate -- \
  --file .artifacts/opportunity-scout/<report>.md \
  --target convex-dev
```

The orchestrator derives its idempotency key from the complete report SHA-256
digest. Re-running the same artifact is therefore an idempotent replay, including
after an ambiguous network failure.

## Convex dev target

The project automation uses `--target convex-dev`. The orchestrator requires a
`dev:<deployment>` `CONVEX_DEPLOYMENT`, requires `VITE_CONVEX_URL` to name that
same deployment, and invokes Convex with `--deployment dev`. Any production or
mismatched target fails before mutation. It synchronizes the dedicated
`workos-agent:codex-dev-opportunity-automation` principal and attributes each
request to it.

The local machine must be authenticated to the Convex project, and
`FAIRLEND_WORKOS_ORGANIZATION_ID` must match the dev deployment configuration.
No production deployment is mutated by this target.

## HTTP API target

Use `--target api` (the command default) and set
`CONTENT_REQUESTS_ACCESS_TOKEN` in `.env.local` to a dedicated WorkOS agent
installation credential for this automation. Set `CONTENT_REQUESTS_API_URL`, or
use the existing `FAIRLEND_APP_URL` fallback. Never store either credential in
the Codex automation prompt or a generated report.

The server validates the installation with WorkOS on every request and attributes
mutations to that installation. Revoking it disables only this automation.

## Failure policy

- Invalid reports fail locally with line-addressed diagnostics and perform no
  remote mutation.
- Authentication, authorization, payload, idempotency-reuse, and canonical-source
  collision errors do not retry.
- Unknown transport or server failures retry once with the same idempotency key.
- The automation may create `automated_scout` Content Requests, but it must never
  post externally, contact a source, or confirm a delivery receipt.
