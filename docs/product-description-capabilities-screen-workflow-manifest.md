# Product Description, Capabilities, Screen and Workflow Manifest

**Product:** <UNDETERMINES>
**Working category:** Expert Content Operations Platform  
**Document status:** Current-product description and multi-tenant SaaS target state  
**Last updated:** 2026-07-20

## 1. Executive description

This is a mobile-first content operations platform that turns discovered opportunities and direct content asks into attributable, research-backed, expert-led, publishable content.

The product begins where ordinary research reports and AI writing tools stop. It converts an opportunity into a durable `Content Request`; brings together the original source, a structured brief, research, citations, talking points, risks, and delivery requirements; collects the minimum irreplaceable expertise from a founder or subject-matter expert; coordinates agent drafting and human approval; produces versioned primary and derivative content; and tracks every required destination through verified delivery.

The long-term product is a multi-tenant SaaS content operating system. Each customer organization gets an isolated workspace in which people and agents can:

- discover, import, or create content opportunities;
- decide what is worth pursuing and in which formats;
- collect expert knowledge by text or voice, including offline;
- generate content that increasingly matches the organization's voice;
- ground content in a growing, governed bank of domain expertise;
- compose automated workflows from triggers, rules, approvals, transformations, and publishing adapters;
- publish and repurpose content across multiple destinations;
- track status, deadlines, delivery evidence, failures, and follow-ups;
- learn from edits, approvals, performance, and published work without silently changing approved content.

The core promise is:

> Turn every worthwhile opportunity into the right expert-backed content, in the right voice, for every useful channel—and prove that it got there.

## 2. Product motivation

### 2.1 The current problem

Organizations continuously find questions, journalist requests, community conversations, search opportunities, and digital-PR openings. Discovery is not the hard part. The breakdown occurs between discovery and execution:

- opportunities compete for attention inside reports, documents, inboxes, and chat threads;
- expert input is scarce, mobile, asynchronous, and easy to lose;
- researchers and writers lack the founder's context, judgment, or authentic phrasing;
- operators cannot see what needs expert input, drafting, approval, publication, or follow-up;
- AI drafts may be fast but generic, weakly grounded, or unlike the intended author;
- one strong idea is underused because adapting it for every channel is repetitive;
- copying content does not prove that it was published;
- revisions, approvals, destinations, and published versions become impossible to audit;
- disconnected automations hide failures and create ambiguous ownership.

The current repository was designed around the insight that the core problem is not content generation alone. It is the reliable orchestration of scarce human expertise, agent work, editorial control, and delivery.

### 2.2 Why the product should become a SaaS platform

The existing workflow is valuable beyond one founder and one organization. Agencies, founder-led companies, expert brands, communications teams, and content studios share the same operating problem but differ in:

- subject-matter experts and approval chains;
- brand voices and compliance rules;
- research sources and private knowledge;
- content formats and distribution channels;
- urgency, SLAs, and follow-up policies;
- automation tolerance and required human checkpoints.

A multi-tenant SaaS version turns those differences into configuration rather than forks. The invariant workflow remains deep and reliable, while each workspace composes its own roles, knowledge sources, pipelines, templates, policies, destinations, and approval gates.

## 3. Product principles

1. **One durable obligation, one Content Request.** A request is the system of record for why content exists, who owns it, what evidence supports it, which versions were approved, and where it must go.
2. **Human expertise is a high-value input, not production glue.** Experts contribute judgment, experience, examples, and voice; agents handle research, synthesis, drafting, and adaptation.
3. **AI output must be grounded and attributable.** Generated content should be traceable to source material, approved domain knowledge, and explicit expert input.
4. **Approved work never changes silently.** Regeneration creates a candidate version. Promotion is explicit and audited.
5. **Delivery requires evidence.** A request is complete only when every required destination has an active receipt or verifiable integration success.
6. **Follow-ups are first-class obligations.** Genuine new asks create linked child requests; reopening is reserved for incorrect confirmation or failed delivery.
7. **Automation remains observable.** Every run has status, ownership, logs, retries, checkpoints, and a recoverable failure path.
8. **Tenant isolation is structural.** Organization identity scopes every durable record, search, integration, secret, metric, and automation run.
9. **Mobile is a primary workspace.** Expert input, triage, approval, and status review must remain useful from a phone.
10. **Learning is governed.** Edits and published content can improve style and knowledge models, but customers control inclusion, provenance, retention, and deletion.

## 4. Users and roles

| Persona                         | Primary job                                                                               | Current role mapping         | SaaS evolution                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Subject-matter expert / founder | Supply authentic expertise and approve how it is represented                              | `founder`                    | Multiple experts, expertise areas, availability, delegation, approval policies                    |
| Operator / editor               | Triage opportunities, assign work, control quality, promote versions, and ensure delivery | `operator_editor`            | Content managers, agency editors, campaign owners, approvers                                      |
| Agent / automation worker       | Research, draft, transform, publish through verified integrations, and report outcomes    | `agent_editor`               | Managed workers, customer agents, provider-specific execution pools                               |
| Administrator                   | Manage identity, roles, credentials, policy, and exceptional operations                   | `administrator`              | Tenant provisioning, security, billing, data governance, integration administration               |
| Public viewer                   | Read a deliberately selected, revocable subset of a request                               | Token-based                  | Branded client review, external approval, expiring shares, optional comments                      |
| Platform operator               | Operate the SaaS across tenants without entering customer content by default              | Not currently a product role | Support controls, tenant health, metering, incident tooling, impersonation with consent and audit |

## 5. Capability map

### 5.1 Implemented product capabilities

The following capabilities are evidenced in the current application, backend model, tests, or maintained product specification.

#### Intake and opportunity management

