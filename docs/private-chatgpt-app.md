# Private ChatGPT App

The FairLend ChatGPT App is a stateless, authenticated MCP adapter over the
same application service used by the CLI and HTTP control plane. It runs on the
deployed TanStack Start server, so ChatGPT can operate Content Requests without
a desktop agent or local process.

## Connection

- MCP URL: `https://<deployment>/api/chatgpt/mcp`
- Transport: Streamable HTTP JSON-RPC (protocol `2025-06-18`)
- Authentication: `Authorization: Bearer <WorkOS Agent credential>`
- Production transport: HTTPS only

Create a dedicated WorkOS Agent registration for the private ChatGPT App and
configure its credential in the private ChatGPT connector. Do not reuse a
human session token or another agent's credential. Every request validates the
credential and registration with WorkOS, including access-token revocation,
before Convex acts as that registration's `agent_editor` identity. Audit events
therefore retain the exact registration credential ID.

Set `FAIRLEND_CHATGPT_ALLOWED_ORIGINS` to a comma-separated exact allowlist.
The default is:

```text
https://chatgpt.com,https://chat.openai.com
```

Requests with another browser `Origin` are rejected before authentication or
tool execution. Requests without an `Origin` remain valid for server-to-server
MCP clients.

Generate `FAIRLEND_CHATGPT_CONFIRMATION_SECRET` with at least 32 random
characters. It signs short-lived confirmation challenges and must remain
server-only.

## Tools

The tool list is generated from the shared V1 operation registry. Contract
tests fail if an operation is missing or appears in more than one tool.

| Tool                       | Use                                                                                            | Safety boundary                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `content_requests_read`    | Search, fuzzy resolve, and inspect all authorized workflow data                                | Read-only and idempotent; ambiguity returns candidates and never guesses                                             |
| `content_requests_create`  | Add requests, follow-ups, deliverables/versions, and targets                                   | Additive and idempotent through a stable retry key                                                                   |
| `content_requests_update`  | Update mutable workflow state                                                                  | Marked destructive and non-idempotent because the class includes overwrites and lease heartbeat                      |
| `content_requests_preview` | Resolve stable IDs into a current-state snapshot and mint a five-minute confirmation challenge | Read-only; token is bound to the operation, arguments, request scope, snapshot, retry key, credential, and expiry    |
| `content_requests_confirm` | Execute promotion, delivery, failure, conflict resolution, archival, or public-share actions   | Separate destructive host-approval prompt plus the exact challenge from `content_requests_preview`; changed IDs fail |

The MCP server also publishes two prompt templates:

- `expert_interview_research` instructs the calling agent to inspect indexed
  coverage, prove genuine practitioner knowledge gaps, and return the exact
  structured payload accepted by `expert_interview.create`.
- `expert_interview_synthesis` loads a completed interview by stable Content
  Request ID and returns the same grounded, attributed drafting workflow used
  by the UI, HTTP API, and CLI. It requires explicit decisions for every
  immutable Submission and preserves disagreements and unresolved evidence
  gaps instead of inventing consensus.

The expert-interview operations are available through the same discriminated
operation registry:

| Operation                               | Class  | Result                                                                                                                                                  |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expert_interview.research_prompt`      | Read   | A research and interview-construction prompt plus the next operation                                                                                    |
| `expert_interview.create`               | Create | A Critical Content Request with brief, evidenced gaps, question motivations, and instructions                                                           |
| `expert_interview.submissions`          | Create | Every immutable founder or guest Submission summary with attribution and current inclusion decision; the first call may freeze historical founder input |
| `expert_interview.submission_selection` | Update | Explicitly include or exclude one immutable Submission; undecided evidence is never synthesized                                                         |
| `expert_interview.processing_input`     | Create | Idempotently persists an attributed payload, canonical SHA-256, signed snapshot, and prompt                                                             |
| `expert_interview.complete_processing`  | Create | A new article deliverable or explicitly targeted immutable version with bound provenance                                                                |

Operator instructions are explicit fields in both prompt phases and take
priority over inferred agent choices. A local agent can therefore use MCP
Prompts directly, use the equivalent read and idempotent mutation operations, or
use the CLI wrappers; all three paths execute the same application workflow.

Each input schema contains a discriminated `command` union. Every operation
publishes its exact required/optional fields and describes stable IDs such as
`humanId`, `deliverableId`, `versionId`, `targetId`, and `conflictId`. ChatGPT
does not need to infer an argument contract from prose.

Each successful tool call returns both:

- a concise human summary in `content[0].text`; and
- the full machine result in `structuredContent.data` with the operation name.

The same machine result is serialized into `content[1].text` for MCP clients
that do not expose `structuredContent`.

Domain failures are MCP tool errors (`isError: true`) with stable codes in
`structuredContent.error`. Authentication and browser-origin failures remain
HTTP-level failures. Fuzzy lookup returns every candidate in structured data,
allowing ChatGPT to ask the user to select a stable ID.

## Confirmation and retry rules

ChatGPT first calls `content_requests_preview`, shows the exact record,
destination, version, and effect, then calls `content_requests_confirm`. The
host treats the latter as destructive and presents the user approval boundary.
The server additionally rejects missing, expired, credential-mismatched, or
argument-mismatched challenges. Consequential commands also provide a
`scopeHumanId`; the server resolves every opaque target, version, deliverable,
share, conflict, and job ID inside that authorized request before approval. The
signed challenge binds a digest of the complete preview snapshot, so any
request, selection, destination, or content change forces a fresh preview. The
approved aggregate version is checked inside the same Convex transaction as
the consequential write, closing the read/write race. Durable idempotency is
checked before that precondition, so an exact retry after an ambiguous success
still returns the original result instead of demanding a second approval.

Every mutation requires a stable idempotency key; retry the same intended
mutation with the same key and never reuse a key for different content. The
`content_requests_update` class is intentionally annotated non-idempotent:
`job.heartbeat` extends a live lease on every call, so do not automatically
retry it after an ambiguous response. For job claims, the key is the lease
token, preventing an ambiguous retry from claiming a second job.

## Smoke check

After deployment and private connector configuration:

1. List tools and verify the five tools above appear with discriminated
   operation schemas.
2. Run `request.resolve` with an ambiguous phrase and verify ChatGPT asks which
   candidate to use.
3. Create a request and verify its origin is `chatgpt_app`.
4. Preview `request.archive`, then call the confirm tool and verify ChatGPT
   displays a destructive-action approval boundary.
5. Approve it, then verify the request and audit event through the operator
   workspace. Altering the ID after preview must fail.
6. Revoke the WorkOS Agent registration and verify the next request returns
   `401 UNAUTHENTICATED`.

## Local-agent CLI

The ergonomic wrappers use `/api/v1/cli/control`, so they have the same
validation, attribution, authorization, and idempotency behavior as MCP:

```bash
content-requests expert-research-prompt \
  --topic "How bridge financing actually works when the timeline breaks" \
  --audience "Ontario mortgage brokers and borrowers" \
  --geography "Ontario" \
  --framing insider_knowledge \
  --instructions "Prioritize the operator's named examples"

content-requests expert-create \
  --file expert-interview.json \
  --idempotency-key expert-bridge-financing-v1

content-requests expert-processing-input CR-0241 \
  --submissions "submission-id-1,submission-id-2" \
  --instructions "Lead with the first-hour recovery checklist" \
  --idempotency-key expert-bridge-financing-prepare-v1

content-requests expert-processing-complete CR-0241 \
  --submissions "submission-id-1,submission-id-2" \
  --processing-token "<processingSnapshot.processingToken>" \
  --payload-digest "<payloadDigest>" \
  --deliverable-id "<optional exact existing article Deliverable ID>" \
  --file article-draft.md \
  --idempotency-key expert-bridge-financing-draft-v1
```

`expert-create` accepts the JSON shape returned by the research prompt.
`expert-processing-input` returns the exact attributed `processingPayload`, its
canonical `payloadDigest`, and a signed, expiring `processingSnapshot` bound to
that digest. It is an additive, idempotent mutation: an exact retry with the
same key reuses one canonical snapshot, while key reuse with different ordered
Submission IDs or instructions is rejected. The bundle includes the Interview Brief, evidenced Knowledge Gaps
and citations, questions and motivations, selected attributed answers, assets
and transcripts, existing article versions, and priority operator instructions.
First completion must echo the token, digest, and exact ordered Submission IDs;
Convex rejects altered, expired, cross-request, excluded, undecided, newly
included, package-drifted, context-drifted, or Deliverable-drifted evidence.
The prompt separates sourced facts, practitioner claims, editorial inference,
disagreements, and unresolved gaps, and forbids invented evidence or consensus.
Provenance records the digest, canonical bundle, selected Submission IDs, and
only the expert-context versions included in the payload. Omit
`--deliverable-id` to create a new Deliverable; pass an exact ID to add a
version, with no name-based lookup.
Exact idempotent retries return the originally committed projection even if the
token later expires or mutable request, inclusion, context, or Deliverable
state changes. Authenticated operators use this same prepare, inspect, export,
and complete operation in the request detail interface. The generic `control`
command remains available for automation that already builds operation
envelopes.
