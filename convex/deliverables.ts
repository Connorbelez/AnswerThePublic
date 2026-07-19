import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
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
import { lifecycleForPrimary } from "./lib/deliverableLifecycle"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import {
  assertWithinRequestLimit,
  MAX_DELIVERABLES_PER_REQUEST,
} from "./lib/requestLimits"

const versionValidator = v.object({
  versionId: v.id("deliverableVersions"),
  body: v.string(),
  ordinal: v.number(),
  createdByPrincipalId: v.id("principals"),
  sourceJobId: v.union(v.id("agentJobs"), v.null()),
  changeSummary: v.union(v.string(), v.null()),
  createdAt: v.number(),
})

const deliverableValidator = v.object({
  deliverableId: v.id("deliverables"),
  requestHumanId: v.string(),
  kind: v.string(),
  name: v.string(),
  isPrimary: v.boolean(),
  currentCandidateVersionId: v.union(v.id("deliverableVersions"), v.null()),
  promotedVersionId: v.union(v.id("deliverableVersions"), v.null()),
  versions: v.array(versionValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const conflictValidator = v.object({
  conflictId: v.id("semanticConflicts"),
  requestHumanId: v.string(),
  field: v.union(
    v.literal("assigneePrincipalId"),
    v.literal("primaryDeliverableId"),
    v.literal("promotedVersionId")
  ),
  currentValue: v.string(),
  proposedValue: v.string(),
  expectedValue: v.string(),
  status: v.union(v.literal("open"), v.literal("resolved")),
  correlationId: v.string(),
  createdAt: v.number(),
  resolvedValue: v.union(v.string(), v.null()),
  resolvedAt: v.union(v.number(), v.null()),
})

const promotionResultValidator = v.union(
  v.object({
    outcome: v.literal("applied"),
    deliverable: deliverableValidator,
    conflict: v.null(),
  }),
  v.object({
    outcome: v.literal("attention_required"),
    deliverable: deliverableValidator,
    conflict: conflictValidator,
  })
)

const primaryResultValidator = v.union(
  v.object({
    outcome: v.literal("applied"),
    deliverables: v.array(deliverableValidator),
    conflict: v.null(),
  }),
  v.object({
    outcome: v.literal("attention_required"),
    deliverables: v.array(deliverableValidator),
    conflict: conflictValidator,
  })
)

function requiredText(value: string, max = 100_000) {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > max)
    throw new ConvexError({ code: "VALIDATION_FAILED" })
  return cleaned
}

async function requestByHumanId(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  humanId: string
) {
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("humanId", humanId.trim().toUpperCase())
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  return request
}

async function publicDeliverable(
  ctx: QueryCtx | MutationCtx,
  deliverable: Doc<"deliverables">
) {
  const request = await ctx.db.get(deliverable.requestId)
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  const versions = await ctx.db
    .query("deliverableVersions")
    .withIndex("by_deliverable_ordinal", (q) =>
      q.eq("deliverableId", deliverable._id)
    )
    .order("desc")
    .collect()
  return {
    deliverableId: deliverable._id,
    requestHumanId: request.humanId,
    kind: deliverable.kind,
    name: deliverable.name,
    isPrimary: deliverable.isPrimary,
    currentCandidateVersionId: deliverable.currentCandidateVersionId ?? null,
    promotedVersionId: deliverable.promotedVersionId ?? null,
    versions: versions.map((version) => ({
      versionId: version._id,
      body: version.body,
      ordinal: version.ordinal,
      createdByPrincipalId: version.createdByPrincipalId,
      sourceJobId: version.sourceJobId ?? null,
      changeSummary: version.changeSummary ?? null,
      createdAt: version.createdAt,
    })),
    createdAt: deliverable.createdAt,
    updatedAt: deliverable.updatedAt,
  }
}

async function requiredDeliverable(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  deliverableId: Doc<"deliverables">["_id"]
) {
  const deliverable = await ctx.db.get(deliverableId)
  if (!deliverable || deliverable.organizationId !== organizationId)
    throw new ConvexError({ code: "NOT_FOUND" })
  return deliverable
}

async function audit(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  operation: string,
  correlationId: string,
  now: number
) {
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
    operation,
    correlationId,
    occurredAt: now,
    beforeVersion: request.aggregateVersion,
    afterVersion,
  })
  await refreshOperatorWorkspaceProjection(ctx, request._id)
}