- Minimal manual request creation with title as the only required field.
- Manual requests default to Critical priority.
- Deterministic ingestion of maintained scout reports.
- Atomic validation and upsert of complete ingestion batches.
- Normalized source-URL deduplication.
- Immutable original source snapshots and manual preservation on collisions.
- Request origins for manual, automated scout, private ChatGPT App, CLI, and HTTP interfaces.
- Opportunity triage with promote, pass, and snooze decisions.
- Format selection during routing and repurposing.
- Stable, human-readable request IDs and routes.
- Exact lookup, fuzzy search, filters, sorting, and pagination contracts.

#### Prioritization and work management

- Priorities: Critical, High, Normal, and Low.
- One accountable assignee plus optional watchers.
- Assignment history, audit attribution, and ownership-change rationale.
- Computed next-action queues: Needs Elie, Agent drafting, Needs operator, Delivered, and Attention required.
- Queue projection from durable evidence rather than a second hand-maintained status.
- Active, expired, and archived record handling.
- Linked parent/child follow-up requests.
- Notification center and transactional email outbox events for selected ownership and failure transitions.

#### Expert context and founder input

- Unified Context Canvas combining source material, summary, talking points, research requirements, missing research, citations, guardrails, operator cues, and delivery hints.
- Per-person, per-request visibility and pinning preferences.
- Compact and expanded founder editor states.
- Typed input with continuous autosave and Saved, Saving, Offline, Save pending, and Save blocked feedback.
- First-class voice recording with record, pause, resume, stop, upload, transcription, retry, and discard states.
- Offline audio queueing before upload.
- Automerge-backed offline text editing, cross-tab merge, reconnection sync, and content-addressed change history.
- Explicit submission only after durable synchronization.
- Founder-only raw draft visibility, with operators receiving progress metadata rather than private draft content.
- Undo, redo, bounded instant history, paginated immutable versions, and restore.
- Semantic conflict detection for singleton decisions such as assignee, primary deliverable, and promoted version.

#### Agent production and editorial control

- Durable primary-response agent jobs.
- Queued, running, retry-wait, failed, completed, and cancelled job states.
- Lease, heartbeat, reclaim, retry, exhaustion, and idempotent completion behavior.
- Versioned deliverables with candidate and promoted versions.
- Automatic promotion of the first successful draft.
- Explicit promotion for regenerated candidates.
- Exactly one primary response plus optional derivative deliverables.
- Audited primary designation changes before delivery.
- Prevention of silent replacement of an approved or delivered version.

#### Delivery, publishing evidence, and follow-up

- One delivery target per channel or concrete destination.
- The original obligation is required by default.
- Optional targets that can be promoted to required.
- Explicit “Mark responded” action; clipboard copy is never treated as delivery.
- Receipt linkage to the exact deliverable version used.
- Destination URL, note, timestamp, actor, confirmation method, and optional external receipt identity.
- Human confirmation and verified integration confirmation.
- Reopen while preserving immutable receipt history.
- Archive and restore for obsolete delivery targets.
- Responded status only when every active required target has an active receipt.
- Linked follow-up creation for genuinely new obligations.

#### Sharing, administration, and operations

- Revocable, unauthenticated, read-only public shares.
- Explicit selection of shareable brief sections and promoted deliverables.
- WorkOS authentication and organization membership.
- Founder, operator/editor, agent editor, and administrator authorization.
- Administrator QA projection into the founder workspace with retained attribution.
- Shared application operations exposed through the web UI, HTTP interface, CLI, and private ChatGPT App.
- Idempotency keys, structured errors, audit events, correlations, and operational telemetry.
- Product metrics for founder submission, ready response, delivery, expiration, failure, retry, rewrite rate, and cycle time.
- Installable responsive web application and service-worker-backed offline route support.

### 5.2 SaaS target capabilities

The following capabilities extend the current model and are proposed target-state features.

#### Workspace and tenant platform

- Self-serve organization creation, invitations, membership, and role administration.
- Multiple brands, teams, campaigns, clients, and expert pools inside one tenant.
- Tenant-specific taxonomy, custom fields, statuses, templates, SLAs, policies, and retention.
- Subscription plans, usage metering, quotas, invoices, and entitlements.
- Tenant-scoped encryption keys, secrets, audit export, data residency, and deletion policy.
- SSO/SAML, SCIM, domain verification, and service accounts for higher tiers.

#### Composable automation and pipelines

- Visual and declarative pipeline builder.
- Triggers from schedules, webhooks, opportunity ingestion, lifecycle changes, approvals, deadlines, delivery failures, and external events.
- Reusable nodes for research, enrichment, classification, routing, expert-input requests, generation, evaluation, transformation, approval, publication, status updates, notifications, and follow-up creation.
- Conditional branches, fan-out/fan-in, loops over formats or destinations, parallel execution, delay/wait nodes, and human checkpoints.
- Tenant-defined prompt, template, model, knowledge, budget, and compliance configuration per node.
- Versioned pipeline definitions, draft/published environments, test runs, replay, rollback, and change history.
- Per-run state, node-level status, logs, cost, latency, artifacts, retries, dead-letter handling, and manual recovery.
- Pipeline templates for common campaigns and channels.

#### Voice and domain intelligence

- Governed content corpus containing approved inputs, edits, deliverables, published content, performance, and reusable facts.
- Author and brand voice profiles learned from approved examples and editorial diffs.
- Domain Wiki with atomic claims, concepts, entities, examples, FAQs, citations, owners, freshness, confidence, and applicability.
- Retrieval of relevant knowledge and style guidance at generation time.
- Provenance shown alongside draft passages.
- Editorial feedback loop that distinguishes factual correction, style preference, structural preference, legal/compliance rule, and one-off edit.
- Knowledge conflict, expiry, and revalidation workflows.
- Workspace controls to include, exclude, pin, redact, export, or delete learning sources.

