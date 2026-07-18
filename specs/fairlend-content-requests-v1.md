# FairLend Content Requests V1

Status: Approved product specification
Canonical prototype: Variant G — Unified Canvas
Primary users: Elie (Founder), FairLend operators/editors, and authenticated agents

## Problem Statement

FairLend continuously discovers community questions, journalist requests, media opportunities, and digital-PR opportunities that could benefit from an expert response. The existing opportunity scout can find and research these opportunities, but the resulting Markdown report is not an effective execution system. The opportunities compete for attention inside documents, Elie does not consistently have time to turn them into founder-authored responses, and operators cannot reliably tell which items require founder input, agent drafting, publication, or no further action.

The core problem is not content generation alone. FairLend needs a durable workflow that gets the minimum irreplaceable input from Elie, gives him enough context to respond quickly from a phone, lets agents perform the research and production work, and gives operators a precise action queue through final delivery.

The system must support both automatically discovered opportunities and manually created requests. Manual requests must take priority. It must preserve original source material, support offline founder input, provide strong version history, and expose a complete automation surface through a CLI, HTTP API, and private ChatGPT App. The human-facing frontend should remain a presentation, persistence, and communication layer; expensive research, synthesis, and drafting work belongs to agents.

The system also needs a precise definition of completion. Elie submitting his input is not the same as an agent producing a response, and neither event proves that the response was actually posted. Operators need to distinguish founder work, agent work, and operator delivery work without manually reconstructing state from drafts or conversations.

## Solution

Build a mobile-first Content Requests application for FairLend using TanStack Start, Convex, Tailwind CSS, shadcn/ui with the RHEA preset, WorkOS authentication, and first-class Automerge offline support.

A Content Request is the durable unit of work for one response obligation. It contains immutable source material, an agent-produced brief, optional research and citations, Elie's single founder-input document, one primary response deliverable, optional derived deliverables, delivery targets, delivery receipts, assignment, priority, lifecycle state, expiration metadata, and a complete audit trail.

Elie receives a prioritized stack of assigned Content Requests. Variant G's Unified Canvas is the canonical interaction model: the context deck occupies the available reading surface while the founder-input editor remains immediately available in a compact state and can expand into a focused writing or recording surface. Context items can be toggled and pinned. The input mode can switch between keyboard and microphone. Work autosaves and remains usable offline.

Operators receive computed action queues rather than a generic status board. The workspace makes it immediately clear which requests need Elie, which are being drafted by an agent, which are ready for an operator to deliver, which need attention, and which have been delivered. Every delivery channel has a Responded checklist item. Required channels determine whether the Content Request is Responded.

Agents receive full system control through a shared application contract exposed by the CLI, HTTP API, and private ChatGPT App. Agents can create and update requests, manage context, assignments, jobs, deliverables, versions, delivery targets, share links, and archives. They cannot edit immutable source text or founder raw input, cannot silently replace an approved response with a regeneration, and cannot hard-delete ordinary records. All mutations are attributed and auditable.

The opportunity automation produces its maintained Markdown report first. A separate ingestion step validates the entire report and atomically upserts Content Requests. The ingestion layer normalizes source URLs, deduplicates repeated opportunities, preserves original input, converts research into structured context, and upgrades a matching automated request to manual and Critical when an operator creates it manually.

## User Stories