async function priorOperation(
  ctx: QueryCtx | MutationCtx,
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  operation: "create_derivative" | "create_version" | "set_primary",
  correlationId: string,
  inputFingerprint: string
) {
  const prior = await ctx.db
    .query("deliverableOperations")
    .withIndex("by_organization_actor_operation_correlation", (q) =>
      q
        .eq("organizationId", principal.organizationId)
        .eq("actorPrincipalId", principal._id)
        .eq("operation", operation)
        .eq("correlationId", correlationId)
    )
    .unique()
  if (prior && prior.inputFingerprint !== inputFingerprint)
    throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
  return prior
}

function publicConflict(
  requestHumanId: string,
  conflict: Doc<"semanticConflicts">
) {
  return {
    conflictId: conflict._id,
    requestHumanId,
    field: conflict.field,
    currentValue: conflict.currentValue,
    proposedValue: conflict.proposedValue,
    expectedValue: conflict.expectedValue,
    status: conflict.status,
    correlationId: conflict.correlationId,
    createdAt: conflict.createdAt,
    resolvedValue: conflict.resolvedValue ?? null,
    resolvedAt: conflict.resolvedAt ?? null,
  }
}

async function listRequestDeliverables(
  ctx: QueryCtx | MutationCtx,
  requestId: Doc<"contentRequests">["_id"]
) {
  const deliverables = await ctx.db
    .query("deliverables")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .collect()
  const result = await Promise.all(
    deliverables
      .filter((deliverable) => (deliverable.retention ?? "active") === "active")
      .map((deliverable) => publicDeliverable(ctx, deliverable))
  )
  return result.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt - b.createdAt
  )
}

async function findOrCreateConflict(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  field: "primaryDeliverableId" | "promotedVersionId",
  currentValue: string,
  proposedValue: string,
  expectedValue: string,
  correlationId: string
) {
  const replay = await findConflictReplay(
    ctx,
    request,
    principal,
    field,
    proposedValue,
    expectedValue,
    correlationId
  )
  if (replay) return replay
  const now = Date.now()
  const conflictId = await ctx.db.insert("semanticConflicts", {
    organizationId: principal.organizationId,
    requestId: request._id,
    field,
    currentValue,
    proposedValue,
    expectedValue,
    status: "open",
    createdByPrincipalId: principal._id,
    correlationId,
    createdAt: now,
  })
  await audit(
    ctx,
    request,
    principal,
    "content_request.semantic_conflict_created",
    correlationId,
    now
  )
  const conflict = await ctx.db.get(conflictId)
  if (!conflict) throw new ConvexError({ code: "WRITE_FAILED" })
  return conflict
}

async function findConflictReplay(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  field: "primaryDeliverableId" | "promotedVersionId",
  proposedValue: string,
  expectedValue: string,
  correlationId: string
) {
  const replay = await ctx.db
    .query("semanticConflicts")
    .withIndex("by_organization_creator_correlation", (q) =>
      q
        .eq("organizationId", principal.organizationId)
        .eq("createdByPrincipalId", principal._id)
        .eq("correlationId", correlationId)
    )
    .unique()
  if (replay) {
    if (
      replay.requestId !== request._id ||
      replay.field !== field ||
      replay.proposedValue !== proposedValue ||
      replay.expectedValue !== expectedValue
    )
      throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
    return replay
  }
  return null
}

export const list = query({
  args: { humanId: v.string() },
  returns: v.array(deliverableValidator),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await requestByHumanId(
      ctx,
      principal.organizationId,
      args.humanId
    )
    return listRequestDeliverables(ctx, request._id)
  },
})

