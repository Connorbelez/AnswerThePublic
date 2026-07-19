import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"

import {
  AgentControlValidationError,
  agentControlOperations,
  executeAgentControlCommand,
  isAgentControlMutation,
  validateAgentControlCommand,
  type AgentControlCommand,
  type AgentControlOperation,
} from "@/application/agent-control-plane"
import { operationEnvelopeSchema } from "@/application/chatgpt-operation-schemas"
import {
  safeErrorResponse,
  type ContentRequestServiceFactory,
} from "@/application/content-request-http"
import type { ContentRequestService } from "@/application/content-requests"

export const consequentialChatGptOperations = [
  "request.expire",
  "request.archive",
  "job.fail",
  "deliverable.promote",
  "deliverable.set_primary",
  "target.set_required",
  "target.set_retention",
  "target.confirm",
  "target.reopen",
  "conflict.resolve",
  "share.create",
  "share.revoke",
] as const satisfies ReadonlyArray<AgentControlOperation>

const additiveChatGptOperations = [
  "request.create",
  "request.follow_up",
  "deliverable.create",
  "deliverable.version",
  "target.create",
] as const satisfies ReadonlyArray<AgentControlOperation>

const consequential = new Set<AgentControlOperation>(
  consequentialChatGptOperations
)
const additive = new Set<AgentControlOperation>(additiveChatGptOperations)
const readOperations = agentControlOperations.filter(
  (operation) => !isAgentControlMutation(operation)
)
const updateOperations = agentControlOperations.filter(
  (operation) =>
    isAgentControlMutation(operation) &&
    !consequential.has(operation) &&
    !additive.has(operation)
)

export const chatGptExecutionToolOperations = {
  content_requests_read: readOperations,
  content_requests_create: [...additiveChatGptOperations],
  content_requests_update: updateOperations,
  content_requests_confirm: [...consequentialChatGptOperations],
} satisfies Record<string, Array<AgentControlOperation>>

type ToolCallInput = {
  operation: AgentControlOperation
  arguments: Record<string, unknown>
  fields?: Array<string>
  idempotencyKey?: string
  confirmationToken?: string
  scopeHumanId?: string
}

function toolInput(value: Record<string, unknown>) {
  return value.command as ToolCallInput
}

const outputSchema = z.strictObject({
  ok: z.boolean(),
  operation: z.string().optional(),
  data: z.unknown().optional(),
  error: z
    .strictObject({
      code: z.string(),
      message: z.string(),
      status: z.number().optional(),
    })
    .optional(),
})

type SimpleMcpServer = {
  registerTool(
    name: string,
    config: {
      title: string
      description: string
      inputSchema: z.ZodType<Record<string, unknown>>
      outputSchema: typeof outputSchema
      annotations: ReturnType<typeof toolAnnotations>
    },
    callback: (input: Record<string, unknown>) => Promise<unknown>
  ): unknown
  connect(transport: WebStandardStreamableHTTPServerTransport): Promise<void>
}

function resultContent(
  structuredContent: z.infer<typeof outputSchema>,
  summary: string,
  isError = false
) {
  return {
    content: [
      { type: "text" as const, text: summary },
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
    isError,
  }
}

function errorContent(
  code: string,
  message: string,
  operation?: string,
  status?: number
) {
  return resultContent(
    {
      ok: false,
      operation,
      error: { code, message, status },
    },
    `${code}: ${message}`,
    true
  )
}

function operationSummary(operation: string, data: unknown) {
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>
    if (record.kind === "candidates" && Array.isArray(record.candidates))
      return `Found ${record.candidates.length} possible matches. Select a stable Content Request ID; no match was guessed.`
    if (Array.isArray(record.page))
      return `${operation} returned ${record.page.length} item${record.page.length === 1 ? "" : "s"}.`
    if (typeof record.humanId === "string")
      return `${operation} succeeded for ${record.humanId}${typeof record.title === "string" ? ` — ${record.title}` : ""}.`
    const nestedRequest = record.request
    if (
      typeof nestedRequest === "object" &&
      nestedRequest !== null &&
      typeof (nestedRequest as Record<string, unknown>).humanId === "string"
    )
      return `${operation} resolved ${(nestedRequest as Record<string, unknown>).humanId as string}.`
  }
  return `${operation} succeeded.`
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalize(item)).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function stringToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  )
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function base64UrlToString(value: string) {
  return new TextDecoder().decode(base64UrlToBytes(value))
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
    )
  )
}