#### Broader publishing and repurposing

- First-party and webhook-based destination adapters for CMSs, social networks, newsletters, communities, CRM/PR systems, and document stores.
- Channel-aware derivative generation from a shared content package.
- Editorial calendars, scheduling, timezone handling, embargoes, and campaign windows.
- Destination previews, validation, account selection, UTM/link policy, metadata, media attachments, and accessibility checks.
- Publish-now, schedule, draft-only, approval-required, and manual-handoff delivery modes.
- Pullback, update, supersede, and correction workflows where supported by the destination.
- Inbound engagement tracking and automatic follow-up request creation.
- Performance feedback that informs future routing and repurposing without rewriting historical evidence.

## 6. Core domain and operating model

### 6.1 Core nouns

| Noun                 | Meaning                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization         | The tenant and top-level authorization, billing, policy, and data-isolation scope.                                                                                                  |
| Workspace            | A configurable operating area within an organization, such as a brand, client, team, or publication. The current product effectively has one workspace projection per organization. |
| Content Request      | The durable unit of work for one response or content obligation.                                                                                                                    |
| Source Snapshot      | Immutable evidence of the original opportunity or direct ask.                                                                                                                       |
| Context Item         | Structured briefing material used by experts, agents, and editors.                                                                                                                  |
| Founder/Expert Input | The single authoritative expert contribution document for a request.                                                                                                                |
| Knowledge Item       | A governed, reusable unit of domain expertise proposed for the Domain Wiki.                                                                                                         |
| Voice Profile        | A versioned set of learned stylistic tendencies and explicit editorial rules.                                                                                                       |
| Agent Job            | A durable production task claimed by an authenticated worker.                                                                                                                       |
| Deliverable          | A logical output, such as the primary response, blog article, or social post.                                                                                                       |
| Deliverable Version  | An immutable generated or edited revision of a deliverable.                                                                                                                         |
| Delivery Target      | A required or optional channel/destination for a selected deliverable.                                                                                                              |
| Delivery Receipt     | Immutable evidence that an exact version reached a target.                                                                                                                          |
| Pipeline Definition  | A versioned graph describing how work should be triggered, transformed, approved, and delivered.                                                                                    |
| Pipeline Run         | One durable execution of a published pipeline definition.                                                                                                                           |
| Follow-up Request    | A child Content Request representing a new obligation created by response, engagement, or operator action.                                                                          |

### 6.2 Content Request lifecycle

The current durable lifecycle is intentionally small:

```text
Pending
   │ meaningful expert draft
   ▼
In progress
   │ expert submits durably synced input / production begins
   ▼
Founder complete
   │ promoted primary deliverable exists
   ▼
Ready to respond
   │ all active required targets have receipts
   ▼
Responded
```

Lifecycle is orthogonal to:

- **Disposition:** Active or Expired.
- **Retention:** Active or Archived.
- **Priority:** Critical, High, Normal, or Low.
- **Operator queue:** Needs Elie, Agent drafting, Needs operator, Delivered, or Attention required.
- **Agent job status:** Queued, Running, Retry wait, Failed, Completed, or Cancelled.
- **Delivery target state:** Pending, Responded, Reopened, or Archived, with Required/Optional policy.
- **Automation run status (proposed):** Draft, Queued, Running, Waiting, Needs approval, Retry scheduled, Failed, Cancelled, or Completed.

The product should preserve this separation in the SaaS expansion. Pipelines and custom views may add labels, but must not introduce competing mutable statuses for facts that can be derived from durable evidence.

### 6.3 Computed operator queues

| Queue                     | Meaning                                                                                                   | Typical next action                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Needs Elie / Needs expert | Expert input is required or incomplete                                                                    | Open context, notify expert, capture response      |
| Agent drafting            | Expert input is complete and production is underway or claimable                                          | Monitor job, resolve research issue, retry failure |
| Needs operator            | A promoted primary response is ready but delivery is incomplete                                           | Review, approve, publish, or confirm target        |
| Delivered                 | Every required target has active delivery evidence                                                        | Review outcome, repurpose, measure, or close       |
| Attention required        | Conflict, failed/exhausted job, reopened delivery, invalid integration result, or other exceptional state | Resolve the specific reason and resume             |

## 7. Current screen manifest

### 7.1 Route-level screens

| Route / surface                                  | Audience                                             | Purpose                               | Primary capabilities and states                                                                                                                                                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                              | Any visitor                                          | Entry router                          | Redirects to the authenticated application boundary.                                                                                                                                                                                                         |
| `/sign-in`                                       | Signed-out users                                     | Authentication                        | Branded sign-in entry, return-to preservation, auth failure handling.                                                                                                                                                                                        |
| `/logout`                                        | Authenticated users                                  | Session termination                   | Signing-out progress and safe return behavior.                                                                                                                                                                                                               |
| `/unauthorized`                                  | Authenticated but unprovisioned users                | Access denial                         | Explains missing application role and directs the user to an administrator.                                                                                                                                                                                  |
| `/app`                                           | Authenticated users                                  | Application shell                     | Brand/navigation rail, current identity and role, notifications, workspace projection, logout, mobile navigation, route loading/error/not-found states.                                                                                                      |
| `/app/`                                          | Founder or operator projection                       | Work library / command center         | Role-specific library, search, filters, operator queues, list/grid/stack views, priority and progress signals, empty states, and direct navigation to stable request routes.                                                                                 |
| `/app/new`                                       | Operator, agent editor, administrator                | Manual intake                         | Create a Critical Content Request from a required title plus optional original question, source material, and source URL. Supports cancel and validation/error feedback.                                                                                     |
| `/app/requests/:requestId` — founder projection  | Assigned founder or administrator in founder QA view | Read context and contribute expertise | Unified Context Canvas, context controls, type/record mode, compact/expanded editor, autosave/offline states, voice queue/transcription states, submission, history, undo/redo, read-only expired/archived handling, and collaborative-editor loading state. |
| `/app/requests/:requestId` — operator projection | Operator, agent editor, administrator                | Triage and execute one opportunity    | Queue rail, assessment canvas, route/repurpose decisions, promote/pass/snooze, risk and brief review, attention reasons, read-only record notice, and advanced record/delivery administration.                                                               |
| `/share/:token`                                  | Unauthenticated external viewer                      | Read a curated public snapshot        | Token validation, revocation/not-found state, selected request summary, selected brief sections, and promoted public deliverables. No private drafts, candidate versions, internal notes, jobs, or audit data.                                               |