export const createDerivative = mutation({
  args: {
    humanId: v.string(),
    kind: v.string(),
    name: v.string(),
    body: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: deliverableValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await requestByHumanId(
      ctx,
      principal.organizationId,
      args.humanId
    )
    const correlationId = requiredText(args.correlationId, 200)
    const inputFingerprint = JSON.stringify({
      requestId: request._id,
      kind: args.kind.trim(),
      name: args.name.trim(),
      body: args.body?.trim() ?? null,
    })
    const replay = await priorOperation(
      ctx,
      principal,
      "create_derivative",
      correlationId,
      inputFingerprint
    )
    if (replay)
      return publicDeliverable(
        ctx,
        await requiredDeliverable(
          ctx,
          principal.organizationId,
          replay.deliverableId
        )
      )
    requireActiveRequest(request)
    const requestDeliverables = await ctx.db
      .query("deliverables")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .take(MAX_DELIVERABLES_PER_REQUEST + 1)
    assertWithinRequestLimit(
      requestDeliverables.length,
      MAX_DELIVERABLES_PER_REQUEST,
      "deliverables"
    )
    const now = Date.now()
    const deliverableId = await ctx.db.insert("deliverables", {
      organizationId: principal.organizationId,
      requestId: request._id,
      kind: requiredText(args.kind, 100),
      name: requiredText(args.name, 200),
      isPrimary: false,
      retention: "active",
      createdAt: now,
      updatedAt: now,
    })
    if (args.body?.trim()) {
      const versionId = await ctx.db.insert("deliverableVersions", {
        organizationId: principal.organizationId,
        requestId: request._id,
        deliverableId,
        body: requiredText(args.body),
        ordinal: 1,
        createdByPrincipalId: principal._id,
        correlationId,
        changeSummary: "Initial derivative",
        createdAt: now,
      })
      await ctx.db.patch(deliverableId, {
        currentCandidateVersionId: versionId,
      })
    }
    await ctx.db.insert("deliverableOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      requestId: request._id,
      operation: "create_derivative",
      correlationId,
      inputFingerprint,
      deliverableId,
      createdAt: now,
    })
    await audit(
      ctx,
      request,
      principal,
      "deliverable.created",
      correlationId,
      now
    )
    return publicDeliverable(
      ctx,
      await requiredDeliverable(ctx, principal.organizationId, deliverableId)
    )
  },
})

export const createVersion = mutation({
  args: {
    deliverableId: v.id("deliverables"),
    body: v.string(),
    changeSummary: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: deliverableValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const deliverable = await requiredDeliverable(
      ctx,
      principal.organizationId,
      args.deliverableId
    )
    const request = await ctx.db.get(deliverable.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const inputFingerprint = JSON.stringify({
      deliverableId: deliverable._id,
      body: args.body.trim(),
      changeSummary: args.changeSummary?.trim() ?? null,
    })
    const replay = await priorOperation(
      ctx,
      principal,
      "create_version",
      correlationId,
      inputFingerprint
    )
    if (replay)
      return publicDeliverable(
        ctx,
        await requiredDeliverable(
          ctx,
          principal.organizationId,
          replay.deliverableId
        )
      )
    requireActiveRequest(request)
    if ((deliverable.retention ?? "active") !== "active")
      throw new ConvexError({ code: "DELIVERABLE_ARCHIVED" })
    const latest = await ctx.db
      .query("deliverableVersions")
      .withIndex("by_deliverable_ordinal", (q) =>
        q.eq("deliverableId", deliverable._id)
      )
      .order("desc")
      .first()
    const now = Date.now()
    const versionId = await ctx.db.insert("deliverableVersions", {
      organizationId: principal.organizationId,
      requestId: request._id,
      deliverableId: deliverable._id,
      body: requiredText(args.body),
      ordinal: (latest?.ordinal ?? 0) + 1,
      createdByPrincipalId: principal._id,
      correlationId,
      changeSummary: args.changeSummary?.trim().slice(0, 500),
      createdAt: now,
    })
    const firstPrimary = deliverable.isPrimary && !deliverable.promotedVersionId
    await ctx.db.patch(deliverable._id, {
      currentCandidateVersionId: versionId,
      promotedVersionId: firstPrimary
        ? versionId
        : deliverable.promotedVersionId,
      updatedAt: now,
    })
    if (firstPrimary)
      await ctx.db.insert("deliverablePromotionEvents", {
        organizationId: principal.organizationId,
        requestId: request._id,
        deliverableId: deliverable._id,
        versionId,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        operation: "auto_promoted",
        correlationId,
        occurredAt: now,
      })
    if (firstPrimary)
      await ctx.db.patch(request._id, { lifecycle: "ready_to_respond" })
    await ctx.db.insert("deliverableOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      requestId: request._id,
      operation: "create_version",
      correlationId,
      inputFingerprint,
      deliverableId: deliverable._id,
      versionId,
      createdAt: now,
    })
    await audit(
      ctx,
      request,
      principal,
      firstPrimary
        ? "content_request.ready_response"
        : "deliverable.version_created",
      correlationId,
      now
    )
    return publicDeliverable(
      ctx,
      await requiredDeliverable(ctx, principal.organizationId, deliverable._id)
    )
  },
})

