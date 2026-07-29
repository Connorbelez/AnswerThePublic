# Domain Context

## Content Request

**Definition:** The durable unit of work for one content obligation, including its source, context, contributors, drafts, workflow state, and delivery evidence.

**Relationships:** A Content Request can be a Standard Request or an Expert Interview. It owns context items, response workspaces, submissions, agent jobs, deliverables, targets, and access grants.

**Lifecycle:** Created → In progress → Founder complete → Ready to respond → Responded. It may be expired or archived without deleting retained work.

**Invariants:**

- Human-readable request IDs are stable.
- Operator-directed requests are Critical and sort ahead of inferred or automated work.
- Every mutation is attributed and auditable.
- Source text and submitted responses are immutable evidence.

**Non-goals:** A Content Request is not a publication, a generic task, or an anonymous survey.

## Expert Interview

**Definition:** A Content Request whose evidence strategy is to identify gaps in indexed knowledge and collect specific practitioner evidence that can close those gaps.

**Relationships:** It has one Interview Brief, one or more Knowledge Gaps, and one or more Interview Questions. Questions reference the gaps they are intended to close.

**Lifecycle:** Researched → Packaged → Assigned → Answering → Submitted → Processing → Draft ready.

**Invariants:**

- The Interview Brief records title, topic, summary, audience, framing, FairLend posture, and intended founder contribution.
- Every Knowledge Gap states existing coverage, why it is insufficient, the expert opportunity, and its supporting sources.
- Every Interview Question has a plain-language motivation and references at least one Knowledge Gap.
- Operator instructions take priority over agent-inferred choices.
- The request is Critical when created through the operator/local-agent expert-interview workflow.

**Non-goals:** An Expert Interview is not generic keyword research and does not ask questions already answered well by indexed sources.

## Knowledge Gap

**Definition:** A specific shortcoming in readily searchable knowledge that practitioner experience can materially improve.

**Relationships:** Belongs to one Expert Interview and is referenced by one or more Interview Questions.

**Invariants:**

- The gap is supported by inspected sources, not merely asserted.
- Source coverage and the expert opportunity are described separately.
- Typical kinds include confusing coverage, local-specific information, reality on the ground, practitioner best practice, fragmented how-to content, and missing evidence.

## Interview Question

**Definition:** A focused prompt designed to elicit practitioner evidence for one or more Knowledge Gaps.

**Relationships:** Belongs to one Expert Interview and references one or more Knowledge Gaps.

**Invariants:**

- The question and its motivation are both visible to the respondent.
- It is answerable from expertise, experience, or a concrete case.
- It does not lead the respondent toward an unsupported claim.

## Guest Access Grant

**Definition:** A request-scoped bearer capability assigned by an administrator to one known person so that person can answer without signing in.

**Relationships:** Belongs to one Content Request and one Person. It owns one independent Response Workspace.

**Lifecycle:** Generated → Opened → In progress → Submitted, or Expired/Revoked.

**Invariants:**

- The unguessable token grants access to one request only.
- The assigned Person is selected in the admin interface before generation and is never selected on the guest page.
- Assignment is immutable; a mistaken assignment is revoked and regenerated.
- Grants expire after 48 hours by default and may be independently revoked or renewed.
- Renewal rotates the token and reconnects the preserved Response Workspace.
- Other respondents and their work are never exposed.

**Non-goals:** A Guest Access Grant is not a public share, an organization-wide login, or proof of the recipient's legal identity.

## Response Workspace

**Definition:** The per-grant autosaved working area containing draft text, audio, attachments, transcripts, and answer progress.

**Relationships:** Belongs to one Guest Access Grant and yields zero or more immutable Submissions over its lifetime.

**Lifecycle:** Empty → Drafting → Submitted/Locked → Reopened, with Expired or Revoked access handled independently.

**Invariants:**

- Drafts are isolated by grant.
- Admins may observe provisional drafts and comment but cannot edit them.
- One active editor lease prevents silent cross-device overwrites; an explicit takeover is allowed.
- Expiry or revocation blocks access without deleting retained work.

## Submission

**Definition:** An immutable snapshot of a respondent's completed answers and supporting media.

**Relationships:** Belongs to one Response Workspace and is an attributable input to Expert Synthesis.

**Invariants:**

- Submission requires explicit confirmation.
- Each respondent's submission remains a separate source.
- Reopening produces later work without rewriting the historical submitted snapshot.

## Expert Synthesis

**Definition:** An agent-produced draft or evidence bundle created from the Interview Brief, Knowledge Gaps, questions, and selected attributable Submissions.

**Relationships:** Produces a versioned Deliverable and records the source response and context identifiers used.

**Invariants:**

- Practitioner statements are not silently promoted to independently verified facts.
- Disagreement and unresolved gaps remain visible.
- Operator synthesis instructions take priority.
- Completion creates a new deliverable or immutable deliverable version; it does not overwrite submitted evidence.