### 7.2 Operator request-detail modules

| Module                     | Purpose                                               | Principal actions                                                                                                                        |
| -------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Opportunity queue          | Preserve context while moving through triage          | Search/sort/filter queue, select opportunity, previous/next navigation, mobile queue drawer.                                             |
| Opportunity assessment     | Explain the opportunity and response strategy         | Review original question, why it matters, missing angles, proposed response, research, risk, source, and timing.                         |
| Route and repurpose panel  | Turn an opportunity decision into configured work     | Select expert, choose formats, add handoff context, promote, pass, or snooze.                                                            |
| Attention panel            | Surface exceptional durable state                     | Read specific attention reasons and navigate to the responsible control.                                                                 |
| Semantic conflict panel    | Resolve incompatible singleton changes                | Compare current and proposed assignee/primary/promoted-version values, choose a recorded value, retain audit history.                    |
| Lifecycle and related work | Control record disposition without destroying history | Archive/restore, inspect expiry, review parent/children, create linked follow-up.                                                        |
| Deliverables               | Control logical outputs and immutable versions        | Review Primary/Promoted/Candidate state, create derivatives and versions, promote candidate, select primary.                             |
| Delivery checklist         | Track every destination and proof                     | Add target, mark required/optional, select version, confirm response, record URL/note, reopen, archive/restore, inspect receipt history. |
| Public sharing             | Create a safe external review surface                 | Select brief sections and deliverables, create/copy/revoke links.                                                                        |
| Assignment                 | Maintain accountable ownership                        | Reassign, add/remove watchers, record ownership-change reason.                                                                           |

### 7.3 Shared and transient screens/states

- Desktop navigation rail and mobile navigation drawer.
- Notification popover with empty and unread states.
- Administrator “view as founder” QA banner and return action.
- Route-level pending skeleton, error recovery, and not-found surfaces.
- Offline, reconnecting, save-pending, and save-blocked states.
- Voice permission denied, recording, paused, queued, uploading, transcribing, failed, retry, and discard states.
- Read-only archived or expired request state.
- Confirmation and error feedback for consequential operations.
- Mobile route/repurpose bottom sheet and sticky decision action bar.

## 8. Proposed SaaS screen manifest

These screens extend the current product. They should reuse the existing request canvas, operator triage, deliverable, delivery, notification, and share modules rather than creating parallel implementations.

### 8.1 Tenant, team, and administration

| Screen                  | Purpose                                 | Key workflows                                                                                                                                              |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization onboarding | Create the tenant and reach first value | Name organization, choose use case, create first workspace, invite team, connect one source and one destination, import examples, launch starter pipeline. |
| Workspace switcher      | Move between brands, clients, or teams  | Switch context, pin recent workspaces, show role/plan restrictions.                                                                                        |
| Members and roles       | Govern human and agent access           | Invite, deactivate, assign workspace roles, create service accounts, review last activity.                                                                 |
| Brands and voice        | Manage explicit and learned style       | Brand rules, author profiles, approved examples, banned patterns, profile versions, preview/test.                                                          |
| Knowledge sources       | Configure the Domain Wiki corpus        | Connect sources, upload/import, crawl/sync, set ownership and freshness, inspect ingestion errors.                                                         |
| Integrations            | Manage source and sink adapters         | OAuth/API setup, account and destination selection, health checks, scopes, secret rotation, webhook status.                                                |
| Policies and approvals  | Define governance                       | Required reviewers, regulated claims, prohibited topics, automation limits, publishing modes, retention.                                                   |
| Usage and billing       | Understand consumption                  | Seat/agent usage, runs, tokens/model spend, storage, destinations, plan limits, invoices.                                                                  |
| Audit and security      | Inspect consequential activity          | Actor, operation, resource, correlation, IP/device, export, retention, support-access records.                                                             |

### 8.2 Knowledge and learning

| Screen                 | Purpose                                           | Key workflows                                                                                                   |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Domain Wiki home       | Browse reusable organizational expertise          | Search concepts, entities, claims, examples, FAQs, owners, freshness, and linked content.                       |
| Knowledge item detail  | Govern one reusable fact or principle             | Edit with citations, approve, supersede, set applicability, resolve conflict, see usage history.                |
| Knowledge review queue | Keep retrieval trustworthy                        | Review AI-extracted candidates, stale claims, contradictions, weak provenance, and requested expert validation. |
| Voice profile detail   | Explain and control learned style                 | Review characteristics, source examples, editorial rules, confidence, exclusions, and version history.          |
| Learning inbox         | Convert editorial behavior into reusable guidance | Classify diffs as factual, voice, structure, compliance, or one-off; approve/reject proposed rules.             |
| Corpus explorer        | Inspect what the AI may retrieve                  | Filter by source, author, workspace, permissions, sensitivity, date, and inclusion state.                       |

