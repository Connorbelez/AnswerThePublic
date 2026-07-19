import { ConvexError, v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import { Timeline } from "convex-timeline"
import { hash } from "fast-sha256"
import * as Automerge from "@automerge/automerge"

import type { Doc } from "./_generated/dataModel"
import { components } from "./_generated/api"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import {
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import { requestQueueSortKey } from "./lib/requestOrdering"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"

const founderInputValidator = v.object({
  documentId: v.id("founderInputDocuments"),
  requestHumanId: v.string(),
  text: v.string(),
  revision: v.number(),
  hasMeaningfulDraft: v.boolean(),
  automergeDocumentId: v.union(v.string(), v.null()),
  durableHeads: v.array(v.string()),
  lastSyncedAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
})

const automergeChangeValidator = v.object({
  hash: v.string(),
  data: v.string(),
})

const timelineMetadataValidator = v.object({
  actorPrincipalId: v.id("principals"),
  actorSubject: v.string(),
  correlationId: v.string(),
  occurredAt: v.number(),
})

const archivedVersionValidator = v.object({
  versionId: v.id("founderInputVersions"),
  revision: v.number(),
  actorPrincipalId: v.id("principals"),
  actorSubject: v.string(),
  correlationId: v.string(),
  occurredAt: v.number(),
})

const timeline = new Timeline(components.timeline, { maxNodesPerScope: 50 })

type CanonicalFounderDocument = {
  requestHumanId: string
  schemaVersion: 1
  text: string
  voiceTranscripts?: Record<string, { text: string; recordedAt: number }>
  seenVoiceCaptureIds?: Record<string, boolean>
}

type TimelineDocument = {
  text: string
  heads: string[]
  actorPrincipalId: Doc<"principals">["_id"]
  actorSubject: string
  correlationId: string
  occurredAt: number
}

function timelineMetadata(document: unknown) {
  const state = document as TimelineDocument
  return {
    actorPrincipalId: state.actorPrincipalId,
    actorSubject: state.actorSubject,
    correlationId: state.correlationId,
    occurredAt: state.occurredAt,
  }
}

const founderInputMetadataValidator = v.object({
  hasFounderDraft: v.boolean(),
  revision: v.number(),
  updatedAt: v.union(v.number(), v.null()),
})

function contentChecksum(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function base64Bytes(value: string) {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    throw new ConvexError({ code: "VALIDATION_FAILED", field: "changes" })
  }
}

function sha256(value: string) {
  return Array.from(hash(base64Bytes(value)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

async function canonicalFounderDocument(
  humanId: string,
  encodedChanges: Array<string>
) {
  try {
    const [document] = Automerge.applyChanges(
      Automerge.init<CanonicalFounderDocument>(),
      encodedChanges.map(base64Bytes)
    )
    const voiceTranscripts = document.voiceTranscripts
    if (
      document.schemaVersion !== 1 ||
      document.requestHumanId !== humanId ||
      typeof document.text !== "string" ||
      (voiceTranscripts !== undefined &&
        (typeof voiceTranscripts !== "object" ||
          voiceTranscripts === null ||
          Array.isArray(voiceTranscripts) ||
          Object.keys(voiceTranscripts).length > 100 ||
          Object.entries(voiceTranscripts).some(
            ([captureId, transcript]) =>
              !captureId ||
              captureId.length > 100 ||
              typeof transcript !== "object" ||
              transcript === null ||
              typeof transcript.text !== "string" ||
              transcript.text.length > 25_000 ||
              !Number.isFinite(transcript.recordedAt)
          )))
    ) {
      throw new Error("Founder document schema mismatch")
    }
    const materializedText = [
      document.text.trimEnd(),
      ...Object.entries(voiceTranscripts ?? {})
        .filter(([captureId]) => !document.seenVoiceCaptureIds?.[captureId])
        .sort(
          ([leftId, left], [rightId, right]) =>
            left.recordedAt - right.recordedAt || leftId.localeCompare(rightId)
        )
        .map(([, transcript]) => transcript.text.trim())
        .filter(Boolean),
    ]
      .filter((part) => part.trim())
      .join("\n\n")
    if (materializedText.length > 100_000) {
      throw new Error("Founder document length exceeded")
    }
    return {
      text: materializedText,
      heads: [...Automerge.getHeads(document)].sort(),
    }
  } catch {
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "changes",
      reason: "INVALID_AUTOMERGE_DOCUMENT",
    })
  }
}

async function requestForPrincipal(
  ctx: QueryCtx | MutationCtx,
  humanId: string
) {
  const principal = await requirePrincipal(ctx)
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (index) =>
      index
        .eq("organizationId", principal.organizationId)
        .eq("humanId", humanId.trim().toUpperCase())
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  return { principal, request }
}

function assertAssignedFounder(
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  request: Doc<"contentRequests">
) {
  if (principal.role !== "founder") {
    throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
  }
  if (
    (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
    principal._id
  ) {
    throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
  }
}

function assertFounderInputMutable(request: Doc<"contentRequests">) {
  requireActiveRequest(request)
  if (!["pending", "in_progress"].includes(request.lifecycle))
    throw new ConvexError({ code: "FOUNDER_INPUT_SUBMITTED" })
}

async function inputForRequest(
  ctx: QueryCtx | MutationCtx,
  requestId: Doc<"contentRequests">["_id"]
) {
  return ctx.db
    .query("founderInputDocuments")
    .withIndex("by_request", (index) => index.eq("requestId", requestId))
    .unique()
}

function publicFounderInput(
  request: Doc<"contentRequests">,
  document: Doc<"founderInputDocuments">
) {
  return {
    documentId: document._id,
    requestHumanId: request.humanId,
    text: document.text,
    revision: document.revision,
    hasMeaningfulDraft: document.hasMeaningfulDraft,
    automergeDocumentId: document.automergeDocumentId ?? null,
    durableHeads: document.durableHeads ?? [],
    lastSyncedAt: document.lastSyncedAt ?? null,
    updatedAt: document.updatedAt,
  }
}

export const getMine = query({
  args: { humanId: v.string() },
  returns: v.union(founderInputValidator, v.null()),
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    const document = await inputForRequest(ctx, request._id)
    if (document && document.founderPrincipalId !== principal._id) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }
    return document ? publicFounderInput(request, document) : null
  },
})

export const getMetadata = query({
  args: { humanId: v.string() },
  returns: founderInputMetadataValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    if (principal.role === "founder") assertAssignedFounder(principal, request)
    else requireEditor(principal)
    const document = await inputForRequest(ctx, request._id)
    return {
      hasFounderDraft: document?.hasMeaningfulDraft ?? false,
      revision: document?.revision ?? 0,
      updatedAt: document?.updatedAt ?? null,
    }
  },
})

export const saveText = mutation({
  args: {
    humanId: v.string(),
    text: v.string(),
    correlationId: v.string(),
  },
  returns: founderInputValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    assertFounderInputMutable(request)
    if (args.text.length > 100_000) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "text",
        reason: "MAX_LENGTH_EXCEEDED",
      })
    }
    const correlationId = args.correlationId.trim()
    if (!correlationId) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    }
    const inputFingerprint = contentChecksum(args.text)
    const existing = await inputForRequest(ctx, request._id)
    if (existing && existing.founderPrincipalId !== principal._id) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }
    const priorSave = await ctx.db
      .query("founderInputSaveOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (priorSave) {
      if (
        priorSave.requestId !== request._id ||
        priorSave.inputFingerprint !== inputFingerprint
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      }
      if (!existing) throw new ConvexError({ code: "WRITE_FAILED" })
      return publicFounderInput(request, existing)
    }

    const now = Date.now()
    const hasMeaningfulDraft = args.text.trim().length > 0
    const revision = existing
      ? existing.revision + (existing.text === args.text ? 0 : 1)
      : 1
    let documentId = existing?._id
    if (existing) {
      await ctx.db.patch(existing._id, {
        text: args.text,
        revision,
        hasMeaningfulDraft,
        updatedAt: now,
      })
    } else {
      documentId = await ctx.db.insert("founderInputDocuments", {
        organizationId: principal.organizationId,
        requestId: request._id,
        founderPrincipalId: principal._id,
        text: args.text,
        revision,
        hasMeaningfulDraft,
        createdAt: now,
        updatedAt: now,
      })
    }
    if (!documentId) throw new ConvexError({ code: "WRITE_FAILED" })

    await ctx.db.insert("founderInputSaveOperations", {
      organizationId: principal.organizationId,
      requestId: request._id,
      actorPrincipalId: principal._id,
      correlationId,
      inputFingerprint,
      createdAt: now,
    })

    const advancesLifecycle =
      hasMeaningfulDraft && request.lifecycle === "pending"
    const nextVersion = advancesLifecycle
      ? request.aggregateVersion + 1
      : request.aggregateVersion
    if (advancesLifecycle) {
      await ctx.db.patch(request._id, {
        lifecycle: "in_progress",
        aggregateVersion: nextVersion,
        queueSortKey: requestQueueSortKey(
          request.origin,
          request.priority,
          request.createdAt
        ),
        updatedAt: now,
      })
    }
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "founder_input.text_saved",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion: nextVersion,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const saved = await ctx.db.get(documentId)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    const latestRequest = advancesLifecycle
      ? await ctx.db.get(request._id)
      : request
    if (!latestRequest) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicFounderInput(latestRequest, saved)
  },
})

