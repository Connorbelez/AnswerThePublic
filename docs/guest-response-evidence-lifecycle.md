# Guest response evidence lifecycle

Guest response drafts and submitted evidence are separate durability boundaries.
Autosave updates one grant-scoped Response Workspace under an active editor lease
and optimistic revision. Submission is an explicit confirmed operation that
freezes an immutable snapshot; it is not another autosave state.

## Submission contract

A submission succeeds only when all of the following remain true at the mutation
boundary:

- the response link resolves to its current, unexpired, non-revoked grant;
- the parent Content Request is both active and retained;
- `confirmed` is true;
- the supplied workspace revision is current;
- the caller owns the active editor lease and generation;
- no required upload or transcription operation for the selected answer mode
  remains unsettled; and
- the workspace is not already locked by another submission.

Batch and per-question drafts remain independent in the Response Workspace. If
both contain text or evidence, the respondent must choose **Answer all at once**
or **Answer one question at a time** in the confirmation dialog. The server
rejects a mixed-mode submission without that choice. When only one mode contains
material, the server selects it deterministically. The inactive draft remains
preserved in the locked workspace but is not copied into the Submission or sent
to Expert Synthesis.

The resulting Submission records the assigned Person attribution, request ID,
workspace revision, selected answer mode, whether selection was explicit or
single-mode deterministic, only the selected text model, ordered question copy
and versions, selected settled asset references and transcript versions, and the
server submission time. The workspace is then locked. Guest autosave and evidence
mutations reject further changes until an administrator reopens it.

Stable lifecycle errors include:

| Code                                 | Meaning                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `SUBMISSION_CONFIRMATION_REQUIRED`   | The explicit confirmation boundary was not satisfied.      |
| `SUBMISSION_MODE_SELECTION_REQUIRED` | Both answer modes contain material and require a choice.   |
| `SUBMISSION_CONTENT_REQUIRED`        | Neither answer mode contains material.                     |
| `REVISION_CONFLICT`                  | The submitted revision is stale.                           |
| `REQUIRED_OPERATIONS_PENDING`        | A required upload or transcription has not settled.        |
| `EDITOR_LEASE_REQUIRED`              | The submitting device does not own the active lease.       |
| `WORKSPACE_LOCKED`                   | The workspace is already frozen.                           |
| `WORKSPACE_NOT_LOCKED`               | An administrator attempted to reopen an editable draft.    |
| `GUEST_ACCESS_UNAVAILABLE`           | Expiry or revocation prevents reopening for further input. |
| `IDEMPOTENCY_KEY_REUSED`             | A retry key was reused for different operation input.      |
| `ARCHIVED_REQUEST`                   | The parent request is no longer retained as active.        |
| `EXPIRED_REQUEST`                    | The parent request disposition is no longer active.        |

Exact retries return the original submission, feedback, or reopen result. Failed
validation does not create a lifecycle operation, so the same retry key may be
used after the caller resolves a transient precondition such as an unsettled
upload.

## Administrator feedback and reopening

Administrator inspection is read-only. Feedback is a separate attributable
entity scoped to the workspace, an Interview Question, or a response asset; it
never rewrites respondent evidence. Workspace and question feedback is projected
with the text workspace. Asset feedback is projected only with its asset so the
guest sees it in the correct context.

Every feedback mutation records an idempotency operation, response timeline
event, and audit event attributed to the authenticated principal and credential.
Stored operation fingerprints are hashes and do not duplicate the feedback body.

Reopening removes only the workspace lock and advances its revision. It does not
update or delete any prior Submission. A later confirmed submission creates a new
snapshot, leaving all earlier evidence byte-for-byte unchanged.

## Media durability and access

Question-scoped evidence always uses a server-projected question identifier.
Expert Interview scopes must match a question in the request's immutable
Interview Package. A Standard Request owns one canonical prompt scope,
`standard-prompt:<contentRequestId>`, projected with the prompt into the guest
view, Response Workspace, administrator view, and Submission. The browser never
invents a fallback question identifier. Legacy Standard workspaces using the
former `request` placeholder are reconciled to the canonical identifier without
dropping their draft text.

