# Expert Interview Guest Access and Multi-Respondent Synthesis

## Problem Statement

FairLend can research and package an Expert Interview Content Request, and local agents can create and process the current single-founder form of that request. However, the production application cannot yet collect expertise from one or more specifically chosen people without requiring each person to sign in.

The existing Public Share is a read-only snapshot. It is not assigned to a Person, does not provide an editable Response Workspace, does not preserve independent respondent evidence, and cannot support the approved Expert Interview experience. The approved founder interface also exists only as a prototype rather than as the production guest experience.

Administrators therefore lack a safe, fast way to select a known founder or colleague, generate and copy a request-scoped link, observe progress, provide feedback, preserve a submitted response, renew access, or send several independent responses into an attributed Expert Synthesis. Respondents cannot open a direct link and answer the complete brief through the approved mobile-first experience.

Local agents also need the completed multi-respondent evidence exposed through the same shared application contract used by MCP, CLI, and HTTP. Processing must preserve attribution, allow explicit inclusion or exclusion of individual Submissions, and prevent practitioner statements from being silently presented as independently verified facts.

## Solution

Add a first-class Guest Access Grant workflow to every Content Request, with an enhanced experience for Expert Interviews.

An administrator selects a registered Person through an autocomplete selector that defaults to the founder. A missing Person can be created inline. Selecting **Generate & copy link** creates a cryptographically unguessable bearer token, assigns it immutably to that Person, scopes it to one Content Request, expires it after 48 hours, and copies the resulting URL. FairLend does not send the link.

Opening the link requires no sign-in. The token resolves only its assigned Content Request and isolated Response Workspace. For an Expert Interview, the respondent sees the approved Focused Proofline experience: the full brief, audience, framing, article context, every Interview Question and its motivation, progress, and the choice to answer all at once or one question at a time.

The Response Workspace autosaves text, audio, attachments, transcripts, question progress, and answer mode. It works across devices while enforcing one active editor lease with explicit takeover. Administrators can inspect provisional work read-only and leave targeted feedback, but cannot edit respondent evidence.

Submission requires explicit confirmation and creates an immutable, attributable Submission. Administrators may reopen the workspace while access remains valid. Expiry or revocation blocks further access without deleting work. Renewal rotates the token, invalidates the previous URL, extends access, and reconnects the same Response Workspace.

Multiple Guest Access Grants may exist for one Content Request. Each grant and workspace remains isolated, and respondents never see one another. Administrators select which immutable Submissions are included in processing. The shared application contract gives local agents an attributed evidence bundle and synthesis prompt, and persists the result as a versioned Deliverable.

The existing read-only Public Share remains a separate legacy capability. Guest-facing terminology must use **Guest Access Grant**, **response link**, or **access link**, never “public link.”

## User Stories