async function verifyHmac(value: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  try {
    return crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(value)
    )
  } catch {
    return false
  }
}

async function credentialBinding(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(authorization)
  )
  return bytesToBase64Url(new Uint8Array(digest))
}

async function snapshotDigest(snapshot: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalize(snapshot))
  )
  return bytesToBase64Url(new Uint8Array(digest))
}

type ConfirmationPayload = {
  operation: AgentControlOperation
  arguments: Record<string, unknown>
  idempotencyKey: string
  scopeHumanId: string
  snapshotDigest: string
  expectedAggregateVersion: number
  credentialBinding: string
  expiresAt: number
}

async function mintConfirmationToken(
  input: ToolCallInput,
  request: Request,
  secret: string,
  now: number,
  snapshot: unknown
) {
  const payload: ConfirmationPayload = {
    operation: input.operation,
    arguments: input.arguments,
    idempotencyKey: input.idempotencyKey!,
    scopeHumanId: input.scopeHumanId!,
    snapshotDigest: await snapshotDigest(snapshot),
    expectedAggregateVersion: (
      snapshot as { request: { aggregateVersion: number } }
    ).request.aggregateVersion,
    credentialBinding: await credentialBinding(request),
    expiresAt: now + 5 * 60 * 1_000,
  }
  const encoded = stringToBase64Url(canonicalize(payload))
  return `${encoded}.${await hmac(encoded, secret)}`
}

async function verifyConfirmationToken(
  input: ToolCallInput,
  request: Request,
  secret: string,
  now: number
) {
  const [encoded, signature, extra] = input.confirmationToken?.split(".") ?? []
  if (!encoded || !signature || extra) return null
  if (!(await verifyHmac(encoded, signature, secret))) return null
  try {
    const payload = JSON.parse(
      base64UrlToString(encoded)
    ) as ConfirmationPayload
    const valid =
      payload.expiresAt >= now &&
      payload.operation === input.operation &&
      payload.idempotencyKey === input.idempotencyKey &&
      payload.scopeHumanId === input.scopeHumanId &&
      typeof payload.snapshotDigest === "string" &&
      Number.isSafeInteger(payload.expectedAggregateVersion) &&
      payload.credentialBinding === (await credentialBinding(request)) &&
      canonicalize(payload.arguments) === canonicalize(input.arguments)
    return valid ? payload : null
  } catch {
    return null
  }
}

function previewError(code: string) {
  const error = new Error(code) as Error & { data: { code: string } }
  error.data = { code }
  return error
}

function stringArgument(input: ToolCallInput, name: string) {
  const value = input.arguments[name]
  if (typeof value !== "string") throw previewError("VALIDATION_FAILED")
  return value
}

function requestSnapshot(
  request: Awaited<ReturnType<ContentRequestService["getByHumanId"]>>
) {
  if (!request) throw previewError("NOT_FOUND")
  return {
    humanId: request.humanId,
    title: request.title,
    priority: request.priority,
    lifecycle: request.lifecycle,
    disposition: request.disposition,
    retention: request.retention,
    aggregateVersion: request.aggregateVersion,
    updatedAt: request.updatedAt,
  }
}

async function findArchivedTarget(
  service: ContentRequestService,
  humanId: string,
  targetId: string
) {
  let cursor: string | null = null
  do {
    const page = await service.listArchivedDeliveryTargets(humanId, cursor)
    const target = page.page.find(
      (candidate) => candidate.targetId === targetId
    )
    if (target) return target
    cursor = page.nextCursor
  } while (cursor)
  return null
}