### 8.3 Pipelines and automation

| Screen                    | Purpose                            | Key workflows                                                                                                              |
| ------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Pipeline library          | Find and manage automations        | Browse templates and custom pipelines, status, owner, trigger, last run, success rate, cost.                               |
| Pipeline builder          | Compose a versioned workflow graph | Add trigger/action/condition/wait/approval/publish nodes; configure edges, variables, retry, timeout, knowledge and voice. |
| Node configuration drawer | Configure one deep node interface  | Choose adapter, account, inputs, mappings, prompt/template, model, budget, validation, output contract.                    |
| Pipeline test bench       | Validate before publishing         | Run with fixture or existing request, inspect artifacts, mock destinations, compare versions, assert invariants.           |
| Pipeline version/release  | Govern changes                     | Draft, review diff, publish, roll back, clone, archive, environment promotion.                                             |
| Automation runs           | Operate all executions             | Filter by status/pipeline/request/owner/time, bulk retry/cancel, inspect stuck work and cost.                              |
| Run detail                | Diagnose one execution             | Timeline/graph status, node inputs and outputs with redaction, logs, artifacts, approvals, retry/replay/skip controls.     |
| Approval inbox            | Centralize human checkpoints       | Preview content and evidence, approve/reject/request changes, reassign, enforce SLA and escalation.                        |

### 8.4 Publishing, calendar, and performance

| Screen              | Purpose                                     | Key workflows                                                                                                         |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Content package     | Manage a source idea and all derivatives    | Primary narrative, derivatives, target mapping, consistency checks, shared claims, media, and campaign metadata.      |
| Repurpose studio    | Generate and edit channel-specific variants | Select formats, preview constraints, regenerate selected section, compare against source, preserve claim consistency. |
| Publishing calendar | Plan and schedule distribution              | Day/week/month views, drag with policy validation, embargoes, timezone, conflicts, campaign filters.                  |
| Destination preview | Validate exact outbound payload             | Account, rendered preview, metadata, links, media, accessibility, compliance, schedule, final approval.               |
| Delivery operations | Track all outbound obligations              | Pending, scheduled, publishing, published, failed, reopened, evidence, retry, manual handoff, owner and SLA.          |
| Engagement inbox    | Turn responses into action                  | Comments, questions, journalist replies, failures, mentions, sentiment, assign or create linked follow-up.            |
| Content analytics   | Measure outcome and improve routing         | Reach, engagement, conversion, response rate, channel/format performance, repurpose lift, learning suggestions.       |

## 9. Current end-to-end workflows

### 9.1 Manual urgent request

1. An operator opens **New request**.
2. They enter a title and optionally preserve the original question, body, and source URL.
3. The system creates a manual, Critical request with immutable source evidence and a stable human-readable route.
4. The operator selects an accountable founder/expert and optional watchers.
5. Assignment history and audit events are recorded; agreed transitions can create in-app/email notifications.
6. The request enters **Needs Elie**.
7. The expert opens the direct link on mobile or desktop, reviews the Context Deck, hides or pins items, and contributes text or voice.
8. Drafts save continuously; offline changes and queued recordings synchronize after reconnection.
9. The expert explicitly submits only after the founder-input document is durably synchronized.
10. The request enters **Agent drafting** and a durable job becomes claimable.
11. An agent claims the job, heartbeats its lease, creates a primary deliverable version, and completes or reports a retryable/permanent failure.
12. The first successful version is promoted automatically; later regenerations remain candidates until explicitly promoted.
13. The request enters **Needs operator**.
14. The operator reviews the promoted version, creates derivative deliverables if useful, and configures delivery targets.
15. For each target, the operator or verified integration publishes the exact promoted version and records evidence.
16. When every required target has an active receipt, the request becomes **Responded** and appears in **Delivered**.

### 9.2 Automated scout opportunity

1. The opportunity scout produces its maintained Markdown report.
2. A separate orchestration step hands the complete artifact to the ingestion interface with a stable idempotency key.
3. The ingestion layer validates the entire report before mutation.
4. URLs are normalized; repeated opportunities are deduplicated; immutable snapshots are preserved.
5. Research is converted into structured context items.
6. The operator opens the triage inbox and reviews the opportunity assessment.
7. The operator chooses one decision:
   - **Promote:** select expert, formats, and optional handoff context; create configured work.
   - **Pass:** record that the opportunity should not proceed.
   - **Snooze:** defer the decision for the configured interval.
8. A promoted opportunity proceeds through expert input, agent drafting, editorial promotion, delivery, and receipt tracking as above.
9. If a later manual request matches an automated opportunity, the system preserves the immutable source and upgrades the request's operational priority rather than creating an uncontrolled duplicate.

### 9.3 Expert offline text and voice submission

1. The expert opens an assigned request and receives the source, brief, and their permitted draft state.
2. Context preferences load for that expert and request.
3. Typed changes enter the local Automerge document and an owner-scoped write-ahead path.
4. With connectivity, bounded changes sync to the authenticated Convex transport; without it, the UI remains editable and reports Offline.
5. Voice is captured into an owner-scoped local queue before upload.
6. After connectivity returns, audio uploads, transcription runs, and the transcript is appended only after durable synchronization.
7. Ordinary concurrent text changes merge automatically.
8. Incompatible singleton changes become visible semantic conflicts instead of last-write-wins loss.
9. Submit waits for durable text and pending voice resolution, then creates one submission boundary.

### 9.4 Drafting, regeneration, and promotion