1. As an administrator, I want Guest Access Grants available on every Content Request, so that I can collect input without requiring a user account.
2. As an administrator, I want Expert Interviews identified as a first-class Content Request type, so that I can distinguish them from Standard Requests.
3. As an administrator, I want to search registered people by name or email, so that I can assign a response link quickly.
4. As an administrator, I want the Person selector to default to the founder, so that the common assignment requires no extra work.
5. As an administrator, I want to create a missing Person inline, so that I do not have to abandon the Content Request flow.
6. As an administrator, I want Person assignment fixed when a grant is created, so that the audit history always reflects my stated recipient.
7. As an administrator, I want to revoke and regenerate a mistakenly assigned grant, so that corrections remain explicit and auditable.
8. As an administrator, I want one **Generate & copy link** action, so that producing a sendable access link is immediate.
9. As an administrator, I want the generated URL copied automatically, so that I can paste it into my chosen communication channel.
10. As an administrator, I want a visible copy fallback when clipboard access fails, so that the link is never lost.
11. As an administrator, I want FairLend not to send the link, so that I retain control of the recipient and communication context.
12. As an administrator, I want every new grant to expire after 48 hours by default, so that bearer access is naturally time-bounded.
13. As an administrator, I want to see the exact expiry time before and after generation, so that I can communicate the deadline accurately.
14. As an administrator, I want multiple active grants for one request, so that several experts can answer independently.
15. As an administrator, I want to revoke one grant without affecting others, so that access control remains respondent-specific.
16. As an administrator, I want to renew an expired or expiring grant, so that the respondent can continue without losing draft work.
17. As an administrator, I want renewal to rotate the token, so that the prior URL stops working.
18. As an administrator, I want renewal to retain the same Response Workspace, so that completed draft work is not fragmented.
19. As an administrator, I want a grant timeline showing Generated, Opened, In progress, Submitted, Expired, Revoked, Renewed, Reopened, and Taken over events, so that I can understand what happened.
20. As an administrator, I want to see which Person owns each grant, so that several response links remain intelligible.
21. As an administrator, I want to see grant status, expiry, latest activity, answer progress, and submission state at a glance, so that I can follow up appropriately.
22. As an administrator, I want approaching-expiry notifications for unfinished work, so that useful evidence is not lost to an unnoticed deadline.
23. As an administrator, I want a notification when a Submission is created, so that processing can begin promptly.
24. As an administrator, I want notifications when audio or attachment uploads fail, so that I can help the respondent recover.
25. As an administrator, I do not want routine autosaves or opens to create notifications, so that the notification centre stays actionable.
26. As an administrator, I want to inspect provisional text, transcripts, attachments, and progress read-only, so that I can assess whether the interview is yielding useful evidence.
27. As an administrator, I want to leave feedback against the whole workspace, a specific Interview Question, or a specific uploaded asset, so that my guidance is precise.
28. As an administrator, I want feedback kept separate from respondent evidence, so that attribution remains clear.
29. As an administrator, I want to reopen a submitted Response Workspace while its grant is valid, so that the respondent can add material.
30. As an administrator, I want reopening to preserve the prior immutable Submission, so that historical evidence is never rewritten.
31. As an administrator, I want to include or exclude each Submission from Expert Synthesis, so that weak, duplicated, or inappropriate evidence is not forced into the draft.
32. As an administrator, I want every synthesis claim traceable to research or a named Submission, so that I can review provenance.
33. As an administrator, I want disagreements between experts preserved, so that synthesis does not manufacture false consensus.
34. As an administrator, I want unresolved Knowledge Gaps called out after synthesis, so that I know where follow-up is still required.
35. As a selected respondent, I want to open the access link without signing in, so that answering has minimal friction.
36. As a selected respondent, I want the guest page not to ask me who I am, so that the administrator’s assignment remains authoritative.
37. As a selected respondent, I want access limited to the assigned Content Request, so that unrelated organizational material is not exposed.
38. As a selected respondent, I want to see the request title, topic, article summary, audience, framing, FairLend posture, and intended contribution, so that I understand why my expertise is needed.
39. As a selected respondent, I want to see every Interview Question and its motivation on the brief, so that I understand the complete ask before answering.
40. As a selected respondent, I want question rows beneath the progress summary, so that I can scan the work remaining.
41. As a selected respondent, I want each question row collapsed by default with progressive disclosure, so that a long interview remains manageable.
42. As a selected respondent, I want to expand any question to see its complete wording and motivation, so that I can answer with the intended evidence.
43. As a selected respondent, I want a sticky split action for **Answer all at once** and **Answer one at a time**, so that the response mode is always obvious and reachable on mobile.
44. As a selected respondent, I want **Answer one at a time** to focus one question while preserving progress across all questions, so that I can work incrementally.
45. As a selected respondent, I want **Answer all at once** to expand every question and motivation above one shared composer, so that I can give a natural continuous response.
46. As a selected respondent, I want both keyboard and microphone input, so that I can use the fastest mode for my expertise.
47. As a selected respondent, I want to attach supporting files, so that I can provide examples, source material, and case evidence.
48. As a selected respondent, I want recordings and attachments associated with either the batch response or a specific question, so that their context is preserved.
49. As a selected respondent, I want uploads and transcription to continue safely while I work, so that long answers do not block progress.
50. As a selected respondent, I want text, recordings, attachments, transcripts, answer mode, and progress autosaved, so that accidental navigation does not destroy work.
51. As a selected respondent, I want to resume the same workspace on another device, so that I can move from phone to computer.
52. As a selected respondent, I want to be warned when another device is actively editing, so that we do not silently overwrite each other.
53. As a selected respondent, I want an explicit takeover action, so that I can intentionally continue on the current device.
54. As a selected respondent, I want visible save and upload status, so that I know whether my work is durable.
55. As a selected respondent, I want clear recovery actions for failed uploads, so that one failed asset does not block the rest of the interview.
56. As a selected respondent, I want administrator feedback visible in context without changing my answer, so that I can respond to guidance while retaining authorship.
57. As a selected respondent, I want a clear Submit action, so that saving a draft is not confused with finishing.
58. As a selected respondent, I want an “Are you sure?” confirmation at the bottom of the screen, so that I do not submit accidentally.
59. As a selected respondent, I want the confirmation to explain that submission locks the current response, so that the consequence is clear.
60. As a selected respondent, I want a submitted confirmation state, so that I know FairLend received my evidence.
61. As a selected respondent, I want submitted content to become read-only, so that its evidentiary snapshot is stable.
62. As a selected respondent, I want an expired link to explain that access ended without implying my work was deleted, so that I know an administrator can renew it.
63. As a selected respondent, I want a revoked or invalid URL to reveal no request details, so that bearer-token failures do not leak information.
64. As a selected respondent, I want no indication of other respondents or their work, so that each interview remains private.
65. As a local agent, I want an MCP prompt that explains how to research indexed coverage and identify Knowledge Gaps, so that request creation follows the approved evidence standard.
66. As a local agent, I want a structured Expert Interview creation operation, so that I can persist the brief, gaps, citations, questions, motivations, and operator instructions.
67. As a local agent, I want operator instructions represented as priority input, so that inferred choices never override direct direction.
68. As a local agent, I want Content Requests created through the operator Expert Interview workflow to be Critical, so that they sort ahead of inferred work.
69. As a local agent, I want to list Guest Access Grants by Content Request, so that I can inspect response status without scraping the UI.
70. As a local agent, I want to create, revoke, and renew Guest Access Grants through the shared control plane, so that CLI, MCP, HTTP, and UI have identical behavior.
71. As a local agent, I want grant creation to return the plaintext token exactly once, so that the application stores only a non-reversible token representation.
72. As a local agent, I want to list immutable Submissions and their attribution metadata, so that completed interviews can be processed programmatically.
73. As a local agent, I want synthesis input to accept explicit Submission IDs, so that inclusion and exclusion decisions are deterministic.
74. As a local agent, I want processing input to contain the Interview Brief, Knowledge Gaps, questions, motivations, citations, selected Submissions, attachments, and transcripts, so that I have the complete evidence bundle.
75. As a local agent, I want a generated synthesis prompt that distinguishes sourced facts, practitioner claims, and editorial inference, so that the resulting article is honest.
76. As a local agent, I want completion to create a new Deliverable or immutable Deliverable Version, so that generated content never overwrites evidence.
77. As a local agent, I want stable validation and domain error codes, so that automation can recover safely.
78. As an auditor, I want every grant, workspace, submission, feedback, lease, and synthesis mutation attributed to the acting credential or token grant, so that activity is reconstructable.
79. As a security reviewer, I want plaintext tokens excluded from storage, logs, analytics, and audit payloads, so that observability does not create bearer-token leakage.
80. As a product owner, I want the existing Public Share behavior preserved separately, so that adding response links does not silently break read-only sharing.