async function previewConsequentialAction(
  service: ContentRequestService,
  input: ToolCallInput
) {
  const scopeHumanId = input.scopeHumanId
  if (!scopeHumanId) throw previewError("VALIDATION_FAILED")
  const request = await service.getByHumanId(scopeHumanId)
  const requestState = requestSnapshot(request)
  const argumentHumanId = input.arguments.humanId
  if (typeof argumentHumanId === "string" && argumentHumanId !== scopeHumanId)
    throw previewError("RESOURCE_ACCESS_DENIED")

  const base = { request: requestState }
  if (input.operation === "request.archive")
    return {
      summary: `Archive ${scopeHumanId} — ${requestState.title}. It is currently ${requestState.retention}.`,
      snapshot: base,
    }
  if (input.operation === "request.expire")
    return {
      summary: `Expire ${scopeHumanId} — ${requestState.title}. Reason: ${stringArgument(input, "reason")}.`,
      snapshot: { ...base, reason: input.arguments.reason },
    }

  if (input.operation === "job.fail") {
    const jobInput = await service.getAgentJobInput(
      stringArgument(input, "jobId")
    )
    if (jobInput.job.requestHumanId !== scopeHumanId)
      throw previewError("RESOURCE_ACCESS_DENIED")
    const job = {
      jobId: jobInput.job.jobId,
      requestHumanId: jobInput.job.requestHumanId,
      status: jobInput.job.status,
      attempts: jobInput.job.attempts,
      maxAttempts: jobInput.job.maxAttempts,
      leaseGeneration: jobInput.job.leaseGeneration,
      updatedAt: jobInput.job.updatedAt,
    }
    return {
      summary: `Mark drafting job ${job.jobId} failed for ${scopeHumanId} with ${stringArgument(input, "errorCode")}${input.arguments.transient !== false ? " (retryable)" : " (permanent)"}.`,
      snapshot: {
        ...base,
        job,
        errorCode: input.arguments.errorCode,
        transient: input.arguments.transient ?? true,
      },
    }
  }

  if (
    input.operation === "deliverable.promote" ||
    input.operation === "deliverable.set_primary" ||
    input.operation === "target.confirm" ||
    input.operation === "share.create"
  ) {
    const deliverables = await service.listDeliverables(scopeHumanId)
    if (input.operation === "share.create") {
      const requestedIds = input.arguments.deliverableIds as Array<string>
      const selectedDeliverables = requestedIds.map((deliverableId) => {
        const deliverable = deliverables.find(
          (candidate) => candidate.deliverableId === deliverableId
        )
        if (!deliverable) throw previewError("NOT_FOUND")
        const promotedVersion = deliverable.versions.find(
          (version) => version.versionId === deliverable.promotedVersionId
        )
        return {
          deliverableId: deliverable.deliverableId,
          name: deliverable.name,
          kind: deliverable.kind,
          promotedVersion: promotedVersion
            ? {
                versionId: promotedVersion.versionId,
                ordinal: promotedVersion.ordinal,
                body: promotedVersion.body,
              }
            : null,
        }
      })
      const contexts = await service.listContext(scopeHumanId)
      const requestedContextIds = input.arguments
        .contextItemIds as Array<string>
      const selectedContext = requestedContextIds.map((contextId) => {
        const context = contexts.find(
          (candidate) => candidate.contextId === contextId
        )
        if (!context) throw previewError("NOT_FOUND")
        return context
      })
      return {
        summary: `Publish a public view of ${scopeHumanId} — ${requestState.title}, containing ${selectedContext.length} brief section${selectedContext.length === 1 ? "" : "s"} (${selectedContext.map((item) => item.title).join(", ") || "none"}) and ${selectedDeliverables.length} deliverable${selectedDeliverables.length === 1 ? "" : "s"} (${selectedDeliverables.map((item) => item.name).join(", ") || "none"})${typeof input.arguments.expiresAt === "number" ? `, expiring ${new Date(input.arguments.expiresAt).toISOString()}` : ", with no expiry"}.`,
        snapshot: {
          ...base,
          context: selectedContext,
          deliverables: selectedDeliverables,
          expiresAt: input.arguments.expiresAt ?? null,
        },
      }
    }

    const confirmationTargets =
      input.operation === "target.confirm"
        ? await service.listDeliveryTargets(scopeHumanId)
        : []
    const confirmationTarget = confirmationTargets.find(
      (candidate) => candidate.targetId === input.arguments.targetId
    )
    if (input.operation === "target.confirm" && !confirmationTarget)
      throw previewError("NOT_FOUND")
    const selectedDeliverableId =
      confirmationTarget?.deliverableId ??
      stringArgument(input, "deliverableId")
    const deliverable = deliverables.find(
      (candidate) => candidate.deliverableId === selectedDeliverableId
    )
    if (!deliverable) throw previewError("NOT_FOUND")
    const deliverableState = {
      deliverableId: deliverable.deliverableId,
      name: deliverable.name,
      kind: deliverable.kind,
      isPrimary: deliverable.isPrimary,
      currentCandidateVersionId: deliverable.currentCandidateVersionId,
      promotedVersionId: deliverable.promotedVersionId,
      updatedAt: deliverable.updatedAt,
    }
    if (input.operation === "deliverable.set_primary") {
      const currentPrimaryDeliverableId =
        deliverables.find((candidate) => candidate.isPrimary)?.deliverableId ??
        null
      const alreadyApplied =
        currentPrimaryDeliverableId === deliverable.deliverableId
      const willConflict =
        currentPrimaryDeliverableId !==
          input.arguments.expectedPrimaryDeliverableId && !alreadyApplied
      return {
        summary: willConflict
          ? `The expected primary ${String(input.arguments.expectedPrimaryDeliverableId)} is stale (current: ${currentPrimaryDeliverableId ?? "none"}); confirming will create an attention-required primary-deliverable conflict for “${deliverable.name}”, not change the primary.`
          : alreadyApplied
            ? `“${deliverable.name}” (${deliverable.deliverableId}) is already the primary deliverable for ${scopeHumanId}; confirmation will return the applied state without creating a conflict.`
            : `Make “${deliverable.name}” (${deliverable.deliverableId}) the primary deliverable for ${scopeHumanId}.`,
        snapshot: {
          ...base,
          deliverable: deliverableState,
          currentPrimaryDeliverableId,
          expectedPrimaryDeliverableId:
            input.arguments.expectedPrimaryDeliverableId,
          expectedOutcome: willConflict
            ? "attention_required"
            : alreadyApplied
              ? "already_applied"
              : "applied",
        },
      }
    }
    const version = deliverable.versions.find(
      (candidate) => candidate.versionId === stringArgument(input, "versionId")
    )
    if (!version) throw previewError("NOT_FOUND")
    const versionState = {
      versionId: version.versionId,
      ordinal: version.ordinal,
      changeSummary: version.changeSummary,
      body: version.body,
      createdAt: version.createdAt,
    }
    if (input.operation === "deliverable.promote") {
      const alreadyApplied = deliverable.promotedVersionId === version.versionId
      const willConflict =
        deliverable.promotedVersionId !==
          input.arguments.expectedPromotedVersionId && !alreadyApplied
      return {
        summary: willConflict
          ? `The expected promoted version ${String(input.arguments.expectedPromotedVersionId)} is stale (current: ${deliverable.promotedVersionId ?? "none"}); confirming will create an attention-required promotion conflict for version ${version.ordinal} of “${deliverable.name}”, not promote it.`
          : alreadyApplied
            ? `Version ${version.ordinal} of “${deliverable.name}” (${version.versionId}) is already promoted for ${scopeHumanId}; confirmation will return the applied state without creating a conflict. Content: ${version.body}`
            : `Promote version ${version.ordinal} of “${deliverable.name}” (${version.versionId}) for ${scopeHumanId}. Content: ${version.body}`,
        snapshot: {
          ...base,
          deliverable: deliverableState,
          version: versionState,
          expectedPromotedVersionId: input.arguments.expectedPromotedVersionId,
          expectedOutcome: willConflict
            ? "attention_required"
            : alreadyApplied
              ? "already_applied"
              : "applied",
        },
      }
    }

    const target = confirmationTarget
    if (!target || target.deliverableId !== deliverable.deliverableId)
      throw previewError("NOT_FOUND")
    return {
      summary: `Confirm “${deliverable.name}” version ${version.ordinal} as responded via ${target.channel} to ${target.destinationLabel}${target.destinationUrl ? ` (${target.destinationUrl})` : ""}. Content: ${version.body}`,
      snapshot: {
        ...base,
        deliverable: deliverableState,
        version: versionState,
        target,
        note: input.arguments.note ?? null,
        integrationSuccessId: input.arguments.integrationSuccessId ?? null,
      },
    }
  }

  if (
    input.operation === "target.set_required" ||
    input.operation === "target.set_retention" ||
    input.operation === "target.reopen"
  ) {
    const targets = await service.listDeliveryTargets(scopeHumanId)
    const targetId = stringArgument(input, "targetId")
    const activeTarget = targets.find(
      (candidate) => candidate.targetId === stringArgument(input, "targetId")
    )
    const target =
      activeTarget ??
      (input.operation === "target.set_retention" &&
      input.arguments.retention === "active"
        ? await findArchivedTarget(service, scopeHumanId, targetId)
        : null)
    if (!target) throw previewError("NOT_FOUND")
    const effect =
      input.operation === "target.set_required"
        ? `set ${input.arguments.isRequired === true ? "required" : "optional"}`
        : input.operation === "target.set_retention"
          ? `${String(input.arguments.retention)}`
          : "reopen its current response"
    return {
      summary: `${target.channel} → ${target.destinationLabel}${target.destinationUrl ? ` (${target.destinationUrl})` : ""}: ${effect} for ${scopeHumanId}.`,
      snapshot: { ...base, target, effect: input.arguments },
    }
  }

  if (input.operation === "conflict.resolve") {
    const conflicts = await service.listOpenSemanticConflicts(scopeHumanId)
    const conflict = conflicts.find(
      (candidate) =>
        candidate.conflictId === stringArgument(input, "conflictId")
    )
    if (!conflict) throw previewError("NOT_FOUND")
    return {
      summary: `Resolve ${conflict.field} conflict ${conflict.conflictId} for ${scopeHumanId}: current “${conflict.currentValue}”, proposed “${conflict.proposedValue}”, select “${stringArgument(input, "selectedValue")}”.`,
      snapshot: {
        ...base,
        conflict,
        selectedValue: input.arguments.selectedValue,
      },
    }
  }

  if (input.operation === "share.revoke") {
    const shares = await service.listPublicShares(scopeHumanId)
    const share = shares.find(
      (candidate) => candidate.shareId === stringArgument(input, "shareId")
    )
    if (!share) throw previewError("NOT_FOUND")
    return {
      summary: `Revoke public share ${share.shareId} for ${scopeHumanId} — ${requestState.title}; it exposes ${share.briefSectionCount} brief section${share.briefSectionCount === 1 ? "" : "s"} and ${share.deliverableCount} deliverable${share.deliverableCount === 1 ? "" : "s"}.`,
      snapshot: { ...base, share },
    }
  }

  throw previewError("VALIDATION_FAILED")
}