export const pullAutomergeChanges = query({
  args: { humanId: v.string(), documentId: v.string() },
  returns: v.object({
    changes: v.array(automergeChangeValidator),
    durableHeads: v.array(v.string()),
    materializedText: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    const document = await inputForRequest(ctx, request._id)
    if (document && document.founderPrincipalId !== principal._id) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }
    if (
      document?.automergeDocumentId &&
      document.automergeDocumentId !== args.documentId
    ) {
      throw new ConvexError({ code: "AUTOMERGE_DOCUMENT_MISMATCH" })
    }
    const changes = await ctx.db
      .query("automergeChanges")
      .withIndex("by_document_created_at", (index) =>
        index.eq("documentId", args.documentId)
      )
      .collect()
    if (
      changes.some(
        (change) =>
          change.organizationId !== principal.organizationId ||
          change.requestId !== request._id
      )
    ) {
      throw new ConvexError({ code: "ORGANIZATION_ACCESS_DENIED" })
    }
    return {
      changes: changes.map(({ hash: changeHash, data }) => ({
        hash: changeHash,
        data,
      })),
      durableHeads: document?.durableHeads ?? [],
      materializedText: document?.text ?? null,
    }
  },
})

export const submitAutomergeChanges = mutation({
  args: {
    humanId: v.string(),
    documentId: v.string(),
    changes: v.array(automergeChangeValidator),
    heads: v.array(v.string()),
    text: v.string(),
    correlationId: v.string(),
  },
  returns: founderInputValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    assertFounderInputMutable(request)
    if (args.text.length > 100_000) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "text",
        reason: "MAX_LENGTH_EXCEEDED",
      })
    }
    const documentId = args.documentId.trim()
    const correlationId = args.correlationId.trim()
    if (!documentId || documentId.length > 200) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "documentId",
      })
    }
    if (!correlationId || args.changes.length > 500) {
      throw new ConvexError({ code: "VALIDATION_FAILED" })
    }
    const uniqueHeads = [...new Set(args.heads)].sort()
    if (uniqueHeads.length > 100 || uniqueHeads.some((head) => !head.trim())) {
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "heads" })
    }
    for (const change of args.changes) {
      if (
        change.data.length > 2_000_000 ||
        sha256(change.data) !== change.hash
      ) {
        throw new ConvexError({
          code: "VALIDATION_FAILED",
          field: "changes",
          reason: "HASH_MISMATCH",
        })
      }
    }

    const existing = await inputForRequest(ctx, request._id)
    if (existing && existing.founderPrincipalId !== principal._id) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }
    if (
      existing?.automergeDocumentId &&
      existing.automergeDocumentId !== documentId
    ) {
      throw new ConvexError({ code: "AUTOMERGE_DOCUMENT_MISMATCH" })
    }

    const now = Date.now()
    const registry = await ctx.db
      .query("automergeDocuments")
      .withIndex("by_document_id", (index) =>
        index.eq("documentId", documentId)
      )
      .unique()
    if (
      registry &&
      (registry.organizationId !== principal.organizationId ||
        registry.requestId !== request._id ||
        registry.founderPrincipalId !== principal._id)
    ) {
      throw new ConvexError({ code: "AUTOMERGE_DOCUMENT_MISMATCH" })
    }
    const storedChanges = await ctx.db
      .query("automergeChanges")
      .withIndex("by_document_created_at", (index) =>
        index.eq("documentId", documentId)
      )
      .collect()
    if (
      storedChanges.some(
        (change) =>
          change.organizationId !== principal.organizationId ||
          change.requestId !== request._id
      )
    ) {
      throw new ConvexError({ code: "AUTOMERGE_DOCUMENT_MISMATCH" })
    }
    const changesByHash = new Map(
      storedChanges.map((change) => [change.hash, change.data])
    )
    for (const change of args.changes) {
      const priorData = changesByHash.get(change.hash)
      if (priorData && priorData !== change.data) {
        throw new ConvexError({ code: "AUTOMERGE_CHANGE_COLLISION" })
      }
      changesByHash.set(change.hash, change.data)
    }
    const canonical = await canonicalFounderDocument(request.humanId, [
      ...changesByHash.values(),
    ])
    if (!registry) {
      await ctx.db.insert("automergeDocuments", {
        organizationId: principal.organizationId,
        requestId: request._id,
        founderPrincipalId: principal._id,
        documentId,
        createdAt: now,
      })
    }
    for (const change of args.changes) {
      const prior = await ctx.db
        .query("automergeChanges")
        .withIndex("by_document_hash", (index) =>
          index.eq("documentId", documentId).eq("hash", change.hash)
        )
        .unique()
      if (!prior) {
        await ctx.db.insert("automergeChanges", {
          organizationId: principal.organizationId,
          requestId: request._id,
          documentId,
          hash: change.hash,
          data: change.data,
          actorPrincipalId: principal._id,
          correlationId,
          createdAt: now,
        })
      } else if (
        prior.organizationId !== principal.organizationId ||
        prior.requestId !== request._id ||
        prior.data !== change.data
      ) {
        throw new ConvexError({ code: "AUTOMERGE_CHANGE_COLLISION" })
      }
    }

    const revision = existing
      ? existing.revision + (existing.text === canonical.text ? 0 : 1)
      : 1
    const hasMeaningfulDraft = canonical.text.trim().length > 0
    let founderDocumentId = existing?._id
    if (existing) {
      await ctx.db.patch(existing._id, {
        text: canonical.text,
        revision,
        hasMeaningfulDraft,
        automergeDocumentId: documentId,
        durableHeads: canonical.heads,
        lastSyncedAt: now,
        updatedAt: now,
      })
    } else {
      founderDocumentId = await ctx.db.insert("founderInputDocuments", {
        organizationId: principal.organizationId,
        requestId: request._id,
        founderPrincipalId: principal._id,
        text: canonical.text,
        revision,
        hasMeaningfulDraft,
        automergeDocumentId: documentId,
        durableHeads: canonical.heads,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
    if (!founderDocumentId) throw new ConvexError({ code: "WRITE_FAILED" })

    const scope = `founder-input:${founderDocumentId}`
    const timelineState = await timeline.currentDocument(ctx, scope)
    if (
      !timelineState ||
      typeof timelineState !== "object" ||
      !("text" in timelineState) ||
      timelineState.text !== canonical.text
    ) {
      await timeline.push(ctx, scope, {
        text: canonical.text,
        heads: canonical.heads,
        actorPrincipalId: principal._id,
        actorSubject: principal.subject,
        correlationId,
        occurredAt: now,
      })
    }

    const advancesLifecycle =
      hasMeaningfulDraft && request.lifecycle === "pending"
    const afterVersion = advancesLifecycle
      ? request.aggregateVersion + 1
      : request.aggregateVersion
    if (advancesLifecycle) {
      await ctx.db.patch(request._id, {
        lifecycle: "in_progress",
        aggregateVersion: afterVersion,
        queueSortKey: requestQueueSortKey(
          request.origin,
          request.priority,
          request.createdAt
        ),
        updatedAt: now,
      })
    }
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "founder_input.automerge_synced",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const saved = await ctx.db.get(founderDocumentId)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    const latestArchivedVersion = await ctx.db
      .query("founderInputVersions")
      .withIndex("by_request_occurred_at", (index) =>
        index.eq("requestId", request._id)
      )
      .order("desc")
      .first()
    if (
      !latestArchivedVersion ||
      latestArchivedVersion.text !== canonical.text
    ) {
      await ctx.db.insert("founderInputVersions", {
        organizationId: principal.organizationId,
        requestId: request._id,
        documentId: founderDocumentId,
        text: canonical.text,
        heads: canonical.heads,
        revision,
        actorPrincipalId: principal._id,
        actorSubject: principal.subject,
        correlationId,
        occurredAt: now,
      })
    }
    return publicFounderInput(request, saved)
  },
})