1. As Elie, I want assigned Content Requests sorted by urgency and priority, so that I can work on the most valuable opportunity first.
2. As Elie, I want manual requests to appear above automatically generated requests, so that direct operator asks never get buried.
3. As Elie, I want to view my requests as a swipeable stack, so that I can triage them quickly on a phone.
4. As Elie, I want to switch the stack to a grid, so that I can scan more requests at once.
5. As Elie, I want each request card to show its title, age, urgency, source, and progress, so that I can decide whether to open it.
6. As Elie, I want opening a card to navigate to a dedicated request URL, so that the request has a stable destination.
7. As Elie, I want the original question and source material available in the brief, so that I understand the request without leaving the application.
8. As Elie, I want an agent-condensed summary of long source material, so that I can understand the situation quickly.
9. As Elie, I want prepared talking points, so that I can focus on adding expertise rather than structuring an answer.
10. As Elie, I want research and citations adjacent to the request, so that I can speak accurately and confidently.
11. As Elie, I want missing research and open questions called out separately, so that I know where uncertainty remains.
12. As Elie, I want response guardrails displayed with the brief, so that I avoid unsupported claims, compliance mistakes, or undisclosed affiliation.
13. As Elie, I want to toggle context items on and off, so that the Unified Canvas contains only what is useful for the current response.
14. As Elie, I want to pin important context items, so that they remain available while I move through the deck.
15. As Elie, I want pinned speaking notes to display their complete content, so that critical details are never hidden by truncation.
16. As Elie, I want the founder-input editor visible in a compact state beneath the context deck, so that I can begin immediately without abandoning the brief.
17. As Elie, I want to expand the editor into a focused surface, so that longer writing or recording is comfortable.
18. As Elie, I want the context deck to yield space to the expanded editor without a draggable divider, so that the mobile interaction remains deliberate and stable.
19. As Elie, I want to switch between keyboard and microphone input, so that I can respond in the mode that is most convenient.
20. As Elie, I want recording state and elapsed time to be unambiguous, so that I know whether my input is being captured.
21. As Elie, I want my work to autosave, so that I never need to manage draft persistence manually.
22. As Elie, I want to continue editing while offline, so that unreliable connectivity does not block founder input.
23. As Elie, I want offline changes to synchronize automatically after reconnection, so that I do not need to reconcile devices manually.
24. As Elie, I want a clear saved, saving, or offline indicator, so that I know the durability of my latest input.
25. As Elie, I want to undo and redo changes, so that experimentation is safe.
26. As Elie, I want my founder input to remain a single submission regardless of downstream formats, so that my responsibility stays simple.
27. As Elie, I want to submit my founder input explicitly, so that the system knows when agents may begin drafting.
28. As Elie, I want a submitted request to leave my active queue, so that my remaining work is obvious.
29. As Elie, I want direct links from assignment notifications, so that I can open the exact request immediately.
30. As an operator, I want to create a Content Request manually with only the necessary fields, so that urgent asks are quick to capture.
31. As an operator, I want optional fields to remain optional, so that incomplete context never blocks request creation.
32. As an operator, I want every manual request to default to Critical, so that it outranks discovered opportunities.
33. As an operator, I want to assign exactly one accountable owner, so that responsibility is unambiguous.
34. As an operator, I want to add optional watchers, so that collaborators can follow progress without becoming accountable owners.
35. As an operator, I want reassignment to preserve history, so that ownership changes remain auditable.
36. As an operator, I want to see whether and when a request was opened, so that I can distinguish unseen work from stalled work.
37. As an operator, I want to see whether an autosaved founder draft exists, so that I can understand progress without reading private draft content unnecessarily.
38. As an operator, I want a Needs Elie queue, so that I can see founder obligations.
39. As an operator, I want an Agent drafting queue, so that I can see submitted inputs awaiting production.
40. As an operator, I want a Needs operator queue, so that ready responses requiring delivery are impossible to miss.
41. As an operator, I want a Delivered queue, so that successfully completed work is easy to review.
42. As an operator, I want an Attention required queue, so that failures, reopenings, and exceptional conditions are centralized.
43. As an operator, I want queue membership computed from durable state, so that items cannot fall between manually maintained lists.
44. As an operator, I want to find work by exact ID, exact name, or fuzzy text match, so that I can navigate without scanning a queue.
45. As an operator, I want filters for source, priority, assignee, lifecycle, disposition, and delivery channel, so that I can isolate relevant work.
46. As an operator, I want the primary response clearly distinguished from derivative deliverables, so that I know what must be delivered first.
47. As an operator, I want to change which deliverable is primary before delivery, so that the workflow can accommodate agent mistakes or editorial judgment.
48. As an operator, I want agent regenerations to appear as candidate versions, so that approved work is never silently replaced.
49. As an operator, I want the first successful agent draft to become ready automatically, so that routine work does not require redundant approval.
50. As an operator, I want subsequent regenerated versions to require promotion, so that in-flight delivery work remains stable.
51. As an operator, I want one delivery checklist row per channel, so that Reddit, LinkedIn, blog, newsletter, and other destinations can be tracked independently.
52. As an operator, I want the original opportunity destination required by default, so that the request cannot be considered Responded before its core obligation is fulfilled.
53. As an operator, I want additional channels optional by default, so that derivative opportunities do not block primary completion.
54. As an operator, I want to mark an additional channel required, so that campaign-specific obligations can control completion.
55. As an operator, I want Mark as responded to be explicit, so that copying content does not falsely imply successful publication.
56. As an operator, I want to record a destination URL and note when responding, so that delivery can be verified later.
57. As an operator, I want each response receipt tied to the exact deliverable version used, so that the published text remains traceable.
58. As an operator, I want unchecking a channel to preserve its previous receipt in history, so that corrections do not destroy evidence.
59. As an operator, I want all required delivery channels to determine the overall Responded state, so that the terminal state has consistent meaning.
60. As an operator, I want optional unchecked channels to remain visible after primary delivery, so that follow-up distribution opportunities are not lost.
61. As an operator, I want a genuine follow-up question to create a linked child request, so that new obligations do not corrupt the original history.
62. As an operator, I want to reopen an original request only for an incorrect checklist confirmation or failed delivery, so that reopening retains a narrow meaning.
63. As an operator, I want automated requests to expire when their opportunity window closes, so that stale work does not pollute active queues.
64. As an operator, I want started and manual requests protected from automatic expiration, so that deliberate work is never discarded by a heuristic.
65. As an operator, I want to restore an expired request, so that an opportunity can be revived when circumstances change.
66. As an operator, I want failed agent jobs to surface without inventing another Content Request lifecycle state, so that workflow status and execution status remain distinct.
67. As an operator, I want notifications only when the next-action owner changes, so that alerts remain useful.
68. As an operator, I want an email and in-app notification when a response becomes ready, so that delivery happens promptly.
69. As an operator, I want drafting failures surfaced after automatic retries are exhausted, so that transient failures do not create noise.
70. As an operator, I want requests and deliverables archived rather than hard-deleted, so that work remains recoverable.
71. As an operator, I want a revocable public link for selected request content, so that I can share work without requiring sign-in.
72. As an operator, I want to control which brief and deliverable content appears publicly, so that internal notes and private founder input stay private.
73. As a public viewer, I want a shared request to load without authentication, so that I can review it from any device.
74. As a public viewer, I want the public page to be read-only, so that a shared URL cannot mutate FairLend data.
75. As an agent, I want a durable work queue, so that I can claim submitted founder inputs reliably.
76. As an agent, I want jobs protected by leases, so that multiple local agents do not perform the same expensive work concurrently.
77. As an agent, I want job operations to be idempotent, so that retries cannot create duplicate deliverables or invalid transitions.
78. As an agent, I want to read the immutable original source, research context, and founder input, so that I can draft a faithful response.
79. As an agent, I want to create a polished primary response and multiple derivative deliverables, so that one founder submission can serve several channels.
80. As an agent, I want to add or update structured research, citations, talking points, and guardrails, so that requests can be improved after ingestion.
81. As an agent, I want complete system control through the CLI and API, so that the frontend never becomes an automation bottleneck.
82. As an agent, I want to address a request by ID, exact name, fuzzy name, or queue query, so that scripts can work naturally and safely.
83. As an agent, I want immutable source text and founder raw input protected from mutation, so that automation cannot rewrite evidence or authorship.
84. As an agent, I want to archive and restore records but not hard-delete them, so that automated cleanup remains recoverable.
85. As an agent, I want every mutation attributed to my credential, so that operators can understand what happened.
86. As an agent, I want full create, read, and update tools in the private ChatGPT App, so that browser-based ChatGPT can operate the system without a local desktop agent.
87. As an agent, I want the CLI, HTTP API, and ChatGPT App to share the same application contract, so that behavior does not diverge by adapter.
88. As an agent, I want the opportunity scout to emit maintained Markdown before ingestion, so that the research artifact remains human-readable and independently reviewable.
89. As an agent, I want ingestion to validate the complete Markdown report before writing, so that malformed automation output cannot partially corrupt the system.
90. As an agent, I want an atomic upsert after validation, so that a report is either fully applied or not applied.
91. As an agent, I want source URLs normalized before deduplication, so that tracking parameters and superficial URL differences do not create duplicate requests.
92. As an agent, I want a manual request matching an automated request to upgrade the existing record to manual and Critical, so that priority changes without losing lineage.
93. As an agent, I want direct posting prohibited unless an authenticated integration returns verifiable success, so that the Responded checklist remains trustworthy.
94. As an administrator, I want WorkOS identities mapped to application roles, so that founders, operators, agents, and public viewers receive appropriate capabilities.
95. As an administrator, I want agents to register as editors using WorkOS's auth.md agent standard, so that non-human identities are explicit and controllable.
96. As an administrator, I want one API key per agent installation, so that credentials can be rotated or revoked independently.
97. As an administrator, I want a complete audit trail containing actor, credential, correlation ID, operation, timestamp, and before/after versions, so that every mutation can be investigated.
98. As an administrator, I want public share tokens unguessable and revocable, so that unauthenticated access remains controllable.
99. As a product owner, I want lifecycle timing and delivery metrics recorded, so that V1 effectiveness can be measured.
100. As a product owner, I want Variant G treated as the canonical interaction specification, so that implementation does not regress into rejected prototype variants.