function commandFor(input: ToolCallInput) {
  const argumentsWithCorrelation = { ...input.arguments }
  if (isAgentControlMutation(input.operation)) {
    argumentsWithCorrelation.correlationId = input.idempotencyKey
    if (input.operation === "job.claim")
      argumentsWithCorrelation.leaseToken = input.idempotencyKey
  }
  return {
    operation: input.operation,
    arguments: argumentsWithCorrelation,
    fields: input.fields,
    idempotencyKey: input.idempotencyKey,
  } satisfies AgentControlCommand
}

async function executeTool(
  service: ContentRequestService,
  input: ToolCallInput,
  expectedAggregateVersion?: number
) {
  try {
    const command = commandFor(input)
    validateAgentControlCommand(command)
    if (expectedAggregateVersion !== undefined)
      command.arguments.expectedAggregateVersion = expectedAggregateVersion
    const data = await executeAgentControlCommand(service, command)
    return resultContent(
      { ok: true, operation: input.operation, data },
      operationSummary(input.operation, data)
    )
  } catch (error) {
    if (error instanceof AgentControlValidationError)
      return errorContent(
        "VALIDATION_FAILED",
        `Invalid operation argument: ${error.field}.`,
        input.operation,
        400
      )
    const response = safeErrorResponse(error)
    const payload = (await response.json()) as {
      error: { code: string; message: string }
    }
    return errorContent(
      payload.error.code,
      payload.error.message,
      input.operation,
      response.status
    )
  }
}