1. Submitted expert input makes the production job claimable.
2. A worker claims the job with a bounded lease and heartbeats while active.
3. The worker uses the request's permitted context and founder submission to generate a primary response.
4. Completion creates an immutable deliverable version.
5. The first successful version becomes promoted automatically.
6. A regeneration creates a new candidate and does not alter the promoted version.
7. An authorized editor compares versions and explicitly promotes the chosen candidate.
8. If concurrent actors propose incompatible promotions, both values are retained in Attention required for resolution.

### 9.5 Delivery, reopening, and follow-up

1. The original destination exists as a required delivery target.
2. The operator may add optional derivative targets or mark selected targets required.
3. A target is fulfilled manually or through an authenticated integration returning verifiable success.
4. The receipt records the exact deliverable version, destination, time, actor/integration, and supporting details.
5. All required receipts project the request to Responded.
6. If confirmation was wrong or delivery later failed, the target is reopened; the old receipt remains immutable and the request returns to the appropriate queue.
7. If the recipient asks a genuinely new question, the operator creates a linked child Content Request rather than rewriting the original history.

### 9.6 Public share

1. An authorized operator chooses the brief sections and promoted deliverables safe to expose.
2. The system creates an opaque public token and immutable share snapshot.
3. The external viewer opens a read-only, unauthenticated page.
4. Private founder input, internal notes, jobs, candidates, audit history, and unselected context remain unavailable.
5. The operator can revoke access immediately without mutating the underlying request.

## 10. Proposed automation and pipeline workflow

### 10.1 Pipeline composition model

A pipeline is a versioned directed graph behind a small execution interface:

```text
Trigger → Qualify → Enrich → Route → Request expert input → Generate
                              │                         │
                              └──── reject/snooze ─────┘

Generate → Evaluate → Human approval → Fan out derivatives → Publish
                         │                                  │
                         └── changes requested ─────────────┘

Publish → Capture receipts → Monitor engagement → Create follow-ups → Learn
```

The public interface should remain compact:

- `publish(definitionVersion)` validates and activates a pipeline version;
- `start(triggerEvent)` creates or deduplicates one run;
- `signal(runId, event)` resumes approvals, waits, webhooks, and external callbacks;
- `retry(runId, nodeId)` retries from a safe checkpoint;
- `cancel(runId)` prevents new work while preserving history;
- `inspect(runId)` returns status, artifacts, cost, evidence, and next action.

Complex provider behavior belongs behind adapters at explicit seams: trigger, knowledge retrieval, model execution, evaluation, notification, publishing destination, analytics, and secret storage. A second real adapter justifies each seam; customer-visible node configuration must not expose provider implementation complexity.

### 10.2 Pipeline authoring workflow

1. An operator starts from a template or blank pipeline.
2. They choose a trigger, such as a scout ingestion, new request, schedule, webhook, lifecycle transition, content age, engagement event, or delivery failure.
3. They add nodes and map typed outputs to typed inputs.
4. Each generation node selects content objective, format, voice profile, Domain Wiki scope, model policy, budget, and validation rules.
5. Each consequential action selects its approval rule and recovery owner.
6. Each publishing node selects destination account, payload mapping, schedule policy, and receipt requirements.
7. The builder validates unreachable nodes, incompatible mappings, missing secrets, cycles, unbounded fan-out, absent failure owners, and publication without evidence.
8. The operator runs the pipeline against fixtures or an existing request in a sandbox that mocks external writes.
9. Reviewers inspect the graph and configuration diff.
10. A published immutable version handles new runs; active runs remain pinned to their starting version unless explicitly migrated.

### 10.3 Run operation and recovery

1. A trigger produces a tenant-scoped, idempotent event.
2. The system creates a run and records definition version, actor, correlation, budget, and initial inputs.
3. Ready nodes execute in parallel where dependencies permit.
4. Every node records Queued, Running, Waiting, Needs approval, Retry scheduled, Failed, Cancelled, Skipped, or Completed.
5. Retries follow node policy with backoff and a bounded attempt count.
6. Permanent or exhausted failures enter a dead-letter/Attention required queue with a named owner.
7. Operators can retry, replay from a checkpoint, replace an invalid input, skip an optional node, or cancel. Each intervention is audited.
8. Delivery nodes complete only after durable receipts are stored.
9. Run completion summarizes outputs, cost, latency, exceptions, publication evidence, and linked follow-ups.

### 10.4 Status tracking and follow-ups

Status tracking should answer five questions without opening logs:

1. What is the current durable state?
2. Who or what owns the next action?
3. What deadline or SLA applies?
4. What evidence is missing?
5. What is the safe recovery action?

Follow-up policy can be configured by event:

- expert has not opened an assignment;
- expert draft has stalled;
- approval is approaching or past SLA;
- scheduled publication failed;
- required delivery lacks a receipt;
- a destination returns an inbound question;
- published content reaches a performance threshold;
- a Domain Wiki claim is stale or contradicted.

Actions may notify, escalate, reassign, wait, retry, create a task, or create a linked Content Request. Automations must deduplicate reminders and stop automatically when the underlying condition is resolved.

## 11. Proposed voice and Domain Wiki workflow

### 11.1 The LLM Wiki pattern

The Domain Wiki is not a folder of documents or an opaque embedding index. It is a governed knowledge layer with two related representations:

- **Source corpus:** immutable or versioned documents, transcripts, published content, approved deliverables, and structured imports.
- **Knowledge graph/wiki:** atomic claims, concepts, entities, examples, procedures, opinions, FAQs, policies, citations, owners, applicability, and freshness derived from or authored against those sources.

Every retrievable item carries organization/workspace scope, provenance, permissions, sensitivity, status, valid-from/valid-to, and source links. Generated drafts reference knowledge item IDs and versions so an editor can inspect why a claim appeared.

### 11.2 Knowledge acquisition workflow

