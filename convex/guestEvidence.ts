import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  guestGrantParentAccess,
  requireActiveGuestGrantRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import {
  claimStorageObject,
  markStorageObjectDeleted,
} from "./lib/storageOwnership"
import {
  enqueueAdministratorNotifications,
  suppressGuestUploadFailureNotifications,
} from "./lib/notificationOutbox"
import {
  authenticatedGuestAccessNetworkSource,
  guestAccessBoundaryArgs,
  recordFailedGuestTokenAttempt,
} from "./lib/guestAccessBoundary"
import { standardResponseQuestionId } from "../shared/standard-response-question"

const MAX_AUDIO_BYTES = 25_000_000
const MAX_ATTACHMENT_BYTES = 15_000_000
const MAX_ASSETS_PER_WORKSPACE = 100
const UPLOAD_SESSION_LEASE_MS = 2 * 60_000
const TRANSCRIPTION_LEASE_MS = 2 * 60_000
const TRANSCRIPTION_PROVIDER_TIMEOUT_MS = 45_000
const MAX_TRANSCRIPTION_ATTEMPTS = 3

const AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
])
const ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
])

const assetKindValidator = v.union(v.literal("audio"), v.literal("attachment"))
const assetScopeValidator = v.union(
  v.object({ kind: v.literal("batch") }),
  v.object({
    kind: v.literal("question"),
    questionId: v.string(),
  })
)
const retryHistoryValidator = v.object({
  stage: v.union(v.literal("upload"), v.literal("transcription")),
  attempt: v.number(),
  outcome: v.union(
    v.literal("started"),
    v.literal("succeeded"),
    v.literal("failed")
  ),
  code: v.union(v.string(), v.null()),
  at: v.number(),
})
const assetFeedbackValidator = v.object({
  feedbackId: v.id("responseFeedback"),
  assetId: v.id("responseAssets"),
  body: v.string(),
  author: v.object({
    principalId: v.id("principals"),
    displayName: v.string(),
  }),
  createdAt: v.number(),
})
const publicAssetFeedbackValidator = v.object({
  feedbackId: v.id("responseFeedback"),
  assetId: v.id("responseAssets"),
  body: v.string(),
  author: v.object({ displayName: v.string() }),
  createdAt: v.number(),
})
const responseAssetValidator = v.object({
  assetId: v.id("responseAssets"),
  clientAssetId: v.string(),
  kind: assetKindValidator,
  scope: assetScopeValidator,
  fileName: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  uploadState: v.union(
    v.literal("uploading"),
    v.literal("uploaded"),
    v.literal("failed"),
    v.literal("discarded")
  ),
  transcriptionState: v.union(
    v.literal("not_applicable"),
    v.literal("queued"),
    v.literal("transcribing"),
    v.literal("transcribed"),
    v.literal("failed"),
    v.literal("discarded")
  ),
  transcript: v.union(v.string(), v.null()),
  transcriptVersion: v.number(),
  transcriptionLeaseExpiresAt: v.union(v.number(), v.null()),
  failureCode: v.union(v.string(), v.null()),
  retryHistory: v.array(retryHistoryValidator),
  version: v.number(),
  submittedAt: v.union(v.number(), v.null()),
  discardedAt: v.union(v.number(), v.null()),
  downloadUrl: v.union(v.string(), v.null()),
  feedback: v.array(publicAssetFeedbackValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
})
const retryResultValidator = v.object({
  asset: responseAssetValidator,
  uploadSessionId: v.union(v.id("responseAssetUploadSessions"), v.null()),
  uploadUrl: v.union(v.string(), v.null()),
  uploadRegistrationToken: v.union(v.string(), v.null()),
})

function required(value: string, field: string, maxLength = 200) {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > maxLength)
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return cleaned
}

async function feedbackFingerprint(input: Record<string, unknown>) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input))
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function tokenSecret() {
  const secret = process.env.GUEST_ACCESS_TOKEN_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32)
    throw new ConvexError({ code: "GUEST_ACCESS_SECRET_NOT_CONFIGURED" })
  return secret
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(tokenSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

async function uploadRegistrationCapability(
  uploadSessionId: Doc<"responseAssetUploadSessions">["_id"],
  inputFingerprint: string
) {
  return hmac(
    `guest-evidence-upload-registration:v1:${uploadSessionId}:${inputFingerprint}`
  )
}

async function activeGrantByToken(
  ctx: MutationCtx,
  rawToken: string,
  networkSource: string
) {
  const token = rawToken.trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const tokenHash = await hmac(token)
  const grant = await ctx.db
    .query("guestAccessGrants")
    .withIndex("by_token_hash", (index) =>
      index.eq("currentTokenHash", tokenHash)
    )
    .unique()
  const now = Date.now()
  const unavailable =
    !grant ||
    grant.revokedAt ||
    grant.state === "revoked" ||
    grant.expiresAt <= now
  if (unavailable) {
    if (!(await recordFailedGuestTokenAttempt(ctx, token, networkSource, now)))
      throw new ConvexError({ code: "RATE_LIMITED" })
    return null
  }
  await requireActiveGuestGrantRequest(ctx, grant)
  return grant
}

async function grantWorkspace(
  ctx: MutationCtx,
  token: string,
  networkSource: string,
  requireMutable = false
) {
  const grant = await activeGrantByToken(ctx, token, networkSource)
  if (!grant) throw new ConvexError({ code: "ACCESS_DENIED" })
  const workspace = await ctx.db
    .query("responseWorkspaces")
    .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
    .unique()
  if (!workspace) throw new ConvexError({ code: "NOT_FOUND" })
  if (requireMutable && workspace.lockedAt)
    throw new ConvexError({ code: "WORKSPACE_LOCKED" })
  return { grant, workspace }
}

async function requireGuestAccessBoundary(input: {
  token: string
  networkSource: string
  networkTimestamp: number
  networkProof: string
}) {
  const networkSource = await authenticatedGuestAccessNetworkSource(
    input,
    Date.now()
  )
  if (!networkSource) throw new ConvexError({ code: "ACCESS_DENIED" })
  return networkSource
}

async function assetParentIsActive(
  ctx: MutationCtx,
  asset: Doc<"responseAssets">
) {
  const grant = await ctx.db.get(asset.grantId)
  if (
    !grant ||
    grant.organizationId !== asset.organizationId ||
    grant.requestId !== asset.requestId ||
    grant.revokedAt ||
    grant.state === "revoked" ||
    grant.expiresAt <= Date.now()
  )
    return false
  return (await guestGrantParentAccess(ctx, grant)).status === "active"
}

async function assertActiveEditorLease(
  workspace: Doc<"responseWorkspaces">,
  leaseId: string,
  leaseGeneration: number
) {
  const now = Date.now()
  const holderHash = await hmac(
    `editor-lease:${required(leaseId, "leaseId", 200)}`
  )
  if (
    !Number.isSafeInteger(leaseGeneration) ||
    leaseGeneration !== (workspace.leaseGeneration ?? 0) ||
    workspace.leaseHolderHash !== holderHash ||
    (workspace.leaseExpiresAt ?? 0) <= now
  )
    throw new ConvexError({ code: "EDITOR_LEASE_REQUIRED" })
}

async function assertQuestionScope(
  ctx: MutationCtx,
  requestId: Doc<"contentRequests">["_id"],
  scope: { kind: "batch" } | { kind: "question"; questionId: string }
) {
  if (scope.kind === "batch") return scope
  const questionId = required(scope.questionId, "questionId", 100)
  const [request, interview] = await Promise.all([
    ctx.db.get(requestId),
    ctx.db
      .query("expertInterviews")
      .withIndex("by_request", (index) => index.eq("requestId", requestId))
      .unique(),
  ])
  const authorized =
    request &&
    (interview
      ? interview.organizationId === request.organizationId &&
        interview.questions.some((question) => question.id === questionId)
      : (request.requestType ?? "standard") === "standard" &&
        standardResponseQuestionId(request._id) === questionId)
  if (!authorized) throw new ConvexError({ code: "QUESTION_NOT_FOUND" })
  return { kind: "question" as const, questionId }
}

function validateFile(
  kind: "audio" | "attachment",
  mimeTypeInput: string,
  sizeBytes: number
) {
  const mimeType = required(
    mimeTypeInput.split(";")[0] ?? "",
    "mimeType",
    100
  ).toLowerCase()
  const allowlist = kind === "audio" ? AUDIO_MIME_TYPES : ATTACHMENT_MIME_TYPES
  if (!allowlist.has(mimeType))
    throw new ConvexError({ code: "MIME_NOT_ALLOWED" })
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1)
    throw new ConvexError({ code: "VALIDATION_FAILED", field: "sizeBytes" })
  const maxBytes = kind === "audio" ? MAX_AUDIO_BYTES : MAX_ATTACHMENT_BYTES
  if (sizeBytes > maxBytes)
    throw new ConvexError({ code: "FILE_TOO_LARGE", maxBytes })
  return mimeType
}