async function mappedErrorContent(error: unknown, operation?: string) {
  if (error instanceof AgentControlValidationError)
    return errorContent(
      "VALIDATION_FAILED",
      `Invalid operation argument: ${error.field}.`,
      operation,
      400
    )
  const response = safeErrorResponse(error)
  const payload = (await response.json()) as {
    error: { code: string; message: string }
  }
  return errorContent(
    payload.error.code,
    payload.error.message,
    operation,
    response.status
  )
}

function toolAnnotations(options: {
  readOnly: boolean
  destructive: boolean
  idempotent: boolean
}) {
  return {
    readOnlyHint: options.readOnly,
    destructiveHint: options.destructive,
    idempotentHint: options.idempotent,
    openWorldHint: false,
  }
}

function buildServer(
  service: ContentRequestService,
  request: Request,
  confirmationSecret: string,
  now: () => number
) {
  const server = new McpServer({
    name: "fairlend-content-requests",
    version: "1.0.0",
    description: "Private FairLend Content Request workflow app",
  }) as unknown as SimpleMcpServer
  server.registerTool(
    "content_requests_read",
    {
      title: "Read FairLend Content Requests",
      description:
        "Search, resolve, and inspect authorized Content Requests and their complete workflow state. Every operation publishes exact stable-ID arguments; fuzzy ambiguity returns candidates and never guesses.",
      inputSchema: operationEnvelopeSchema(readOperations, { mutation: false }),
      outputSchema,
      annotations: toolAnnotations({
        readOnly: true,
        destructive: false,
        idempotent: true,
      }),
    },
    async (input) => executeTool(service, toolInput(input))
  )
  server.registerTool(
    "content_requests_create",
    {
      title: "Create FairLend Content Request Records",
      description:
        "Create additive Content Request, follow-up, deliverable-version, and target records with stable retry keys. Raw founder input remains unavailable.",
      inputSchema: operationEnvelopeSchema(additiveChatGptOperations, {
        mutation: true,
      }),
      outputSchema,
      annotations: toolAnnotations({
        readOnly: false,
        destructive: false,
        idempotent: true,
      }),
    },
    async (input) => executeTool(service, toolInput(input))
  )
  server.registerTool(
    "content_requests_update",
    {
      title: "Update FairLend Content Request Workflow",
      description:
        "Update mutable workflow state. This class may overwrite reversible metadata and includes non-idempotent lease heartbeat behavior, so the host must treat it as destructive and not assume retries are safe.",
      inputSchema: operationEnvelopeSchema(updateOperations, {
        mutation: true,
      }),
      outputSchema,
      annotations: toolAnnotations({
        readOnly: false,
        destructive: true,
        idempotent: false,
      }),
    },
    async (input) => executeTool(service, toolInput(input))
  )
  server.registerTool(
    "content_requests_preview",
    {
      title: "Preview a Consequential Content Request Action",
      description:
        "Preview the exact stable IDs and effect for promotion, delivery, archival, conflict resolution, failure, or public-share actions. Returns a credential-bound five-minute challenge; it does not mutate state.",
      inputSchema: operationEnvelopeSchema(consequentialChatGptOperations, {
        mutation: true,
        confirmationScope: true,
      }),
      outputSchema,
      annotations: toolAnnotations({
        readOnly: true,
        destructive: false,
        idempotent: true,
      }),
    },
    async (rawInput) => {
      const input = toolInput(rawInput)
      const command = commandFor(input)
      try {
        validateAgentControlCommand(command)
        const preview = await previewConsequentialAction(service, input)
        const previewedAt = now()
        const confirmationToken = await mintConfirmationToken(
          input,
          request,
          confirmationSecret,
          previewedAt,
          preview.snapshot
        )
        const data = {
          operation: input.operation,
          scopeHumanId: input.scopeHumanId,
          arguments: input.arguments,
          snapshot: preview.snapshot,
          idempotencyKey: input.idempotencyKey,
          confirmationToken,
          expiresAt: previewedAt + 5 * 60 * 1_000,
        }
        return resultContent(
          { ok: true, operation: input.operation, data },
          `${preview.summary} Review this exact current-state snapshot and explicitly approve it.`
        )
      } catch (error) {
        return mappedErrorContent(error, input.operation)
      }
    }
  )
  server.registerTool(
    "content_requests_confirm",
    {
      title: "Confirm a Consequential Content Request Action",
      description:
        "Execute the exact previewed action after host-level user approval. Requires the short-lived credential-bound challenge from content_requests_preview; changed IDs or effects are rejected.",
      inputSchema: operationEnvelopeSchema(consequentialChatGptOperations, {
        mutation: true,
        confirmationToken: true,
        confirmationScope: true,
      }),
      outputSchema,
      annotations: toolAnnotations({
        readOnly: false,
        destructive: true,
        idempotent: true,
      }),
    },
    async (rawInput) => {
      const input = toolInput(rawInput)
      try {
        const confirmation = await verifyConfirmationToken(
          input,
          request,
          confirmationSecret,
          now()
        )
        if (!confirmation)
          return errorContent(
            "CONFIRMATION_REQUIRED",
            "Preview this exact action again and obtain host-level user approval before retrying.",
            input.operation,
            409
          )
        return executeTool(
          service,
          input,
          confirmation.expectedAggregateVersion
        )
      } catch (error) {
        return mappedErrorContent(error, input.operation)
      }
    }
  )
  return server
}

