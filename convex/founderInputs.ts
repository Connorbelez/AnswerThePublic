import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireEditor, requirePrincipal } from "./lib/authorization"
import { requestQueueSortKey } from "./lib/requestOrdering"

const founderInputValidator = v.object({
  documentId: v.id("founderInputDocuments"),
  requestHumanId: v.string(),
  text: v.string(),
  revision: v.number(),
  hasMeaningfulDraft: v.boolean(),
  updatedAt: v.number(),
})

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
    const saved = await ctx.db.get(documentId)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    const latestRequest = advancesLifecycle
      ? await ctx.db.get(request._id)
      : request
    if (!latestRequest) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicFounderInput(latestRequest, saved)
  },
})