## Implementation Decisions

### Product boundary and canonical experience

- The product is named Content Requests. A Content Request represents one response obligation and is the primary aggregate for assignment, founder input, agent production, and delivery tracking.
- Variant G, named Unified Canvas in the approved prototype, is the canonical founder interaction model. Earlier variants are exploratory evidence only.
- The frontend remains a presentation, persistence, and communication layer. Research, synthesis, formatting, and derivative generation are agent responsibilities.
- The experience is mobile-first for both Elie and operators. Desktop layouts may increase density but must not introduce desktop-only workflows.
- Elie's primary library supports a swipeable stack and a grid toggle. The operator workspace uses computed action queues and responsive list or grid views.
- Every request has a dedicated authenticated route. Explicitly created public share links provide separate unauthenticated routes.

### Technology stack

- Use TanStack Start for the production web application and server-facing route layer.
- Use Convex as the authoritative application database, realtime synchronization layer, mutation/action runtime, and durable job coordination layer.
- Use Tailwind CSS and shadcn/ui with the RHEA preset for the interface system.
- Use WorkOS for human authentication and organization membership.
- Use WorkOS's auth.md agent standard for authenticated agent identities. Agents register with the editor role but are still constrained by resource-level invariants.
- Use the dedicated Convex versioning component for version history and undo/redo.
- Use Automerge with Convex following the established Automerge-and-Convex integration pattern for first-class offline collaborative documents.
- V1 agent compute is provided by local agents. The durable queue and contracts must remain compute-provider agnostic.
- Provide three first-class automation adapters over one shared application contract: a CLI, a full HTTP API, and a private ChatGPT App.