function configuredAllowedOrigins() {
  return (
    process.env.FAIRLEND_CHATGPT_ALLOWED_ORIGINS ??
    "https://chatgpt.com,https://chat.openai.com"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

function originAllowed(request: Request) {
  const origin = request.headers.get("origin")
  return !origin || configuredAllowedOrigins().includes(origin)
}

export function createChatGptAppHandler(
  serviceForRequest: ContentRequestServiceFactory,
  options: { confirmationSecret?: string; now?: () => number } = {}
) {
  const handle = async ({ request }: { request: Request }) => {
    if (!originAllowed(request))
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32003, message: "Forbidden browser origin." },
        },
        { status: 403 }
      )
    let service: ContentRequestService
    try {
      service = await serviceForRequest(request)
      await service.list(1)
    } catch (error) {
      return safeErrorResponse(error)
    }
    const confirmationSecret =
      options.confirmationSecret ??
      process.env.FAIRLEND_CHATGPT_CONFIRMATION_SECRET
    if (!confirmationSecret || confirmationSecret.length < 32)
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "ChatGPT confirmation signing is not configured.",
          },
        },
        { status: 503 }
      )
    const server = buildServer(
      service,
      request,
      confirmationSecret,
      options.now ?? Date.now
    )
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      allowedOrigins: configuredAllowedOrigins(),
      enableDnsRebindingProtection: true,
    })
    await server.connect(transport)
    return transport.handleRequest(request)
  }
  return { GET: handle, POST: handle, DELETE: handle }
}