Recordings are written to an owner-scoped IndexedDB queue before any upload
attempt. A failed upload or page loss therefore replays the retained bytes
against the same `clientAssetId`; an already-finalized server asset acknowledges
the replay without duplicating it, while a failed matching asset receives the
retained bytes through its retry path. Submission remains blocked until the
local queue is inspected and every required server operation settles or is
explicitly discarded.

Storage objects are claimed in a workspace-wide ownership registry before an
asset can finalize or delete them. Upload registration uses an opaque,
session-bound capability so a lease transition cannot strand a known object.
Because a browser can still disappear immediately after the storage service
returns an ID, an hourly maintenance job removes storage objects that remain
unclaimed after a 24-hour grace period. Existing guest-evidence and founder-voice
rows are checked as a migration-safe backstop before deletion.

Guest projections never include raw Convex Storage URLs. An authenticated
administrator inspection may resolve a download URL; expiration, revocation,
and invalid guest tokens therefore cannot leave a durable evidence-download
capability in the respondent's projection.

Grant activity cannot outlive its parent Content Request. Resolution returns the
safe unavailable/expired projection, and lease, autosave, submission, evidence
read/upload/retry, and transcription boundaries re-check the parent request in
the same transaction as the attempted operation. Archiving or expiring a request
does not delete its grants, Response Workspaces, assets, transcripts, feedback,
or Submissions. An upload that finishes after access closes is rejected and its
unattached storage object is deleted.

## Expert Synthesis provenance

Every immutable Submission must have an attributable include or exclude decision
before Expert Synthesis can be prepared. Preparation is a server mutation: the
backend reads the exact selected Submission snapshots, frozen asset and
transcript versions, latest Expert Interview context versions, package version,
operator instructions, and existing Deliverables. It canonicalizes that bundle,
computes its SHA-256 digest, persists the bundle, and signs a short-lived token
that identifies the persisted snapshot. A caller-provided digest is never the
source of truth. Preparation requires a stable correlation key. An exact retry
reuses the same canonical snapshot and token; the same key cannot be reused for
a different ordered included set or different synthesis instructions.

Completion resolves the signed token back to the stored processing snapshot,
revalidates the exact current included set plus the Interview package, context
versions, priority instructions, and existing Deliverables, and
creates either a new `blog_article` Deliverable or an immutable version on the
explicitly named article Deliverable. Provenance stores the processing snapshot
ID, canonical bundle, digest, selected Submission IDs, and context-version IDs.
An exact completion retry returns the original immutable result even after later
selection, request, or Deliverable drift.

Expert Interviews submitted through the legacy authenticated founder workspace
enter this same model. New founder submissions create a first-class founder
Submission snapshot. Historical founder submissions are projected through a
stable compatibility ID, so existing `job.input` work can be explicitly selected
without destructive backfill. Because those historical records did not freeze
their question wording or package version, the compatibility projection reports
that provenance as unavailable instead of attributing the current mutable
Interview questions. `job.complete` cannot bypass Expert Synthesis;
successful shared completion terminalizes the legacy job and links its resulting
Deliverable Version.

## Verification

Run the focused persistence and UI contracts with:

```sh
bunx vitest run convex/guestAccessLifecycle.test.ts convex/guestEvidence.test.ts \
  convex/storageMaintenance.test.ts \
  tests/contract/guest-submission-control.contract.test.tsx \
  tests/contract/guest-response-admin-panel.contract.test.tsx \
  tests/contract/guest-access-adapters.contract.test.ts --maxWorkers=1
```

The browser recovery scenario runs on Mobile WebKit and Desktop Chromium:

```sh
bunx playwright test tests/e2e/foundation.spec.ts \
  --grep "Ticket 06 recovers a failed recording upload from IndexedDB after page loss"
```

The synthesis/provenance and founder-migration contracts run with:

```sh
bunx vitest run convex/expertSynthesis.test.ts convex/agentJobs.test.ts \
  tests/contract/expert-synthesis.contract.test.ts \
  tests/contract/expert-interview-agent-interface.contract.test.ts \
  tests/contract/chatgpt-app.contract.test.ts
```