## Implementation Decisions

- Add `expert_interview` as a first-class Content Request type while preserving `standard` as the default for existing records.
- Preserve the existing Public Share as a separate read-only snapshot capability. Do not extend it into a writable guest workflow, and do not reuse “public” terminology for Guest Access Grants.
- Use the existing authenticated application service and agent control plane as the canonical admin and local-agent boundary. UI server functions, HTTP, CLI, and MCP must call the same operations.
- Add a dedicated token-scoped guest application boundary for unauthenticated reads and mutations. A Guest Access Grant may resolve only its Content Request, approved brief projection, Interview Questions, administrator feedback, and isolated Response Workspace.
- Persist a first-class Expert Interview package with its Interview Brief, ordered Knowledge Gaps, ordered Interview Questions, motivations, citations, framing, FairLend posture, founder contribution, and priority operator instructions.
- Model a registered Person using the workspace’s principal/person directory. Add the minimum display-name metadata needed for name/email autocomplete and inline creation. Inline creation must remain organization-scoped and auditable.
- The admin Person selector defaults to the organization’s configured founder. It never appears in the guest experience.
- A Guest Access Grant stores organization, request, assigned Person, current token hash, token version, expiry, state, creator, timestamps, and latest activity. It never stores or returns the plaintext token after creation.
- Generate tokens from at least 256 bits of cryptographically secure randomness. Store only a keyed hash or equivalent non-reversible verifier. Redact tokens from logs, telemetry, errors, and audit metadata.
- Grant creation sets expiry to exactly 48 hours after creation unless an authorized future product rule explicitly changes the default. The initial UI does not expose an arbitrary expiry picker.
- Person assignment is immutable. The correction path is revoke and create a new grant.
- Allow multiple active grants per Content Request and multiple historical grants per Person. Revocation and renewal operate on one grant only.
- Renewal rotates the token verifier, increments the token version, invalidates every prior URL, establishes a new 48-hour expiry, and retains the same Response Workspace and history.
- Grant states are derived from durable facts and include Generated, Opened, In progress, Submitted, Expired, and Revoked. Renewed, Reopened, Taken over, upload failures, and feedback are timeline events rather than ambiguous replacements for the primary state.
- Invalid and revoked tokens return a generic not-found experience without request metadata. Expired tokens return an expired-access experience containing no sensitive response content and a direction to contact the sender.
- Enforce bounded access attempts per token fingerprint and network source using the existing share-access rate-limiting pattern, without recording plaintext tokens.
- Create exactly one Response Workspace per Guest Access Grant. It stores answer mode, batch response, per-question responses, progress, current revision, lock state, lease state, and timestamps.
- Store per-question answers by stable Interview Question ID. Reordering questions must not detach saved answers.
- Model batch response and per-question responses independently so switching modes never silently converts or deletes work. The respondent may choose which material to submit when both modes contain content.
- Reuse the existing offline-capable text, voice capture, upload, transcription, autosave, immutable version, and retry concepts where their authorization can be safely parameterized for a Guest Access Grant. Do not duplicate those primitives solely for the guest UI.
- Associate every audio capture and attachment with the workspace plus either `batch` scope or a stable Interview Question ID. Persist upload state, transcription state, failure code, and retry history.
- Autosave all meaningful respondent mutations with optimistic revision checks. Exact retries are idempotent; stale writes return a conflict payload that allows the client to refresh rather than overwrite.
- Use a renewable editor lease with a short server-enforced expiry and regular heartbeat. Only the current lease holder may mutate the workspace. Explicit takeover increments the lease generation, records an event, and invalidates the prior editor.
- Administrator access to a provisional Response Workspace is read-only. No authenticated admin mutation may alter respondent text, recordings, attachments, or transcripts.
- Administrator feedback is a separate attributable entity scoped to the workspace, an Interview Question, or an asset. Feedback can be resolved but not rewritten into respondent evidence.
- Submission requires an unlocked workspace, a current editor lease, no unresolved required upload operation, and an explicit confirmation action. It creates an immutable Submission snapshot containing answer data, asset references, transcript versions, question/version metadata, respondent attribution, and submission time.
- Submission locks the Response Workspace. Autosave and upload mutations reject writes while locked.
- Reopening is an authenticated administrator action. It unlocks future workspace revisions without mutating or deleting earlier Submissions.
- Expiry and revocation affect authorization only. Response Workspaces, assets, comments, Submissions, and events follow the parent Content Request’s retention policy.
- Every Submission remains a separate attributable source even when several grants are assigned to people in the same organization.
- Expert Synthesis accepts an explicit ordered set of Submission IDs. The service validates that every selected Submission belongs to the target Expert Interview.
- Processing input returns the Interview Brief, Knowledge Gaps, citations, Interview Questions and motivations, selected immutable Submissions, asset/transcript metadata, existing Deliverables, and a prompt that places operator instructions first.
- The synthesis prompt requires separate treatment of externally sourced facts, practitioner claims, and editorial inference; preservation of material disagreement; explicit unresolved gaps; and no invented quotations, cases, outcomes, or regulatory conclusions.
- Completing synthesis creates a `blog_article` Deliverable or a new immutable version of the selected article Deliverable and records the selected Submission IDs and context-version IDs as provenance.
- Extend the shared agent operation registry with `guest_access.list`, `guest_access.create`, `guest_access.revoke`, `guest_access.renew`, `expert_interview.submissions`, and a multi-submission form of `expert_interview.processing_input`.
- Keep `expert_interview.research_prompt`, `expert_interview.create`, and `expert_interview.complete_processing` compatible with the existing CLI and MCP contracts. Existing single-founder processing must migrate to the same Submission-based evidence bundle rather than remain a second processing model.
- Classify grant creation and renewal as additive, idempotent mutations with stable retry keys. Classify revocation and reopening as consequential actions that require the existing preview/confirm boundary for agent clients.
- The dedicated admin action is labeled **Generate & copy link**. Successful generation immediately attempts clipboard copy and always renders the URL with a manual Copy action.
- The product does not send response links by email, SMS, chat, or another channel.
- The production respondent route uses the approved Focused Proofline visual direction and is mobile-first. It includes the quick brief, progress summary, all question rows, question motivations, and the sticky split response action.
- The quick brief displays title, topic, article summary, audience, framing, FairLend posture, founder contribution, every Interview Question, and every motivation.
- In one-at-a-time mode, all questions remain visible as progress rows and any row can progressively disclose its complete description and motivation.
- In batch mode, all questions and motivations are expanded above one shared text/microphone composer.
- The sticky action has two equal sections: **Answer all at once** and **Answer one at a time**. It remains reachable without covering the final content or confirmation controls.
- Submission uses a clear bottom-of-screen action followed by an “Are you sure?” dialog or bottom sheet. Confirmation text states that the submitted snapshot becomes read-only.
- Respondent projections never contain grant lists, Person directory data, other Response Workspaces, other Submissions, administrative notes, agent jobs, audit records, or non-approved private context.
- Notifications are created only for Submission, unfinished grants approaching expiry, and failed audio/attachment uploads. The approaching-expiry threshold is configurable and initially fires once within the final 12 hours.
- Audit events cover grant creation, open, first meaningful progress, renewal, revocation, lease acquisition/takeover, feedback, submission, reopening, upload failure, inclusion/exclusion selection, and synthesis completion.
- Token-facing endpoints return explicit argument and domain validators, bounded payload sizes, MIME allowlists, upload size limits, and stable error codes.
- Existing Content Requests and Public Shares require backward-compatible optional schema additions and migrations. No destructive migration may reinterpret a Public Share as a Guest Access Grant.