function operationKey(assetId: Doc<"responseAssets">["_id"]) {
  return `asset:${assetId}`
}

async function addPendingOperation(
  ctx: MutationCtx,
  workspace: Doc<"responseWorkspaces">,
  assetId: Doc<"responseAssets">["_id"]
) {
  const key = operationKey(assetId)
  const pending = workspace.pendingRequiredOperationIds ?? []
  if (pending.includes(key)) return
  await ctx.db.patch(workspace._id, {
    pendingRequiredOperationIds: [...pending, key],
    updatedAt: Date.now(),
  })
}

async function settlePendingOperation(
  ctx: MutationCtx,
  workspaceId: Doc<"responseWorkspaces">["_id"],
  assetId: Doc<"responseAssets">["_id"]
) {
  const workspace = await ctx.db.get(workspaceId)
  if (!workspace) return
  const key = operationKey(assetId)
  const pending = workspace.pendingRequiredOperationIds ?? []
  if (!pending.includes(key)) return
  await ctx.db.patch(workspace._id, {
    pendingRequiredOperationIds: pending.filter(
      (candidate) => candidate !== key
    ),
    updatedAt: Date.now(),
  })
}

async function publicAsset(
  ctx: Pick<MutationCtx, "db" | "storage"> | Pick<QueryCtx, "db" | "storage">,
  asset: Doc<"responseAssets">,
  options: { includeDownloadUrl?: boolean } = {}
) {
  const feedback = await ctx.db
    .query("responseFeedback")
    .withIndex("by_workspace_created_at", (index) =>
      index.eq("workspaceId", asset.workspaceId)
    )
    .collect()
  return {
    assetId: asset._id,
    clientAssetId: asset.clientAssetId,
    kind: asset.kind,
    scope: asset.scope,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    uploadState: asset.uploadState,
    transcriptionState: asset.transcriptionState,
    transcript: asset.transcript ?? null,
    transcriptVersion: asset.transcriptVersion,
    transcriptionLeaseExpiresAt: asset.transcriptionLeaseExpiresAt ?? null,
    failureCode: asset.failureCode ?? null,
    retryHistory: asset.retryHistory.map((entry) => ({
      ...entry,
      code: entry.code ?? null,
    })),
    version: asset.version,
    submittedAt: asset.submittedAt ?? null,
    discardedAt: asset.discardedAt ?? null,
    downloadUrl:
      options.includeDownloadUrl && asset.storageId
        ? ((await ctx.storage.getUrl(asset.storageId)) ?? null)
        : null,
    feedback: feedback
      .filter(
        (entry) =>
          entry.scope.kind === "asset" && entry.scope.assetId === asset._id
      )
      .map((entry) => ({
        feedbackId: entry._id,
        assetId: asset._id,
        body: entry.body,
        author: { displayName: entry.authorDisplayName },
        createdAt: entry.createdAt,
      })),
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

function sameScope(
  left: Doc<"responseAssets">["scope"],
  right: Doc<"responseAssets">["scope"]
) {
  return (
    left.kind === right.kind &&
    (left.kind === "batch" ||
      (right.kind === "question" && left.questionId === right.questionId))
  )
}

function currentUploadAttempt(asset: Doc<"responseAssets">) {
  return (
    asset.retryHistory
      .filter(
        (entry) => entry.stage === "upload" && entry.outcome === "started"
      )
      .at(-1)?.attempt ?? 1
  )
}

async function recordUploadFailureSignals(
  ctx: MutationCtx,
  asset: Doc<"responseAssets">,
  grant: Doc<"guestAccessGrants">,
  failureCode: string,
  uploadSessionId: Doc<"responseAssetUploadSessions">["_id"],
  now: number
) {
  const request = await ctx.db.get(grant.requestId)
  if (!request || request.organizationId !== grant.organizationId)
    throw new ConvexError({ code: "NOT_FOUND" })
  const correlationId = `guest-upload-failed:${uploadSessionId}`
  const priorAudit = await ctx.db
    .query("auditEvents")
    .withIndex("by_request_operation_correlation", (index) =>
      index
        .eq("requestId", request._id)
        .eq("operation", "guest_evidence.upload_failed")
        .eq("correlationId", correlationId)
    )
    .unique()
  if (!priorAudit) {
    await ctx.db.insert("auditEvents", {
      organizationId: grant.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorGrantId: grant._id,
      credentialId: `guest-access-grant:${grant._id}`,
      operation: "guest_evidence.upload_failed",
      correlationId,
      occurredAt: now,
      afterVersion: request.aggregateVersion,
      inputFingerprint: await hmac(
        `guest-upload-failed:${asset._id}:${failureCode}`
      ),
    })
  }
  await enqueueAdministratorNotifications(
    ctx,
    request,
    "guest_upload_failed",
    now,
    {
      dedupeKey: `guest-upload-failed:${asset._id}`,
      grantId: grant._id,
      assetId: asset._id,
    }
  )
}

async function issueUploadSession(
  ctx: MutationCtx,
  workspace: Doc<"responseWorkspaces">,
  assetId: Doc<"responseAssets">["_id"],
  operationIdInput: string,
  input: Record<string, unknown>
) {
  const operationId = required(operationIdInput, "operationId", 200)
  const inputFingerprint = await hmac(`asset-upload:${JSON.stringify(input)}`)
  const prior = await ctx.db
    .query("responseAssetUploadSessions")
    .withIndex("by_asset_operation", (index) =>
      index.eq("assetId", assetId).eq("operationId", operationId)
    )
    .unique()
  if (prior) {
    if (prior.inputFingerprint !== inputFingerprint)
      throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
    if (prior.state !== "issued" || !prior.uploadUrl)
      throw new ConvexError({ code: "UPLOAD_SESSION_SETTLED" })
    return {
      uploadSessionId: prior._id,
      uploadUrl: prior.uploadUrl,
      uploadRegistrationToken: await uploadRegistrationCapability(
        prior._id,
        prior.inputFingerprint
      ),
      replayed: true,
    }
  }
  const now = Date.now()
  const uploadUrl = await ctx.storage.generateUploadUrl()
  const uploadSessionId = await ctx.db.insert("responseAssetUploadSessions", {
    workspaceId: workspace._id,
    assetId,
    leaseGeneration: workspace.leaseGeneration,
    leaseHolderHash: workspace.leaseHolderHash,
    operationId,
    inputFingerprint,
    uploadUrl,
    state: "issued",
    createdAt: now,
    updatedAt: now,
  })
  await ctx.scheduler.runAfter(
    UPLOAD_SESSION_LEASE_MS + 1_000,
    internal.guestEvidence.recoverUploadSession,
    { uploadSessionId, issuedAt: now }
  )
  return {
    uploadSessionId,
    uploadUrl,
    uploadRegistrationToken: await uploadRegistrationCapability(
      uploadSessionId,
      inputFingerprint
    ),
    replayed: false,
  }
}

async function priorAssetOperation(
  ctx: MutationCtx,
  workspaceId: Doc<"responseWorkspaces">["_id"],
  operationIdInput: string,
  input: Record<string, unknown>
) {
  const operationId = required(operationIdInput, "operationId", 200)
  const inputFingerprint = await hmac(
    `asset-operation:${JSON.stringify(input)}`
  )
  const prior = await ctx.db
    .query("responseAssetOperations")
    .withIndex("by_workspace_operation", (index) =>
      index.eq("workspaceId", workspaceId).eq("operationId", operationId)
    )
    .unique()
  if (prior && prior.inputFingerprint !== inputFingerprint)
    throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
  return { operationId, inputFingerprint, prior }
}

export const beginUpload = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    clientAssetId: v.string(),
    kind: assetKindValidator,
    scope: assetScopeValidator,
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  returns: v.object({
    asset: responseAssetValidator,
    uploadSessionId: v.id("responseAssetUploadSessions"),
    uploadUrl: v.string(),
    uploadRegistrationToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const networkSource = await requireGuestAccessBoundary(args)
    const { grant, workspace } = await grantWorkspace(
      ctx,
      args.token,
      networkSource,
      true
    )
    await assertActiveEditorLease(workspace, args.leaseId, args.leaseGeneration)
    const clientAssetId = required(args.clientAssetId, "clientAssetId", 120)
    const fileName = required(args.fileName, "fileName", 240)
    const mimeType = validateFile(args.kind, args.mimeType, args.sizeBytes)
    const scope = await assertQuestionScope(ctx, grant.requestId, args.scope)
    const existing = await ctx.db
      .query("responseAssets")
      .withIndex("by_grant_client_asset", (index) =>
        index.eq("grantId", grant._id).eq("clientAssetId", clientAssetId)
      )
      .unique()
    if (existing) {
      if (
        existing.workspaceId !== workspace._id ||
        existing.kind !== args.kind ||
        !sameScope(existing.scope, scope) ||
        existing.fileName !== fileName ||
        existing.mimeType !== mimeType ||
        existing.sizeBytes !== args.sizeBytes
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      if (existing.submittedAt)
        throw new ConvexError({ code: "ASSET_SUBMITTED" })
      if (existing.discardedAt)
        throw new ConvexError({ code: "ASSET_DISCARDED" })
      if (existing.storageId)
        throw new ConvexError({ code: "ASSET_ALREADY_UPLOADED" })
      const session = await issueUploadSession(
        ctx,
        workspace,
        existing._id,
        clientAssetId,
        {
          kind: args.kind,
          scope,
          fileName,
          mimeType,
          sizeBytes: args.sizeBytes,
        }
      )
      return {
        asset: await publicAsset(ctx, existing),
        uploadSessionId: session.uploadSessionId,
        uploadUrl: session.uploadUrl,
        uploadRegistrationToken: session.uploadRegistrationToken,
      }
    }
    const assets = await ctx.db
      .query("responseAssets")
      .withIndex("by_workspace_created_at", (index) =>
        index.eq("workspaceId", workspace._id)
      )
      .take(MAX_ASSETS_PER_WORKSPACE + 1)
    if (assets.length >= MAX_ASSETS_PER_WORKSPACE)
      throw new ConvexError({ code: "ASSET_LIMIT_REACHED" })
    const now = Date.now()
    const assetId = await ctx.db.insert("responseAssets", {
      organizationId: grant.organizationId,
      requestId: grant.requestId,
      grantId: grant._id,
      workspaceId: workspace._id,
      clientAssetId,
      kind: args.kind,
      scope,
      fileName,
      mimeType,
      sizeBytes: args.sizeBytes,
      uploadState: "uploading",
      transcriptionState: args.kind === "audio" ? "queued" : "not_applicable",
      transcriptVersion: 0,
      transcriptionAttempt: 0,
      retryHistory: [
        {
          stage: "upload",
          attempt: 1,
          outcome: "started",
          at: now,
        },
      ],
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    const asset = await ctx.db.get(assetId)
    if (!asset) throw new ConvexError({ code: "WRITE_FAILED" })
    await addPendingOperation(ctx, workspace, assetId)
    const session = await issueUploadSession(
      ctx,
      workspace,
      assetId,
      clientAssetId,
      {
        kind: args.kind,
        scope,
        fileName,
        mimeType,
        sizeBytes: args.sizeBytes,
      }
    )
    return {
      asset: await publicAsset(ctx, asset),
      uploadSessionId: session.uploadSessionId,
      uploadUrl: session.uploadUrl,
      uploadRegistrationToken: session.uploadRegistrationToken,
    }
  },
})

export const registerUploadObject = mutation({
  args: {
    assetId: v.id("responseAssets"),
    uploadSessionId: v.id("responseAssetUploadSessions"),
    storageId: v.id("_storage"),
    uploadRegistrationToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.uploadSessionId)
    if (!session) throw new ConvexError({ code: "UPLOAD_SESSION_INVALID" })
    const suppliedCapability = required(
      args.uploadRegistrationToken,
      "uploadRegistrationToken",
      128
    )
    const expectedCapability = await uploadRegistrationCapability(
      session._id,
      session.inputFingerprint
    )
    if (!constantTimeEqual(suppliedCapability, expectedCapability))
      throw new ConvexError({ code: "UPLOAD_SESSION_INVALID" })
    const asset = await ctx.db.get(session.assetId)
    const workspace = await ctx.db.get(session.workspaceId)
    const grant = asset ? await ctx.db.get(asset.grantId) : null
    if (
      !asset ||
      !workspace ||
      !grant ||
      asset._id !== args.assetId ||
      asset.workspaceId !== workspace._id ||
      session.assetId !== asset._id ||
      session.workspaceId !== workspace._id ||
      workspace.grantId !== grant._id ||
      asset.grantId !== grant._id ||
      asset.organizationId !== grant.organizationId ||
      workspace.organizationId !== grant.organizationId
    )
      throw new ConvexError({ code: "UPLOAD_SESSION_INVALID" })
    const parentAccess = await guestGrantParentAccess(ctx, grant)
    if (session.state === "finalized") {
      if (session.storageId !== args.storageId)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return null
    }
    if (session.state === "failed" && session.storageId === args.storageId)
      return null
    const metadata = await ctx.db.system.get(args.storageId)
    if (!metadata) throw new ConvexError({ code: "UPLOAD_SESSION_INVALID" })
    await claimStorageObject(
      ctx,
      args.storageId,
      "guest_evidence",
      String(asset._id)
    )
    const now = Date.now()
    const canAttach =
      session.state === "issued" &&
      !asset.discardedAt &&
      !asset.submittedAt &&
      !workspace.lockedAt &&
      !grant.revokedAt &&
      grant.state !== "revoked" &&
      grant.expiresAt > now &&
      parentAccess.status === "active" &&
      session.leaseGeneration !== undefined &&
      session.leaseGeneration === workspace.leaseGeneration &&
      Boolean(session.leaseHolderHash) &&
      session.leaseHolderHash === workspace.leaseHolderHash &&
      (workspace.leaseExpiresAt ?? 0) > now
    if (!canAttach) {
      const failureCode = "UPLOAD_REGISTRATION_REJECTED"
      await markStorageObjectDeleted(
        ctx,
        args.storageId,
        "guest_evidence",
        String(asset._id)
      )
      await ctx.storage.delete(args.storageId)
      await ctx.db.patch(session._id, {
        state: "failed",
        storageId: args.storageId,
        updatedAt: now,
      })
      await ctx.db.patch(asset._id, {
        uploadState: "failed",
        failureCode,
        retryHistory: [
          ...asset.retryHistory,
          {
            stage: "upload",
            attempt: currentUploadAttempt(asset),
            outcome: "failed",
            code: failureCode,
            at: now,
          },
        ],
        version: asset.version + 1,
        updatedAt: now,
      })
      if (parentAccess.status === "active")
        await recordUploadFailureSignals(
          ctx,
          asset,
          grant,
          failureCode,
          session._id,
          now
        )
      return null
    }
    if (session.storageId && session.storageId !== args.storageId)
      throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
    await ctx.db.patch(session._id, {
      storageId: args.storageId,
      updatedAt: now,
    })
    return null
  },
})

export const finalizeUpload = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    assetId: v.id("responseAssets"),
    uploadSessionId: v.id("responseAssetUploadSessions"),
    storageId: v.id("_storage"),
  },
  returns: responseAssetValidator,
  handler: async (ctx, args) => {
    const networkSource = await requireGuestAccessBoundary(args)
    const { grant, workspace } = await grantWorkspace(
      ctx,
      args.token,
      networkSource
    )
    await assertActiveEditorLease(workspace, args.leaseId, args.leaseGeneration)
    const asset = await ctx.db.get(args.assetId)
    if (
      !asset ||
      asset.grantId !== grant._id ||
      asset.workspaceId !== workspace._id
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    if (asset.submittedAt) throw new ConvexError({ code: "ASSET_SUBMITTED" })
    if (asset.discardedAt) throw new ConvexError({ code: "ASSET_DISCARDED" })
    if (workspace.lockedAt) throw new ConvexError({ code: "WORKSPACE_LOCKED" })
    const uploadSession = await ctx.db.get(args.uploadSessionId)
    if (
      !uploadSession ||
      uploadSession.assetId !== asset._id ||
      uploadSession.workspaceId !== workspace._id
    )
      throw new ConvexError({ code: "UPLOAD_SESSION_INVALID" })
    if (asset.storageId) {
      if (
        asset.storageId !== args.storageId ||
        uploadSession.storageId !== args.storageId ||
        uploadSession.state !== "finalized"
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return publicAsset(ctx, asset)
    }
    if (uploadSession.state !== "issued")
      throw new ConvexError({ code: "UPLOAD_SESSION_SETTLED" })
    if (uploadSession.storageId && uploadSession.storageId !== args.storageId)
      throw new ConvexError({ code: "UPLOAD_SESSION_INVALID" })
    const metadata = await ctx.db.system.get(args.storageId)
    const actualMimeType = metadata?.contentType?.split(";")[0]?.toLowerCase()
    if (
      !metadata ||
      metadata.size !== asset.sizeBytes ||
      (actualMimeType !== undefined && actualMimeType !== asset.mimeType)
    ) {
      const now = Date.now()
      if (metadata) {
        await claimStorageObject(
          ctx,
          args.storageId,
          "guest_evidence",
          String(asset._id)
        )
        await markStorageObjectDeleted(
          ctx,
          args.storageId,
          "guest_evidence",
          String(asset._id)
        )
        await ctx.storage.delete(args.storageId)
      }
      await ctx.db.patch(uploadSession._id, {
        state: "failed",
        storageId: args.storageId,
        uploadUrl: undefined,
        updatedAt: now,
      })
      await ctx.db.patch(asset._id, {
        uploadState: "failed",
        failureCode: "UPLOAD_METADATA_MISMATCH",
        retryHistory: [
          ...asset.retryHistory,
          {
            stage: "upload",
            attempt: asset.retryHistory.filter(
              (entry) => entry.stage === "upload"
            ).length,
            outcome: "failed",
            code: "UPLOAD_METADATA_MISMATCH",
            at: now,
          },
        ],
        version: asset.version + 1,
        updatedAt: now,
      })
      await recordUploadFailureSignals(
        ctx,
        asset,
        grant,
        "UPLOAD_METADATA_MISMATCH",
        uploadSession._id,
        now
      )
      const failed = await ctx.db.get(asset._id)
      if (!failed) throw new ConvexError({ code: "WRITE_FAILED" })
      return publicAsset(ctx, failed)
    }
    await claimStorageObject(
      ctx,
      args.storageId,
      "guest_evidence",
      String(asset._id)
    )
    const now = Date.now()
    const transcriptionState =
      asset.kind === "audio" ? ("queued" as const) : ("not_applicable" as const)
    await ctx.db.patch(asset._id, {
      storageId: args.storageId,
      uploadState: "uploaded",
      transcriptionState,
      failureCode: undefined,
      retryHistory: [
        ...asset.retryHistory,
        {
          stage: "upload",
          attempt: currentUploadAttempt(asset),
          outcome: "succeeded",
          at: now,
        },
      ],
      version: asset.version + 1,
      updatedAt: now,
    })
    await ctx.db.patch(uploadSession._id, {
      state: "finalized",
      storageId: args.storageId,
      uploadUrl: undefined,
      updatedAt: now,
    })
    await suppressGuestUploadFailureNotifications(ctx, asset._id, now)
    if (asset.kind === "audio") {
      await ctx.scheduler.runAfter(250, internal.guestEvidence.transcribe, {
        assetId: asset._id,
      })
    } else {
      await settlePendingOperation(ctx, workspace._id, asset._id)
    }
    const saved = await ctx.db.get(asset._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicAsset(ctx, saved)
  },
})

export const markUploadFailed = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    assetId: v.id("responseAssets"),
    uploadSessionId: v.id("responseAssetUploadSessions"),
    failureCode: v.string(),
  },
  returns: responseAssetValidator,
  handler: async (ctx, args) => {
    const networkSource = await requireGuestAccessBoundary(args)
    const { grant, workspace } = await grantWorkspace(
      ctx,
      args.token,
      networkSource,
      true
    )
    await assertActiveEditorLease(workspace, args.leaseId, args.leaseGeneration)
    const asset = await ctx.db.get(args.assetId)
    if (
      !asset ||
      asset.grantId !== grant._id ||
      asset.workspaceId !== workspace._id
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    if (asset.discardedAt) throw new ConvexError({ code: "ASSET_DISCARDED" })
    if (asset.storageId) return publicAsset(ctx, asset)
    const uploadSession = await ctx.db.get(args.uploadSessionId)
    if (
      !uploadSession ||
      uploadSession.assetId !== asset._id ||
      uploadSession.workspaceId !== workspace._id
    )
      throw new ConvexError({ code: "UPLOAD_SESSION_INVALID" })
    const failureCode = required(args.failureCode, "failureCode", 100)
    if (uploadSession.state === "failed") {
      if (asset.failureCode !== failureCode)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return publicAsset(ctx, asset)
    }
    if (uploadSession.state !== "issued")
      throw new ConvexError({ code: "UPLOAD_SESSION_SETTLED" })
    const now = Date.now()
    await ctx.db.patch(uploadSession._id, {
      state: "failed",
      uploadUrl: undefined,
      updatedAt: now,
    })
    if (uploadSession.storageId) {
      await markStorageObjectDeleted(
        ctx,
        uploadSession.storageId,
        "guest_evidence",
        String(asset._id)
      )
      await ctx.storage.delete(uploadSession.storageId)
    }
    await ctx.db.patch(asset._id, {
      uploadState: "failed",
      failureCode,
      retryHistory: [
        ...asset.retryHistory,
        {
          stage: "upload",
          attempt: currentUploadAttempt(asset),
          outcome: "failed",
          code: failureCode,
          at: now,
        },
      ],
      version: asset.version + 1,
      updatedAt: now,
    })
    await recordUploadFailureSignals(
      ctx,
      asset,
      grant,
      failureCode,
      uploadSession._id,
      now
    )
    const saved = await ctx.db.get(asset._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicAsset(ctx, saved)
  },
})

export const recoverUploadSession = internalMutation({
  args: {
    uploadSessionId: v.id("responseAssetUploadSessions"),
    issuedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.uploadSessionId)
    const now = Date.now()
    if (
      !session ||
      session.state !== "issued" ||
      session.createdAt !== args.issuedAt ||
      session.updatedAt + UPLOAD_SESSION_LEASE_MS > now
    )
      return null
    const asset = await ctx.db.get(session.assetId)
    if (
      !asset ||
      asset.uploadState !== "uploading" ||
      asset.storageId ||
      asset.submittedAt ||
      asset.discardedAt
    )
      return null
    if (!(await assetParentIsActive(ctx, asset))) return null
    const uploadAttempt =
      asset.retryHistory
        .filter(
          (entry) => entry.stage === "upload" && entry.outcome === "started"
        )
        .at(-1)?.attempt ?? 1
    await ctx.db.patch(session._id, {
      state: "failed",
      uploadUrl: undefined,
      updatedAt: now,
    })
    if (session.storageId) {
      await markStorageObjectDeleted(
        ctx,
        session.storageId,
        "guest_evidence",
        String(asset._id)
      )
      await ctx.storage.delete(session.storageId)
    }
    await ctx.db.patch(asset._id, {
      uploadState: "failed",
      failureCode: "UPLOAD_SESSION_TIMEOUT",
      retryHistory: [
        ...asset.retryHistory,
        {
          stage: "upload",
          attempt: uploadAttempt,
          outcome: "failed",
          code: "UPLOAD_SESSION_TIMEOUT",
          at: now,
        },
      ],
      version: asset.version + 1,
      updatedAt: now,
    })
    const grant = await ctx.db.get(asset.grantId)
    if (grant && grant.organizationId === asset.organizationId)
      await recordUploadFailureSignals(
        ctx,
        asset,
        grant,
        "UPLOAD_SESSION_TIMEOUT",
        session._id,
        now
      )
    return null
  },
})

export const listForGuest = mutation({
  args: { token: v.string(), ...guestAccessBoundaryArgs },
  returns: v.array(responseAssetValidator),
  handler: async (ctx, args) => {
    const networkSource = await requireGuestAccessBoundary(args)
    const { grant, workspace } = await grantWorkspace(
      ctx,
      args.token,
      networkSource
    )
    const assets = await ctx.db
      .query("responseAssets")
      .withIndex("by_workspace_created_at", (index) =>
        index.eq("workspaceId", workspace._id)
      )
      .order("asc")
      .collect()
    return Promise.all(
      assets
        .filter((asset) => asset.grantId === grant._id && !asset.discardedAt)
        .map((asset) => publicAsset(ctx, asset))
    )
  },
})

export const retry = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    assetId: v.id("responseAssets"),
    operationId: v.string(),
  },
  returns: retryResultValidator,
  handler: async (ctx, args) => {
    const networkSource = await requireGuestAccessBoundary(args)
    const { grant, workspace } = await grantWorkspace(
      ctx,
      args.token,
      networkSource,
      true
    )
    await assertActiveEditorLease(workspace, args.leaseId, args.leaseGeneration)
    const asset = await ctx.db.get(args.assetId)
    if (
      !asset ||
      asset.grantId !== grant._id ||
      asset.workspaceId !== workspace._id
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    if (asset.submittedAt) throw new ConvexError({ code: "ASSET_SUBMITTED" })
    if (asset.discardedAt) throw new ConvexError({ code: "ASSET_DISCARDED" })
    const now = Date.now()
    if (!asset.storageId || asset.uploadState === "failed") {
      const session = await issueUploadSession(
        ctx,
        workspace,
        asset._id,
        args.operationId,
        {
          kind: "retry_upload",
          assetId: asset._id,
        }
      )
      if (session.replayed)
        return {
          asset: await publicAsset(ctx, asset),
          uploadSessionId: session.uploadSessionId,
          uploadUrl: session.uploadUrl,
          uploadRegistrationToken: session.uploadRegistrationToken,
        }
      const uploadAttempt =
        asset.retryHistory.filter(
          (entry) => entry.stage === "upload" && entry.outcome === "started"
        ).length + 1
      await ctx.db.patch(asset._id, {
        uploadState: "uploading",
        failureCode: undefined,
        retryHistory: [
          ...asset.retryHistory,
          {
            stage: "upload",
            attempt: uploadAttempt,
            outcome: "started",
            at: now,
          },
        ],
        version: asset.version + 1,
        updatedAt: now,
      })
      const saved = await ctx.db.get(asset._id)
      if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
      return {
        asset: await publicAsset(ctx, saved),
        uploadSessionId: session.uploadSessionId,
        uploadUrl: session.uploadUrl,
        uploadRegistrationToken: session.uploadRegistrationToken,
      }
    }
    const staleTranscription =
      asset.transcriptionState === "transcribing" &&
      (asset.transcriptionLeaseExpiresAt ?? 0) <= now
    if (
      asset.kind !== "audio" ||
      (asset.transcriptionState !== "failed" && !staleTranscription)
    )
      return {
        asset: await publicAsset(ctx, asset),
        uploadSessionId: null,
        uploadUrl: null,
        uploadRegistrationToken: null,
      }
    const operation = await priorAssetOperation(
      ctx,
      workspace._id,
      args.operationId,
      {
        kind: "retry_transcription",
        assetId: asset._id,
      }
    )
    if (operation.prior)
      return {
        asset: await publicAsset(ctx, asset),
        uploadSessionId: null,
        uploadUrl: null,
        uploadRegistrationToken: null,
      }
    await ctx.db.patch(asset._id, {
      transcriptionState: "queued",
      transcriptionLeaseExpiresAt: undefined,
      failureCode: undefined,
      version: asset.version + 1,
      updatedAt: now,
    })
    await ctx.db.insert("responseAssetOperations", {
      workspaceId: workspace._id,
      assetId: asset._id,
      operationId: operation.operationId,
      kind: "retry_transcription",
      inputFingerprint: operation.inputFingerprint,
      resultVersion: asset.version + 1,
      createdAt: now,
    })
    await ctx.scheduler.runAfter(250, internal.guestEvidence.transcribe, {
      assetId: asset._id,
    })
    const saved = await ctx.db.get(asset._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return {
      asset: await publicAsset(ctx, saved),
      uploadSessionId: null,
      uploadUrl: null,
      uploadRegistrationToken: null,
    }
  },
})