### Variant G Unified Canvas behavior

- The request header preserves the request ID, title, navigation back to the request library, and additional actions.
- The context deck is the dominant surface in the default state.
- The founder-input editor remains visible as a compact bottom surface and expands through an explicit control; it is not user-resizable.
- In the approved prototype, the compact editor occupies a deliberately small fixed region and the expanded editor occupies approximately half the mobile viewport. Production may adjust exact dimensions for safe areas and keyboard behavior while preserving the interaction hierarchy.
- Layout transitions use restrained motion and honor reduced-motion preferences.
- Context items can be toggled into or out of the deck and pinned. Pinned items remain present until unpinned.
- Context may include the original question, source body, source summary, operator cue, talking points, research, citations, missing research, and response guardrails.
- Pinned speaking notes render complete text without line clamping.
- Input supports keyboard and microphone modes. Recording behavior must have explicit start, pause, resume, and duration states.
- The editor autosaves continuously. Save state exposes Saved, Saving, and Offline states.
- Submission is explicit and advances the Content Request only after the founder-input document is durably synchronized.

### Domain model

- Content Request fields are optional by default unless required to preserve identity, authorization, or workflow integrity.
- The minimum creation contract requires a title, origin type, creator identity, and default priority/lifecycle values. A source URL, raw source text, deadline, assignee, context, and delivery targets may be added later.
- Each Content Request has a stable human-readable ID and an opaque database identity.
- Origin types include automated scout, manual operator entry, ChatGPT App, CLI, and HTTP API.
- Manual origin upgrades priority to Critical and sorts ahead of automated work within every action queue.
- Original source text, source snapshot, and founder raw input are immutable evidence. Corrections are represented as annotations or new versions of derived material, not destructive edits.
- Agent-produced summaries, talking points, citations, research notes, open questions, guardrails, and operator cues are mutable structured context items with version history.
- A request has exactly one accountable assignee in V1 and zero or more watchers.
- Reassignment records the previous assignee, new assignee, actor, timestamp, and optional reason without resetting workflow state.