1. A tenant connects a source, imports files, records an expert session, or approves a deliverable for learning.
2. The ingestion pipeline parses, chunks, classifies sensitivity, and preserves source identity.
3. AI proposes atomic knowledge items and relationships with citations and confidence.
4. Low-risk duplicates can merge automatically under policy; contradictions, weak provenance, or high-impact claims enter Knowledge review.
5. An owner approves, rejects, edits, or limits applicability.
6. Approved items become eligible for retrieval in the selected workspace, brand, expert, and content contexts.
7. Freshness jobs request revalidation or mark items stale without deleting historical use.

### 11.3 Voice learning workflow

1. The tenant selects approved examples for a brand or author voice profile.
2. The system extracts explainable tendencies: tone, sentence shape, vocabulary, rhetorical devices, pacing, formatting, calls to action, risk posture, and phrases to prefer or avoid.
3. Editorial diffs are classified. A corrected fact updates knowledge; a recurring style edit proposes a voice rule; a compliance edit proposes policy; a one-off preference stays local.
4. Proposed rules enter the Learning inbox rather than silently changing the profile.
5. Approved rules create a new immutable voice-profile version.
6. Generation records which profile version was used.
7. A/B evaluations compare adherence, editor rewrite rate, factuality, and audience outcome.
8. Customers can remove a source and rebuild affected profile versions, subject to retention/audit obligations.

### 11.4 Generation-time grounding

For every draft or derivative, the content node should assemble a bounded context package:

- immutable request source;
- submitted expert input;
- relevant approved Domain Wiki items;
- relevant citations and freshness/confidence metadata;
- selected voice profile version;
- format and destination constraints;
- compliance and brand policy;
- previous promoted content needed for consistency.

The output contract should include content, cited knowledge item IDs, unresolved questions, policy warnings, style score, and suggested derivatives. Unsupported factual claims should fail evaluation or require explicit approval.

## 12. Proposed publishing and repurposing workflow

### 12.1 Content package model

A Content Request may produce a Content Package: one approved narrative and a graph of channel-specific derivatives. Derivatives are linked to their source deliverable/version and reuse shared claims, links, media, campaign metadata, and voice profile while allowing channel-specific structure.

Example package:

```text
Primary expert response
├── Blog article
├── LinkedIn post
├── X thread
├── Newsletter section
├── Reddit/community answer
├── Short-video script
├── Carousel/infographic copy
└── Follow-up FAQ / knowledge items
```

### 12.2 Repurpose workflow

1. The operator or pipeline chooses output formats during triage or after primary approval.
2. The system creates derivative deliverables tied to the promoted source version.
3. Each derivative receives channel constraints, audience, objective, CTA, length, metadata, and selected voice.
4. Generation reuses approved claims and preserves traceability rather than summarizing an arbitrary draft.
5. Cross-package evaluation checks claim consistency, repetition, cannibalization, link policy, compliance, and voice.
6. Editors may approve individually or as a package according to policy.
7. Updating the primary creates “source changed” signals; it does not silently overwrite derivative candidates or already published versions.

### 12.3 Publishing workflow

1. A destination adapter validates authentication, scopes, account, payload, media, metadata, and destination constraints.
2. The user previews the exact outbound representation.
3. Policy determines whether the item may publish automatically, needs approval, schedules for later, or requires manual handoff.
4. The system records the exact deliverable version and outbound payload hash before dispatch.
5. The adapter returns a provider result containing external ID, canonical URL where available, timestamp, and verifiable success metadata.
6. The system stores an immutable delivery receipt and updates the required-target projection.
7. Retryable failures follow bounded backoff; permanent failures enter Delivery operations with provider-safe remediation.
8. Corrections create new versions and destination-specific update/supersede actions. Historical receipts remain intact.

### 12.4 Distribution adapter classes

- **CMS:** WordPress, Webflow, Contentful, Sanity, headless CMS webhooks.
- **Social:** LinkedIn, X, Facebook, Instagram, Threads, Bluesky, Mastodon.
- **Community:** Reddit and destination-specific manual/assisted handoff where automated posting is restricted or inappropriate.
- **Email:** HubSpot, Mailchimp, Customer.io, Klaviyo, Beehiiv, ConvertKit.
- **PR and expert response:** journalist platforms, CRM, shared inbox, or verified email dispatch.
- **Collaboration/document:** Google Docs, Notion, Slack/Teams review, generic webhook, S3/object export.
- **Media:** video/script queues, asset generation systems, podcast workflows, DAMs.

Availability depends on provider terms and authorization. A manual delivery adapter remains a valid first-class path and still requires explicit evidence.

## 13. Multi-tenant SaaS architecture

### 13.1 Tenancy and isolation

The current model already stores `organizationId` on principals and operational records and uses organization-scoped indexes. SaaS expansion should make the invariant universal:

- every customer-owned aggregate includes an immutable tenant identifier;
- every application operation derives tenant scope from authenticated identity, never caller-provided authority alone;
- every unique key and idempotency key is tenant-scoped;
- search, vector retrieval, caches, object storage, analytics, logs, queues, and exports preserve tenant scope;
- integration credentials and encryption context are tenant/workspace scoped;
- platform-support access is time-bounded, consented, least-privilege, and audited;
- deletion and export traverse all derived artifacts, knowledge indexes, voice profiles, and provider references.

### 13.2 Deep modules and seams