export const discard = mutation({
  args: {
    token: v.string(),
    ...guestAccessBoundaryArgs,
    leaseId: v.string(),
    leaseGeneration: v.number(),
    assetId: v.id("responseAssets"),
    operationId: v.string(),
  },
  returns: responseAssetValidator,
  handler: async (ctx, args) => {
    const networkSource = await requireGuestAccessBoundary(args)
    const { grant, workspace } = await grantWorkspace(
      ctx,
      args.token,
      networkSource
    )
    await assertActiveEditorLease(workspace, args.leaseId, args.leaseGeneration)
    const asset = await ctx.db.get(args.assetId)
    if (
      !asset ||
      asset.grantId !== grant._id ||
      asset.workspaceId !== workspace._id
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    if (asset.submittedAt) throw new ConvexError({ code: "ASSET_SUBMITTED" })
    if (workspace.lockedAt) throw new ConvexError({ code: "WORKSPACE_LOCKED" })
    if (asset.discardedAt) return publicAsset(ctx, asset)
    const operation = await priorAssetOperation(
      ctx,
      workspace._id,
      args.operationId,
      { kind: "discard", assetId: asset._id }
    )
    if (operation.prior) return publicAsset(ctx, asset)
    const now = Date.now()
    await ctx.db.patch(asset._id, {
      uploadState: "discarded",
      transcriptionState: "discarded",
      discardedAt: now,
      failureCode: undefined,
      transcriptionLeaseExpiresAt: undefined,
      version: asset.version + 1,
      updatedAt: now,
    })
    await suppressGuestUploadFailureNotifications(ctx, asset._id, now)
    await settlePendingOperation(ctx, workspace._id, asset._id)
    const uploadSessions = await ctx.db
      .query("responseAssetUploadSessions")
      .withIndex("by_asset_operation", (index) =>
        index.eq("assetId", asset._id)
      )
      .collect()
    for (const uploadSession of uploadSessions) {
      if (uploadSession.state !== "issued" || !uploadSession.storageId) continue
      await markStorageObjectDeleted(
        ctx,
        uploadSession.storageId,
        "guest_evidence",
        String(asset._id)
      )
      await ctx.storage.delete(uploadSession.storageId)
      await ctx.db.patch(uploadSession._id, {
        state: "failed",
        uploadUrl: undefined,
        updatedAt: now,
      })
    }
    if (asset.storageId) {
      await markStorageObjectDeleted(
        ctx,
        asset.storageId,
        "guest_evidence",
        String(asset._id)
      )
      await ctx.storage.delete(asset.storageId)
    }
    await ctx.db.insert("responseAssetOperations", {
      workspaceId: workspace._id,
      assetId: asset._id,
      operationId: operation.operationId,
      kind: "discard",
      inputFingerprint: operation.inputFingerprint,
      resultVersion: asset.version + 1,
      createdAt: now,
    })
    const saved = await ctx.db.get(asset._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicAsset(ctx, saved)
  },
})

export const claimTranscription = internalMutation({
  args: { assetId: v.id("responseAssets") },
  returns: v.union(
    v.object({
      storageId: v.id("_storage"),
      mimeType: v.string(),
      attempt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    const now = Date.now()
    const stale =
      asset?.transcriptionState === "transcribing" &&
      (asset.transcriptionLeaseExpiresAt ?? 0) <= now
    if (
      !asset ||
      asset.kind !== "audio" ||
      !asset.storageId ||
      asset.discardedAt ||
      asset.submittedAt ||
      (asset.transcriptionState !== "queued" && !stale)
    )
      return null
    if (!(await assetParentIsActive(ctx, asset))) return null
    const workspace = await ctx.db.get(asset.workspaceId)
    if (!workspace || workspace.lockedAt) return null
    const attempt = asset.transcriptionAttempt + 1
    await ctx.db.patch(asset._id, {
      transcriptionState: "transcribing",
      transcriptionAttempt: attempt,
      transcriptionLeaseExpiresAt: now + TRANSCRIPTION_LEASE_MS,
      retryHistory: [
        ...asset.retryHistory,
        {
          stage: "transcription",
          attempt,
          outcome: "started",
          at: now,
        },
      ],
      version: asset.version + 1,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(
      TRANSCRIPTION_LEASE_MS + 1_000,
      internal.guestEvidence.recoverTranscription,
      { assetId: asset._id, attempt }
    )
    return {
      storageId: asset.storageId,
      mimeType: asset.mimeType,
      attempt,
    }
  },
})

export const recoverTranscription = internalMutation({
  args: {
    assetId: v.id("responseAssets"),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    const now = Date.now()
    if (
      !asset ||
      asset.transcriptionState !== "transcribing" ||
      asset.transcriptionAttempt !== args.attempt ||
      (asset.transcriptionLeaseExpiresAt ?? 0) > now ||
      asset.submittedAt ||
      asset.discardedAt
    )
      return null
    if (!(await assetParentIsActive(ctx, asset))) return null
    if (asset.transcriptionAttempt >= MAX_TRANSCRIPTION_ATTEMPTS) {
      await ctx.db.patch(asset._id, {
        transcriptionState: "failed",
        failureCode: "TRANSCRIPTION_TIMEOUT",
        transcriptionLeaseExpiresAt: undefined,
        retryHistory: [
          ...asset.retryHistory,
          {
            stage: "transcription",
            attempt: args.attempt,
            outcome: "failed",
            code: "TRANSCRIPTION_TIMEOUT",
            at: now,
          },
        ],
        version: asset.version + 1,
        updatedAt: now,
      })
      return null
    }
    await ctx.db.patch(asset._id, {
      transcriptionState: "queued",
      transcriptionLeaseExpiresAt: undefined,
      version: asset.version + 1,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.guestEvidence.transcribe, {
      assetId: asset._id,
    })
    return null
  },
})

export const completeTranscription = internalMutation({
  args: {
    assetId: v.id("responseAssets"),
    attempt: v.number(),
    transcript: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    const transcript = args.transcript.trim()
    if (
      !asset ||
      asset.transcriptionState !== "transcribing" ||
      asset.transcriptionAttempt !== args.attempt ||
      asset.submittedAt ||
      asset.discardedAt ||
      !transcript
    )
      return null
    if (!(await assetParentIsActive(ctx, asset))) return null
    const now = Date.now()
    await ctx.db.patch(asset._id, {
      transcriptionState: "transcribed",
      transcript: transcript.slice(0, 200_000),
      transcriptVersion: asset.transcriptVersion + 1,
      failureCode: undefined,
      transcriptionLeaseExpiresAt: undefined,
      retryHistory: [
        ...asset.retryHistory,
        {
          stage: "transcription",
          attempt: args.attempt,
          outcome: "succeeded",
          at: now,
        },
      ],
      version: asset.version + 1,
      updatedAt: now,
    })
    await settlePendingOperation(ctx, asset.workspaceId, asset._id)
    return null
  },
})

export const failTranscription = internalMutation({
  args: {
    assetId: v.id("responseAssets"),
    attempt: v.number(),
    failureCode: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId)
    if (
      !asset ||
      asset.transcriptionState !== "transcribing" ||
      asset.transcriptionAttempt !== args.attempt ||
      asset.submittedAt ||
      asset.discardedAt
    )
      return null
    if (!(await assetParentIsActive(ctx, asset))) return null
    const failureCode = required(args.failureCode, "failureCode", 100)
    const now = Date.now()
    await ctx.db.patch(asset._id, {
      transcriptionState: "failed",
      failureCode,
      transcriptionLeaseExpiresAt: undefined,
      retryHistory: [
        ...asset.retryHistory,
        {
          stage: "transcription",
          attempt: args.attempt,
          outcome: "failed",
          code: failureCode,
          at: now,
        },
      ],
      version: asset.version + 1,
      updatedAt: now,
    })
    return null
  },
})

export const transcribe = internalAction({
  args: { assetId: v.id("responseAssets") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(
      internal.guestEvidence.claimTranscription,
      args
    )
    if (!claim) return null
    const endpoint = process.env.FAIRLEND_TRANSCRIPTION_API_URL
    const apiKey = process.env.FAIRLEND_TRANSCRIPTION_API_KEY
    if (!endpoint || !apiKey) {
      await ctx.runMutation(internal.guestEvidence.failTranscription, {
        assetId: args.assetId,
        attempt: claim.attempt,
        failureCode: "TRANSCRIPTION_NOT_CONFIGURED",
      })
      return null
    }
    try {
      const audioUrl = await ctx.storage.getUrl(claim.storageId)
      if (!audioUrl) throw new Error("AUDIO_NOT_FOUND")
      const response = await fetch(audioUrl, {
        signal: AbortSignal.timeout(TRANSCRIPTION_PROVIDER_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error("AUDIO_FETCH_FAILED")
      const form = new FormData()
      form.set(
        "file",
        await response.blob(),
        `response.${claim.mimeType.split("/")[1] ?? "webm"}`
      )
      form.set("model", process.env.FAIRLEND_TRANSCRIPTION_MODEL ?? "whisper-1")
      const transcription = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TRANSCRIPTION_PROVIDER_TIMEOUT_MS),
      })
      if (!transcription.ok) throw new Error(`PROVIDER_${transcription.status}`)
      const result = (await transcription.json()) as { text?: unknown }
      if (typeof result.text !== "string" || !result.text.trim())
        throw new Error("EMPTY_TRANSCRIPT")
      await ctx.runMutation(internal.guestEvidence.completeTranscription, {
        assetId: args.assetId,
        attempt: claim.attempt,
        transcript: result.text,
      })
    } catch (error) {
      await ctx.runMutation(internal.guestEvidence.failTranscription, {
        assetId: args.assetId,
        attempt: claim.attempt,
        failureCode:
          error instanceof Error
            ? error.message.slice(0, 100)
            : "TRANSCRIPTION_FAILED",
      })
    }
    return null
  },
})

export const addAssetFeedback = mutation({
  args: {
    grantId: v.id("guestAccessGrants"),
    assetId: v.id("responseAssets"),
    body: v.string(),
    correlationId: v.string(),
  },
  returns: assetFeedbackValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const grant = await ctx.db.get(args.grantId)
    const asset = await ctx.db.get(args.assetId)
    const request = asset ? await ctx.db.get(asset.requestId) : null
    const workspace = asset ? await ctx.db.get(asset.workspaceId) : null
    if (
      !grant ||
      !asset ||
      !request ||
      !workspace ||
      grant.organizationId !== principal.organizationId ||
      asset.organizationId !== principal.organizationId ||
      request.organizationId !== principal.organizationId ||
      workspace.organizationId !== principal.organizationId ||
      asset.grantId !== grant._id ||
      asset.requestId !== grant.requestId ||
      workspace.grantId !== grant._id ||
      workspace.requestId !== request._id
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const body = required(args.body, "body", 5_000)
    const correlationId = required(args.correlationId, "correlationId", 120)
    const fingerprint = await feedbackFingerprint({
      kind: "asset_feedback",
      assetId: asset._id,
      body,
      actorPrincipalId: principal._id,
    })
    const prior = await ctx.db
      .query("responseLifecycleOperations")
      .withIndex("by_workspace_operation", (index) =>
        index
          .eq("workspaceId", asset.workspaceId)
          .eq("operationId", correlationId)
      )
      .unique()
    if (prior) {
      if (prior.inputFingerprint !== fingerprint || !prior.feedbackId)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      const feedback = await ctx.db.get(prior.feedbackId)
      if (!feedback || feedback.scope.kind !== "asset")
        throw new ConvexError({ code: "NOT_FOUND" })
      return {
        feedbackId: feedback._id,
        assetId: feedback.scope.assetId,
        body: feedback.body,
        author: {
          principalId: feedback.authorPrincipalId,
          displayName: feedback.authorDisplayName,
        },
        createdAt: feedback.createdAt,
      }
    }
    const now = Date.now()
    const authorDisplayName =
      principal.displayName?.trim() ||
      principal.email?.trim() ||
      "FairLend administrator"
    const feedbackId = await ctx.db.insert("responseFeedback", {
      organizationId: asset.organizationId,
      requestId: asset.requestId,
      grantId: asset.grantId,
      workspaceId: asset.workspaceId,
      scope: { kind: "asset", assetId: asset._id },
      body,
      authorPrincipalId: principal._id,
      authorDisplayName,
      credentialId: principal.credentialId,
      createdAt: now,
    })
    await ctx.db.insert("responseLifecycleOperations", {
      workspaceId: asset.workspaceId,
      operationId: correlationId,
      kind: "feedback",
      inputFingerprint: fingerprint,
      resultRevision: workspace.revision,
      feedbackId,
      createdAt: now,
    })
    await ctx.db.insert("responseWorkspaceEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      grantId: grant._id,
      workspaceId: workspace._id,
      kind: "feedback_added",
      leaseGeneration: workspace.leaseGeneration ?? 0,
      operationId: correlationId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      feedbackId,
      occurredAt: now,
    })
    const nextVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      aggregateVersion: nextVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "guest_response.feedback_added",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
      inputFingerprint: fingerprint,
    })
    return {
      feedbackId,
      assetId: asset._id,
      body,
      author: {
        principalId: principal._id,
        displayName: authorDisplayName,
      },
      createdAt: now,
    }
  },
})

export const inspectForAdmin = query({
  args: { grantId: v.id("guestAccessGrants") },
  returns: v.union(
    v.object({
      readOnly: v.literal(true),
      assets: v.array(
        v.object({
          asset: responseAssetValidator,
          feedback: v.array(assetFeedbackValidator),
        })
      ),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const grant = await ctx.db.get(args.grantId)
    if (!grant || grant.organizationId !== principal.organizationId) return null
    const workspace = await ctx.db
      .query("responseWorkspaces")
      .withIndex("by_grant", (index) => index.eq("grantId", grant._id))
      .unique()
    if (!workspace) return { readOnly: true as const, assets: [] }
    const [assets, feedback] = await Promise.all([
      ctx.db
        .query("responseAssets")
        .withIndex("by_workspace_created_at", (index) =>
          index.eq("workspaceId", workspace._id)
        )
        .order("asc")
        .collect(),
      ctx.db
        .query("responseFeedback")
        .withIndex("by_workspace_created_at", (index) =>
          index.eq("workspaceId", workspace._id)
        )
        .order("asc")
        .collect(),
    ])
    return {
      readOnly: true as const,
      assets: await Promise.all(
        assets
          .filter((asset) => !asset.discardedAt)
          .map(async (asset) => ({
            asset: await publicAsset(ctx, asset, {
              includeDownloadUrl: true,
            }),
            feedback: feedback
              .filter(
                (entry) =>
                  entry.scope.kind === "asset" &&
                  entry.scope.assetId === asset._id
              )
              .map((entry) => ({
                feedbackId: entry._id,
                assetId: asset._id,
                body: entry.body,
                author: {
                  principalId: entry.authorPrincipalId,
                  displayName: entry.authorDisplayName,
                },
                createdAt: entry.createdAt,
              })),
          }))
      ),
    }
  },
})