### Content Request lifecycle

- The user-facing lifecycle is:
  - Pending: assigned but without meaningful founder activity.
  - In progress: opened with meaningful activity, recording, or an autosaved founder draft.
  - Founder complete: Elie explicitly submitted his single founder-input document.
  - Ready to respond: the primary response deliverable has a promoted ready version and required delivery remains outstanding.
  - Responded: every required delivery target has an active delivery receipt.
- Opening a request records first-opened and most-recently-opened timestamps. Opening alone may be presented separately from meaningful progress; a draft or recording establishes In progress.
- Founder submission atomically records submission and creates an idempotent drafting job.
- Drafting execution states such as Queued, Running, Failed, retry count, and lease expiry belong to Agent Jobs and never become Content Request lifecycle states.
- Expired is a disposition, not a lifecycle state. Archived is retention state, not workflow state.
- A genuine follow-up creates a linked child Content Request. Reopening the original is limited to an incorrect delivery confirmation or failed delivery.

### Computed operator queues

- Needs Elie includes Pending and In progress requests for which founder action is next.
- Agent drafting includes Founder complete requests with queued or running drafting work.
- Needs operator includes Ready to respond requests with at least one required delivery target lacking an active receipt.
- Delivered includes Responded requests.
- Attention required includes terminal agent failures, invalid imports, reopened deliveries, semantic merge conflicts, and exceptional expiration or authorization conditions.
- Queue membership is computed from authoritative domain state and cannot be manually assigned.
- Manual/Critical requests sort above automated requests. Remaining sort inputs include explicit priority, deadline, expiration risk, source freshness, and creation time.

### Founder input, offline support, and versioning

- Elie authors one founder-input document per Content Request. That document may contain typed text, recorded audio metadata, transcript, or both, but it remains one submission boundary.
- The Automerge document is the offline-editable source for founder draft content and compatible collaborative rich-text fields.
- Convex stores authoritative metadata, authorization, indexes, lifecycle state, job state, and references to Automerge document state.
- Offline edits are accepted without connectivity and synchronize automatically after reconnection.
- Ordinary concurrent text edits merge automatically. A visible conflict is created only for incompatible changes to semantic singleton fields such as assignee, primary-deliverable selection, or promoted version.
- Semantic conflicts preserve both values until resolved and appear in Attention required.
- Undo/redo and version history use the dedicated Convex versioning component. Historical versions remain attributable to actors.
- Founder submission is rejected or deferred when the local document has not been durably synchronized; the UI must explain the condition without discarding input.

### Agent jobs and drafting

- Founder submission creates a durable primary-response drafting job automatically.
- Local agents poll or subscribe to the work queue, claim a job with a time-bounded lease, heartbeat while working, and complete or fail it idempotently.
- An expired lease makes the job claimable by another agent. Duplicate completion attempts cannot create duplicate promoted deliverables.
- Retries are automatic for transient failures. Operators are notified only after the configured retry policy is exhausted.
- Agent job input references immutable source and founder-input versions so a retry runs against a stable snapshot.
- The first successful primary response may be promoted automatically and advances the request to Ready to respond.
- Regeneration creates a candidate version. It never silently replaces an already promoted or delivered version.
- An editor or authorized agent explicitly promotes subsequent candidates.

### Deliverables and delivery tracking

- A request supports multiple deliverables but exactly one primary response deliverable.
- The primary response is tied to the original response obligation and controls Ready to respond.
- Secondary deliverables may include social posts, articles, newsletter copy, follow-up answers, summaries, or other channel-specific derivatives. They never block the primary workflow unless their delivery target is explicitly required.
- Each deliverable has immutable versions, a current candidate, and an optional promoted version.
- Changing the primary designation is allowed before delivery and is audited.
- Delivery targets represent channels or concrete destinations. The original opportunity destination is required by default. Additional targets are optional unless explicitly marked required.
- The Responded checklist is a projection of delivery targets and their current receipts.
- Mark as responded is an explicit mutation. Copying text to the clipboard never marks delivery automatically.
- A delivery receipt records channel, destination URL when available, exact deliverable version, responded-at timestamp, confirming actor, integration identity when applicable, and optional note.
- A request becomes Responded only when every required target has an active receipt.
- Unchecking or reopening a target deactivates the current receipt but preserves it in immutable history.
- Agents may mark a delivery target responded only when an authenticated external integration returns verifiable success. Otherwise human confirmation is required.