export const promote = mutation({
  args: {
    deliverableId: v.id("deliverables"),
    versionId: v.id("deliverableVersions"),
    expectedPromotedVersionId: v.union(v.id("deliverableVersions"), v.null()),
    correlationId: v.string(),
    expectedAggregateVersion: v.optional(v.number()),
  },
  returns: promotionResultValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const deliverable = await requiredDeliverable(
      ctx,
      principal.organizationId,
      args.deliverableId
    )
    const version = await ctx.db.get(args.versionId)
    if (!version || version.deliverableId !== deliverable._id)
      throw new ConvexError({ code: "NOT_FOUND" })
    const request = await ctx.db.get(deliverable.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const prior = await ctx.db
      .query("deliverablePromotionEvents")
      .withIndex("by_organization_actor_correlation", (q) =>
        q
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (
        prior.deliverableId !== deliverable._id ||
        prior.versionId !== version._id ||
        (prior.expectedPromotedVersionId ?? null) !==
          args.expectedPromotedVersionId
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return {
        outcome: "applied" as const,
        deliverable: await publicDeliverable(ctx, deliverable),
        conflict: null,
      }
    }
    const replayedConflict = await findConflictReplay(
      ctx,
      request,
      principal,
      "promotedVersionId",
      version._id,
      args.expectedPromotedVersionId ?? "",
      correlationId
    )
    if (replayedConflict)
      return {
        outcome: "attention_required" as const,
        deliverable: await publicDeliverable(ctx, deliverable),
        conflict: publicConflict(request.humanId, replayedConflict),
      }
    if (
      args.expectedAggregateVersion !== undefined &&
      request.aggregateVersion !== args.expectedAggregateVersion
    )
      throw new ConvexError({ code: "CONFIRMATION_STALE" })
    requireActiveRequest(request)
    if ((deliverable.retention ?? "active") !== "active")
      throw new ConvexError({ code: "DELIVERABLE_ARCHIVED" })
    const currentPromotedVersionId = deliverable.promotedVersionId ?? null
    if (
      currentPromotedVersionId !== args.expectedPromotedVersionId &&
      currentPromotedVersionId !== version._id
    ) {
      const conflict = await findOrCreateConflict(
        ctx,
        request,
        principal,
        "promotedVersionId",
        currentPromotedVersionId ?? "",
        version._id,
        args.expectedPromotedVersionId ?? "",
        correlationId
      )
      return {
        outcome: "attention_required" as const,
        deliverable: await publicDeliverable(ctx, deliverable),
        conflict: publicConflict(request.humanId, conflict),
      }
    }
    const now = Date.now()
    const makesReady =
      deliverable.isPrimary &&
      request.lifecycle !== "ready_to_respond" &&
      request.lifecycle !== "responded"
    await ctx.db.patch(deliverable._id, {
      promotedVersionId: version._id,
      updatedAt: now,
    })
    if (deliverable.isPrimary && request.lifecycle !== "responded")
      await ctx.db.patch(request._id, { lifecycle: "ready_to_respond" })
    await ctx.db.insert("deliverablePromotionEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      deliverableId: deliverable._id,
      versionId: version._id,
      previousVersionId: deliverable.promotedVersionId,
      expectedPromotedVersionId: args.expectedPromotedVersionId ?? undefined,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "promoted",
      correlationId,
      occurredAt: now,
    })
    await audit(
      ctx,
      request,
      principal,
      makesReady ? "content_request.ready_response" : "deliverable.promoted",
      correlationId,
      now
    )
    return {
      outcome: "applied" as const,
      deliverable: await publicDeliverable(
        ctx,
        await requiredDeliverable(
          ctx,
          principal.organizationId,
          deliverable._id
        )
      ),
      conflict: null,
    }
  },
})