export const getVersionHistory = query({
  args: { humanId: v.string() },
  returns: v.object({
    canUndo: v.boolean(),
    canRedo: v.boolean(),
    position: v.union(v.number(), v.null()),
    length: v.number(),
    entries: v.array(
      v.object({ position: v.number(), state: timelineMetadataValidator })
    ),
  }),
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    const document = await inputForRequest(ctx, request._id)
    if (!document) {
      return {
        canUndo: false,
        canRedo: false,
        position: null,
        length: 0,
        entries: [],
      }
    }
    if (document.founderPrincipalId !== principal._id) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }
    const scope = `founder-input:${document._id}`
    const [status, nodes] = await Promise.all([
      timeline.status(ctx, scope),
      timeline.listNodes(ctx, scope),
    ])
    return {
      ...status,
      canUndo: status.position !== null && status.position > 0,
      entries: nodes.map((node) => ({
        position: node.position,
        state: timelineMetadata(node.document),
      })),
    }
  },
})

export const listArchivedVersions = query({
  args: {
    humanId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(archivedVersionValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    const document = await inputForRequest(ctx, request._id)
    if (document && document.founderPrincipalId !== principal._id) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }
    const result = await ctx.db
      .query("founderInputVersions")
      .withIndex("by_request_occurred_at", (index) =>
        index.eq("requestId", request._id)
      )
      .order("desc")
      .paginate(args.paginationOpts)
    return {
      page: result.page.map((version) => ({
        versionId: version._id,
        revision: version.revision,
        actorPrincipalId: version.actorPrincipalId,
        actorSubject: version.actorSubject,
        correlationId: version.correlationId,
        occurredAt: version.occurredAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    }
  },
})

export const restoreArchivedVersion = mutation({
  args: {
    humanId: v.string(),
    versionId: v.id("founderInputVersions"),
    correlationId: v.string(),
  },
  returns: founderInputValidator,
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    assertFounderInputMutable(request)
    const document = await inputForRequest(ctx, request._id)
    if (!document) throw new ConvexError({ code: "NOT_FOUND" })
    if (document.founderPrincipalId !== principal._id) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }
    const correlationId = args.correlationId.trim()
    if (!correlationId) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    }
    const replay = await ctx.db
      .query("founderInputVersionRestoreOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (replay) {
      if (
        replay.requestId !== request._id ||
        replay.versionId !== args.versionId
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      }
      return {
        documentId: replay.documentId,
        requestHumanId: request.humanId,
        text: replay.result.text,
        revision: replay.result.revision,
        hasMeaningfulDraft: replay.result.hasMeaningfulDraft,
        automergeDocumentId: replay.result.automergeDocumentId ?? null,
        durableHeads: replay.result.durableHeads,
        lastSyncedAt: replay.result.lastSyncedAt ?? null,
        updatedAt: replay.result.updatedAt,
      }
    }
    const version = await ctx.db.get(args.versionId)
    if (
      !version ||
      version.organizationId !== principal.organizationId ||
      version.requestId !== request._id ||
      version.documentId !== document._id
    ) {
      throw new ConvexError({ code: "NOT_FOUND" })
    }
    const now = Date.now()
    const revision =
      document.revision + (document.text === version.text ? 0 : 1)
    await ctx.db.patch(document._id, {
      text: version.text,
      revision,
      hasMeaningfulDraft: version.text.trim().length > 0,
      updatedAt: now,
    })
    await timeline.push(ctx, `founder-input:${document._id}`, {
      text: version.text,
      heads: document.durableHeads ?? [],
      actorPrincipalId: principal._id,
      actorSubject: principal.subject,
      correlationId,
      occurredAt: now,
    })
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "founder_input.archived_version_restored",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    const saved = await ctx.db.get(document._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    await ctx.db.insert("founderInputVersionRestoreOperations", {
      organizationId: principal.organizationId,
      requestId: request._id,
      documentId: document._id,
      versionId: version._id,
      actorPrincipalId: principal._id,
      correlationId,
      result: {
        text: saved.text,
        revision: saved.revision,
        hasMeaningfulDraft: saved.hasMeaningfulDraft,
        automergeDocumentId: saved.automergeDocumentId,
        durableHeads: saved.durableHeads ?? [],
        lastSyncedAt: saved.lastSyncedAt,
        updatedAt: saved.updatedAt,
      },
      createdAt: now,
    })
    return publicFounderInput(request, saved)
  },
})

async function moveTimeline(
  ctx: MutationCtx,
  humanId: string,
  direction: "undo" | "redo",
  correlationIdInput: string
) {
  const { principal, request } = await requestForPrincipal(ctx, humanId)
  assertAssignedFounder(principal, request)
  assertFounderInputMutable(request)
  const document = await inputForRequest(ctx, request._id)
  if (!document) throw new ConvexError({ code: "NOT_FOUND" })
  if (document.founderPrincipalId !== principal._id) {
    throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
  }
  const correlationId = correlationIdInput.trim()
  if (!correlationId) {
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      field: "correlationId",
    })
  }
  const replay = await ctx.db
    .query("founderInputTimelineOperations")
    .withIndex("by_organization_actor_correlation", (index) =>
      index
        .eq("organizationId", principal.organizationId)
        .eq("actorPrincipalId", principal._id)
        .eq("correlationId", correlationId)
    )
    .unique()
  if (replay) {
    if (replay.requestId !== request._id || replay.direction !== direction) {
      throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
    }
    return {
      documentId: replay.documentId,
      requestHumanId: request.humanId,
      text: replay.result.text,
      revision: replay.result.revision,
      hasMeaningfulDraft: replay.result.hasMeaningfulDraft,
      automergeDocumentId: replay.result.automergeDocumentId ?? null,
      durableHeads: replay.result.durableHeads,
      lastSyncedAt: replay.result.lastSyncedAt ?? null,
      updatedAt: replay.result.updatedAt,
    }
  }
  const scope = `founder-input:${document._id}`
  const state = await timeline[direction](ctx, scope)
  if (!state || typeof state !== "object" || !("text" in state)) {
    throw new ConvexError({
      code: direction === "undo" ? "NOTHING_TO_UNDO" : "NOTHING_TO_REDO",
    })
  }
  const restored = state as TimelineDocument
  const now = Date.now()
  await ctx.db.patch(document._id, {
    text: restored.text,
    revision: document.revision + 1,
    hasMeaningfulDraft: restored.text.trim().length > 0,
    updatedAt: now,
  })
  const afterVersion = request.aggregateVersion + 1
  await ctx.db.patch(request._id, {
    aggregateVersion: afterVersion,
    updatedAt: now,
  })
  await ctx.db.insert("auditEvents", {
    organizationId: principal.organizationId,
    requestId: request._id,
    requestHumanId: request.humanId,
    actorPrincipalId: principal._id,
    credentialId: principal.credentialId,
    operation: `founder_input.${direction}`,
    correlationId,
    occurredAt: now,
    beforeVersion: request.aggregateVersion,
    afterVersion,
  })
  const saved = await ctx.db.get(document._id)
  if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
  await ctx.db.insert("founderInputTimelineOperations", {
    organizationId: principal.organizationId,
    requestId: request._id,
    documentId: document._id,
    actorPrincipalId: principal._id,
    direction,
    correlationId,
    result: {
      text: saved.text,
      revision: saved.revision,
      hasMeaningfulDraft: saved.hasMeaningfulDraft,
      automergeDocumentId: saved.automergeDocumentId,
      durableHeads: saved.durableHeads ?? [],
      lastSyncedAt: saved.lastSyncedAt,
      updatedAt: saved.updatedAt,
    },
    createdAt: now,
  })
  return publicFounderInput(request, saved)
}

export const undo = mutation({
  args: { humanId: v.string(), correlationId: v.string() },
  returns: founderInputValidator,
  handler: (ctx, args) =>
    moveTimeline(ctx, args.humanId, "undo", args.correlationId),
})

export const redo = mutation({
  args: { humanId: v.string(), correlationId: v.string() },
  returns: founderInputValidator,
  handler: (ctx, args) =>
    moveTimeline(ctx, args.humanId, "redo", args.correlationId),
})

export const assertDurablySynced = query({
  args: { humanId: v.string(), heads: v.array(v.string()) },
  returns: v.object({ synced: v.boolean(), durableHeads: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const { principal, request } = await requestForPrincipal(ctx, args.humanId)
    assertAssignedFounder(principal, request)
    const document = await inputForRequest(ctx, request._id)
    const durableHeads = [...(document?.durableHeads ?? [])].sort()
    const localHeads = [...new Set(args.heads)].sort()
    return {
      synced:
        durableHeads.length === localHeads.length &&
        durableHeads.every((head, index) => head === localHeads[index]),
      durableHeads,
    }
  },
})