### Opportunity ingestion and deduplication

- The FairLend community-demand, journalist-request, and digital-PR scout continues to produce the maintained Markdown report as its first artifact.
- Ingestion is a separate deterministic operation available through the CLI and API.
- The complete Markdown document is parsed and validated before any database mutation occurs.
- Validation failure writes nothing and returns structured diagnostics with locations and remediation guidance.
- A valid report is applied atomically as an upsert batch.
- Ingestion condenses report prose into structured context items, bullet points, research requirements, citations, source metadata, deadlines, and suggested delivery targets without losing the original Markdown or raw opportunity text.
- Source URLs are normalized before deduplication. Normalization removes known tracking parameters, normalizes host casing and default ports, and applies conservative canonicalization that does not merge semantically distinct pages.
- The normalized source URL is the default deduplication key. Source-specific stable IDs may strengthen matching when available.
- Re-ingesting the same opportunity updates mutable derived context and ingestion metadata but never overwrites immutable source snapshots or founder input.
- Creating a manual request that matches an automated request upgrades the existing aggregate to manual origin behavior and Critical priority. It does not create a duplicate or replace immutable source evidence.
- Imports retain report identity, ingestion run identity, raw Markdown reference, parser version, and upsert results for auditing.

### CLI, HTTP API, and ChatGPT App

- All adapters call the same application service and authorization contract. Business rules must not be reimplemented independently in each adapter.
- The CLI is optimized for agent economics: compact structured output, selectable fields, bulk operations, idempotency keys, machine-readable errors, pagination, and commands that avoid unnecessary round trips.
- The CLI supports work-queue queries, exact ID lookup, exact name lookup, fuzzy name matching, and explicit disambiguation when multiple candidates are plausible.
- The HTTP API is intentionally complete rather than narrow. It exposes authorized create, read, update, archive, restore, search, assignment, context, document, job, deliverable, version, promotion, delivery-target, receipt, share-link, notification, and audit operations.
- Immutable source and founder-input fields reject mutation through every adapter.
- Ordinary agents cannot hard-delete records.
- The private ChatGPT App exposes full authorized create/read/update workflows and can be used from ChatGPT's web interface without a desktop agent running.
- ChatGPT App tools use concise schemas, stable IDs, confirmation for consequential delivery or archival actions, and human-readable summaries alongside machine data.
- Agent credentials are protected by API keys or WorkOS agent identity as appropriate. Each installation receives an independently revocable credential.
- API keys never grant unauthenticated public access and are never embedded in public share URLs.

### Authentication, roles, and authorization

- WorkOS is the source of human identity and organizational membership.
- Roles include Founder, Operator/Editor, Agent Editor, and Administrator. Public Viewer is token-based and unauthenticated.
- Founder permissions focus on assigned-request reading, founder-input editing, context toggling/pinning, and submission.
- Operators/editors can create, assign, edit derived context, manage deliverables, promote versions, manage delivery targets, confirm delivery, create share links, archive, and restore.
- Agent editors have broad system control necessary for automation but remain subject to immutable-field, promotion, delivery-proof, and no-hard-delete invariants.
- Administrators manage credentials, roles, exceptional hard deletion, and security policy.
- Authorization is enforced in the shared application layer, not only in UI routes.

### Public sharing

- A public share link uses a cryptographically unguessable, revocable token scoped to one Content Request.
- Creating a public link requires explicit selection of the brief sections and promoted deliverables that may be exposed.
- Public views never expose founder input, private drafts, internal notes, audit history, operator metadata, agent jobs, credentials, or unpublished candidate versions.
- Public views are read-only and require no authentication.
- Revocation takes effect immediately. Token access is logged without collecting unnecessary viewer identity.
- Share links may optionally expire, but expiration is not required for every link.

### Notifications

- Notifications fire when ownership of the next action changes, not on every mutation.
- Elie receives in-app and transactional email notifications for new assignment, Critical escalation, and approaching deadline.
- Founder submission creates an agent job without a human notification.
- Operators receive in-app and transactional email notifications when the primary response becomes Ready to respond, when drafting exhausts retries, or when a delivered target is reopened.
- Autosaves, routine opens, job heartbeats, normal retries, and optional derivative completion do not create notifications.
- Notifications contain a deep link to the relevant authenticated request or queue.