## Testing Decisions

- Test externally observable behavior rather than table layout, helper calls, generated token shape, CSS implementation, or component internals.
- Use one primary acceptance seam: complete browser-level workflows across the authenticated administrator UI and token-scoped respondent route. This seam must prove person selection, generation and clipboard fallback, no-sign-in access, brief/question presentation, both answer modes, autosave, submission confirmation, admin visibility, reopening, expiry, renewal, revocation, isolation, and synthesis selection.
- Extend the existing unauthenticated share end-to-end precedent with a separate Guest Access Grant scenario. Keep the legacy Public Share test unchanged to prove the two capabilities remain distinct.
- Add application/control-plane contract tests for every new operation so UI, HTTP, CLI, and MCP cannot drift in validation, idempotency, safety classification, prompt content, or structured results.
- Extend MCP discovery tests to prove the exact expert-interview and guest-access operation schemas are published in one and only one tool class.
- Add CLI contract tests proving the ergonomic guest-access and multi-submission processing commands map to the shared control endpoint rather than a parallel implementation.
- Add Convex behavior tests for organization scoping, request scoping, immutable Person assignment, multiple independent grants, token hashing, exact 48-hour expiry, token rotation, old-token invalidation, per-grant revocation, retained work, and idempotent retries.
- Add concurrency tests for optimistic autosave revisions, one active editor lease, heartbeat, lease expiry, explicit takeover, stale-editor rejection, and retry safety.
- Add evidence tests proving Submission snapshots are immutable, reopening does not alter prior snapshots, and completion records the selected Submission and context versions.
- Add isolation tests that create two grants for one Content Request and prove each guest projection, workspace mutation, asset lookup, and submission lookup cannot observe the other.
- Add authorization tests proving a token cannot change its request, assigned Person, expiry, grant state, administrator feedback, or synthesis selection.
- Add projection tests proving guest responses cannot leak other respondents, Person directory entries, private context, agent jobs, audit records, or administrator-only metadata.
- Add expiry and retention tests proving expired and revoked grants block access while preserving the Response Workspace, assets, feedback, events, and Submissions.
- Add notification tests proving only Submission, approaching expiry, and upload failure create active notifications, with idempotent scheduling and no autosave/open noise.
- Add upload tests for permitted MIME types, size bounds, failed upload recovery, transcript association, submission blocking while required uploads are unsettled, and post-submission immutability.
- Add accessibility tests for keyboard operation, focus restoration, screen-reader names, progressive disclosure state, dialog semantics, sticky-action reachability, and reduced-motion behavior.
- Add responsive visual and interaction tests at mobile founder widths first, then desktop admin layouts. The production experience must retain the approved prototype hierarchy without relying on prototype-only state.
- Add agent-processing tests with multiple Submissions, explicit include/exclude selection, conflicting practitioner claims, missing evidence, priority operator instructions, and immutable Deliverable version creation.
- Add security tests proving plaintext tokens never appear in persisted records, structured logs, audit payloads, analytics, error responses, or administrator list results.
- A good acceptance test fails when a user-visible contract or security invariant breaks and remains stable through internal refactors.