| Module                | Small external interface                            | Hidden implementation depth                                                                             |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Request Operations    | create, assign, submit, transition, relate, archive | tenancy, authorization, invariants, version preconditions, audit, notifications, projections            |
| Knowledge             | ingest, retrieve, review, supersede                 | parsing, chunking, provenance, conflict detection, freshness, permissions, indexes                      |
| Voice                 | build profile, evaluate, activate                   | example selection, diff classification, rule extraction, versioning, scoring                            |
| Pipeline Runtime      | publish, start, signal, retry, cancel, inspect      | graph scheduling, leasing, checkpoints, idempotency, budgets, retries, dead letters, audit              |
| Content Production    | generate, evaluate, promote                         | prompt assembly, model routing, knowledge retrieval, voice application, citations, candidate versioning |
| Delivery              | validate, dispatch, confirm, reopen                 | provider adapters, payload mapping, rate limits, webhooks, receipt proof, retry classification          |
| Follow-up             | evaluate policy, schedule, resolve                  | deduplication, SLA timers, escalation, notification routing, linked-request creation                    |
| Tenant Administration | provision, authorize, meter, export, delete         | identity providers, entitlements, quotas, billing, residency, audit, cascading lifecycle                |

Adapters should exist where behavior genuinely varies: identity provider, model provider, source connector, destination connector, notification transport, billing provider, object store, search/vector store, and analytics source. Core lifecycle, promotion, receipt, tenant isolation, and audit invariants remain provider-independent.

### 13.3 Data-model additions

Proposed top-level records include:

- workspaces, brands, campaigns, teams, memberships, invitations, entitlements;
- integration installations, destination accounts, webhook endpoints, encrypted secret references;
- pipeline definitions, versions, nodes, edges, runs, node attempts, waits, approvals, artifacts, dead letters;
- source connectors, corpus documents, knowledge items, knowledge versions, citations, conflicts, review tasks;
- voice profiles, profile versions, style rules, learning examples, classified editorial diffs;
- content packages, derivative relations, schedules, outbound payloads, engagement events;
- follow-up policies, reminders, escalations, SLA clocks;
- subscriptions, usage meters, invoices, quota events;
- tenant export and deletion jobs.

High-volume run logs, model traces, and provider payloads should not inflate the request aggregate. Store durable summaries and references with retention policy, keeping the request interface small and operationally useful.

## 14. Product metrics

### 14.1 Existing outcome metrics

- Time from assignment to expert submission.
- Time from expert submission to ready response.
- Time from ready response to delivery.
- Delivery-before-expiration rate.
- Drafting failure and retry rate.
- Percentage of agent drafts delivered without substantial rewrite.
- Rewrite rate and median cycle times.

### 14.2 SaaS and automation metrics

- Activation: first workspace, first connected source, first approved content, first verified delivery.
- Weekly active operators and experts.
- Opportunities triaged and promotion rate.
- Expert minutes per delivered content package.
- Pipeline success, intervention, replay, and dead-letter rate.
- Approval latency and SLA breach rate.
- Cost and latency per delivered asset/package.
- Voice-adherence score and editorial rewrite reduction by profile version.
- Knowledge citation coverage, stale-claim rate, and contradiction resolution time.
- Repurpose multiplier: delivered derivatives per approved primary.
- Verified publishing rate and destination failure rate.
- Follow-up conversion and response time.
- Retention by tenant cohort and expansion by workspaces, seats, destinations, and run volume.

## 15. Recommended product rollout

### Phase 1 — Productize the existing operating system

- Generalize /Elie labels into configurable organization, brand, and expert terminology while preserving current defaults.
- Add self-serve tenant/workspace provisioning and invitation flows.
- Enforce universal tenant scoping and add isolation tests for every application operation.
- Add integration installation management and a generic verified webhook/manual delivery adapter.
- Expose current status, ownership, deadlines, and evidence in a unified operations view.

### Phase 2 — Content intelligence

- Add corpus ingestion, Domain Wiki review, citations, freshness, and permissions.
- Add explicit brand/author voice profiles and learning-source governance.
- Record structured editorial diffs and launch the Learning inbox.
- Ground agent production in versioned knowledge and voice packages.

### Phase 3 — Composable pipelines

- Introduce versioned pipeline definitions and the runtime state machine.
- Ship starter templates over existing intake, expert-input, drafting, approval, delivery, and follow-up operations.
- Add test bench, run detail, retries, dead letters, budgets, and approval inbox.
- Keep the current application services as the execution interface rather than duplicating business rules inside nodes.

### Phase 4 — Broad publishing and repurposing

- Add the Content Package and Repurpose Studio.
- Ship a small set of high-value destination adapters plus generic webhook/manual adapters.
- Add destination previews, scheduling, receipts, corrections, and delivery operations.
- Ingest engagement events and create governed follow-up automations.

### Phase 5 — Enterprise and ecosystem

- SSO/SAML, SCIM, residency, customer-managed keys, advanced audit/export, and support-access controls.
- Adapter SDK and marketplace with certification, permission, and observability requirements.
- Agency/client portals, cross-workspace templates, chargeback, and portfolio reporting.
- Experimentation and outcome-aware routing with explicit governance.

## 16. Evidence and scope notes

This document distinguishes current product behavior from proposed SaaS behavior. The current-state description is grounded primarily in:

- [`README.md`](../README.md)
- [`specs/fairlend-content-requests-v1.md`](../specs/fairlend-content-requests-v1.md)
- [`convex/schema.ts`](../convex/schema.ts)
- [`src/routes/app.index.tsx`](../src/routes/app.index.tsx)
- [`src/routes/app.requests.$requestId.tsx`](../src/routes/app.requests.$requestId.tsx)
- [`docs/opportunity-automation.md`](./opportunity-automation.md)
- [`docs/operator-content-request-interface.md`](./operator-content-request-interface.md)

The additional pipeline, Domain Wiki, voice-learning, publishing, repurposing, billing, and enterprise administration screens are target-state product requirements, not claims that those screens are already implemented. The current product deliberately defaults broad external publication to manual delivery plus explicit confirmation; automatic publication should be introduced only through authenticated destination adapters that return durable, verifiable success.