### Expiration and retention

- Automated requests may receive an expires-at value inferred from an explicit deadline or conservative source heuristic.
- Expired automated requests leave active queues and remain accessible under Expired.
- Manual requests and requests with meaningful founder progress never auto-expire.
- Unclaimed drafting jobs are cancelled when their automated request expires. Started jobs are not destroyed automatically; they surface for operator disposition.
- Editors can restore an expired request and clear or replace its expiration value.
- UI, CLI, HTTP API, ChatGPT App, and ordinary agents support archive and restore but not hard deletion in V1.
- Administrative hard deletion is an exceptional backend operation governed by separate operational policy.

### Auditability and observability

- Every mutation records actor identity, credential identity, Content Request ID, operation, timestamp, correlation ID, and before/after version references where applicable.
- Delivery receipts, immutable source snapshots, founder submissions, promotions, assignment changes, share-link changes, imports, archives, and restorations receive first-class audit events.
- Agent job telemetry records queue time, start time, completion time, attempts, lease history, error classification, and output version references.
- Product analytics record time to first open, time to founder submission, time to ready response, time to delivery, delivery before expiration, drafting failure rate, and substantial operator rewrite rate.
- Sensitive content is excluded from logs. Logs reference record and version IDs rather than duplicating founder or source text.

### Search and identification

- Human-readable Content Request IDs are stable and displayed throughout the product.
- Exact ID match always outranks fuzzy results.
- Exact normalized title match outranks general fuzzy text match.
- Fuzzy search covers request title, source, channel, and configured aliases without searching private founder text by default.
- Ambiguous agent queries return candidates and require explicit selection rather than guessing.
- Queue endpoints accept filters, sorting, pagination, and compact field selection.

## Testing Decisions

### Testing philosophy

- Tests assert observable product behavior and domain invariants rather than component internals, private helper functions, or implementation-specific Convex storage details.
- The preferred test is the highest-level deterministic test that can establish the behavior with useful failure diagnostics.
- The production repository currently has no application tests or production backend; the throwaway prototype and generated shadcn primitives are not prior art for the production test architecture.
- New seams are limited to one shared workflow contract plus a browser acceptance seam. Every adapter is intentionally thin and receives only contract-conformance coverage.

### Primary workflow-contract seam

- Build a black-box workflow-contract suite against the real Convex application services in an isolated test deployment or supported Convex test harness.
- The suite invokes the same application operations used by TanStack Start, the CLI, HTTP API, and ChatGPT App.
- WorkOS identities, agent credentials, external delivery integrations, email delivery, and time are controlled at system boundaries while Convex mutations, actions, persistence, indexes, and authorization rules remain real.
- The suite covers:
  - Minimal manual creation and Critical priority.
  - Automated Markdown validation and atomic upsert.
  - URL normalization and deduplication.
  - Manual upgrade of an automated request without immutable-source replacement.
  - Assignment, watcher, opening, drafting, and submission behavior.
  - Lifecycle transitions and rejection of invalid transitions.
  - Durable agent-job creation, lease expiry, heartbeat, retries, and idempotent completion.
  - First-version auto-promotion and subsequent candidate promotion.
  - Primary and secondary deliverable behavior.
  - Required and optional delivery targets.
  - Immutable delivery receipts and Responded computation.
  - Reopening delivery and linked follow-up creation.
  - Expiration, restoration, and cancellation behavior.
  - Archive and restore behavior.
  - Public-share field selection, revocation, and read-only access.
  - Role and immutable-field authorization across humans and agents.
  - Audit-event completeness and correlation.
  - Notification emission only on agreed ownership transitions.
  - Offline merge synchronization and semantic conflict surfacing.

### Browser acceptance seam