export const setPrimary = mutation({
  args: {
    humanId: v.string(),
    deliverableId: v.id("deliverables"),
    expectedPrimaryDeliverableId: v.id("deliverables"),
    correlationId: v.string(),
    expectedAggregateVersion: v.optional(v.number()),
  },
  returns: primaryResultValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await requestByHumanId(
      ctx,
      principal.organizationId,
      args.humanId
    )
    const selected = await requiredDeliverable(
      ctx,
      principal.organizationId,
      args.deliverableId
    )
    if (selected.requestId !== request._id)
      throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const inputFingerprint = JSON.stringify({
      requestId: request._id,
      deliverableId: selected._id,
      expectedPrimaryDeliverableId: args.expectedPrimaryDeliverableId,
    })
    const replay = await priorOperation(
      ctx,
      principal,
      "set_primary",
      correlationId,
      inputFingerprint
    )
    const deliverables = await ctx.db
      .query("deliverables")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect()
    if (replay)
      return {
        outcome: "applied" as const,
        deliverables: await listRequestDeliverables(ctx, request._id),
        conflict: null,
      }
    const replayedConflict = await findConflictReplay(
      ctx,
      request,
      principal,
      "primaryDeliverableId",
      selected._id,
      args.expectedPrimaryDeliverableId,
      correlationId
    )
    if (replayedConflict)
      return {
        outcome: "attention_required" as const,
        deliverables: await listRequestDeliverables(ctx, request._id),
        conflict: publicConflict(request.humanId, replayedConflict),
      }
    if (
      args.expectedAggregateVersion !== undefined &&
      request.aggregateVersion !== args.expectedAggregateVersion
    )
      throw new ConvexError({ code: "CONFIRMATION_STALE" })
    requireActiveRequest(request)
    if (request.lifecycle === "responded")
      throw new ConvexError({ code: "DELIVERED_PRIMARY_LOCKED" })
    if ((selected.retention ?? "active") !== "active")
      throw new ConvexError({ code: "DELIVERABLE_ARCHIVED" })
    const previous = deliverables.find((deliverable) => deliverable.isPrimary)
    if (!previous)
      throw new ConvexError({ code: "PRIMARY_DELIVERABLE_MISSING" })
    if (
      previous._id !== args.expectedPrimaryDeliverableId &&
      previous._id !== selected._id
    ) {
      const conflict = await findOrCreateConflict(
        ctx,
        request,
        principal,
        "primaryDeliverableId",
        previous._id,
        selected._id,
        args.expectedPrimaryDeliverableId,
        correlationId
      )
      return {
        outcome: "attention_required" as const,
        deliverables: await listRequestDeliverables(ctx, request._id),
        conflict: publicConflict(request.humanId, conflict),
      }
    }
    if (previous._id === selected._id) {
      await ctx.db.insert("deliverableOperations", {
        organizationId: principal.organizationId,
        actorPrincipalId: principal._id,
        requestId: request._id,
        operation: "set_primary",
        correlationId,
        inputFingerprint,
        deliverableId: selected._id,
        createdAt: Date.now(),
      })
      return {
        outcome: "applied" as const,
        deliverables: await listRequestDeliverables(ctx, request._id),
        conflict: null,
      }
    }
    const now = Date.now()
    const requestTargets = await ctx.db
      .query("deliveryTargets")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .collect()
    const originalTarget = requestTargets.find((target) => target.isOriginal)
    const historicalReceipt = await ctx.db
      .query("deliveryReceipts")
      .withIndex("by_request_responded_at", (index) =>
        index.eq("requestId", request._id)
      )
      .first()
    if (historicalReceipt)
      throw new ConvexError({ code: "DELIVERY_TARGET_ALREADY_CONFIRMED" })
    for (const deliverable of deliverables)
      if (deliverable.isPrimary !== (deliverable._id === selected._id))
        await ctx.db.patch(deliverable._id, {
          isPrimary: deliverable._id === selected._id,
          updatedAt: now,
        })
    if (originalTarget)
      await ctx.db.patch(originalTarget._id, {
        deliverableId: selected._id,
        updatedAt: now,
      })
    const nextLifecycle = await lifecycleForPrimary(ctx, request, selected)
    const makesReady =
      nextLifecycle === "ready_to_respond" &&
      request.lifecycle !== "ready_to_respond"
    await ctx.db.patch(request._id, { lifecycle: nextLifecycle })
    await ctx.db.insert("primaryDeliverableEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      previousDeliverableId: previous._id,
      newDeliverableId: selected._id,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      correlationId,
      occurredAt: now,
    })
    await ctx.db.insert("deliverableOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      requestId: request._id,
      operation: "set_primary",
      correlationId,
      inputFingerprint,
      deliverableId: selected._id,
      createdAt: now,
    })
    await audit(
      ctx,
      request,
      principal,
      makesReady
        ? "content_request.ready_response"
        : "deliverable.primary_reassigned",
      correlationId,
      now
    )
    return {
      outcome: "applied" as const,
      deliverables: await listRequestDeliverables(ctx, request._id),
      conflict: null,
    }
  },
})
