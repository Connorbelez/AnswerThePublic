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