- Use Playwright against the production TanStack Start application connected to an isolated Convex environment.
- Validate at representative mobile and desktop viewports, with mobile behavior treated as the primary acceptance target.
- The suite covers:
  - WorkOS sign-in and role-appropriate navigation.
  - Elie's stack and grid library modes.
  - Manual/Critical priority ordering.
  - Direct navigation to a Content Request.
  - Variant G Unified Canvas default and expanded states.
  - Context toggling and pinning.
  - Complete pinned-note display.
  - Keyboard and microphone mode switching.
  - Autosave state, offline editing, reconnection, and restored draft.
  - Founder submission and removal from the active founder queue.
  - Operator computed queues and filters.
  - Candidate promotion and primary designation.
  - Responded checklist behavior and receipt capture.
  - Archive, restore, expiration, and Attention required surfaces.
  - Revocable unauthenticated public share links.
  - Keyboard navigation, semantic labels, focus management, contrast, reduced motion, and touch-target accessibility.
- Visual regression coverage is limited to canonical Variant G screens and high-risk responsive states rather than every generated shadcn primitive.

### Adapter contract tests

- CLI tests verify command parsing, compact structured output, lookup/disambiguation, idempotency-key forwarding, exit codes, and mapping to the shared workflow contract.
- HTTP API tests verify authentication, schema validation, pagination, error format, idempotency, and mapping to the shared workflow contract.
- ChatGPT App tests verify tool schemas, role enforcement, confirmation boundaries, compact responses, and mapping to the shared workflow contract.
- Adapter tests do not duplicate lifecycle test matrices already covered by the primary workflow-contract suite.

### Focused algorithm tests

- Unit tests are reserved for deterministic algorithms with meaningful edge cases, including URL normalization, priority scoring, Markdown parsing diagnostics, fuzzy-match ranking, and expiration inference.
- These tests use table-driven inputs and outputs and avoid mocking internal module structure.

### Non-functional validation

- Validate production builds, type checking, linting, database schema generation, and migration compatibility in continuous integration.
- Test offline document size and synchronization performance using representative long briefs, transcripts, and version histories.
- Load-test queue claiming and idempotent completion with concurrent agents.
- Verify public-share responses do not contain private fields through both contract tests and response-shape inspection.
- Verify audit and application logs do not contain source bodies, founder input, transcripts, API keys, or share tokens.
- Measure mobile interaction performance and prevent layout shift when the editor expands, the keyboard opens, or offline state changes.

## Out of Scope

- Autonomous posting to Reddit, journalist platforms, social networks, email publications, or other external destinations without an authenticated integration that returns verifiable success.
- Building broad external publishing integrations in V1. Manual copy/paste plus explicit delivery confirmation is the default delivery path.
- Cloud-hosted agent compute orchestration. V1 uses local agents against a durable, provider-agnostic queue.
- Multiple accountable assignees on one Content Request. V1 supports one assignee and optional watchers.
- Hard deletion through ordinary product interfaces or agent tools.
- Editing immutable original source text, source snapshots, or submitted founder raw input.
- Allowing regenerated content to silently replace a promoted or delivered version.
- Making private drafts, founder input, internal notes, jobs, audit events, or candidate deliverables available through public share links.
- Treating optional derivative channels as blockers unless an editor marks them required.
- Reopening an original request for every follow-up. Genuine follow-ups are linked child requests.
- Native iOS or Android applications. V1 is a responsive, installable web experience with first-class mobile behavior.
- Reproducing or shipping rejected prototype variants A through F as product modes.
- Using the prototype's in-memory fixtures, Vite-only architecture, or Sites Worker as the production persistence and application architecture.

## Further Notes

- The approved Variant G prototype is located in the fork-created prototype tree and is a design artifact, not the production foundation. Implementation should extract its decisions—Unified Canvas hierarchy, toggled context deck, compact/expanded editor, motion behavior, and mobile ergonomics—into the production component architecture.
- The current repository is a prototype repository with no domain glossary, ADRs, issue templates, production backend, or first-party automated tests. This specification establishes the initial domain vocabulary and architectural contract.
- The `ready-for-agent` GitHub label was not present when the repository was inspected. This local-only specification does not modify issue-tracker labels or publish an issue.
- The maintained FairLend opportunity-scout Markdown file remains the source specification for research generation. This product specification governs ingestion and downstream execution rather than replacing the scout's research instructions.
- V1 success should be evaluated using time to founder submission, time to ready response, time to delivery, delivery-before-expiration rate, drafting failure rate, and the percentage of agent drafts delivered without substantial operator rewriting.
- A request is not operationally complete merely because Elie submitted or an agent drafted. It is Responded only when every required delivery target has a valid active receipt.