## Out of Scope

- Sending response links from FairLend by email, SMS, Slack, Teams, or another channel.
- OTP, password, social login, device binding, or independent legal identity verification for respondents.
- A guest-visible Person selector or respondent self-registration flow.
- Anonymous public surveys, organization-wide public forms, or reusable invitation links.
- Exposing other respondents, collaborative respondent-to-respondent editing, or shared respondent comments.
- Allowing administrators or agents to edit provisional or submitted respondent evidence.
- Replacing or migrating away from the existing read-only Public Share capability.
- Automatically publishing the generated article to a CMS or external channel.
- Treating practitioner claims as legal, regulatory, underwriting, or compliance determinations without separate verification.
- General-purpose CRM contact management beyond the minimum Person fields and inline creation required for assignment.
- Automatic outbound follow-up to respondents.

## Further Notes

- The approved design direction is **A — Focused Proofline**.
- “Public link” is rejected terminology for this feature. Use **response link**, **access link**, or **Guest Access Grant**.
- The administrator trusts that the person receiving the token is the Person selected at generation time. The system is not intended to prove physical identity.
- Respondents are expected to belong to the same organization, but that trust does not weaken workspace and Submission isolation.
- The current read-only Public Share implementation and prototype Expert Interview interface are prior art, not completed production behavior.
- The existing local-agent Expert Interview operations are a foundation, but current processing is single-founder oriented. Completion of this spec requires multi-Submission processing through the same shared contract.
- Operator-provided instructions always outrank agent inference in research, request creation, respondent framing, inclusion selection, and synthesis.
