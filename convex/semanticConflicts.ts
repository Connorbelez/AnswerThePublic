import { ConvexError, v } from "convex/values"

import type { Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import {
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import { lifecycleForPrimary } from "./lib/deliverableLifecycle"
import { enqueueNotification } from "./lib/notificationOutbox"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"

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

function publicConflict(
  requestHumanId: string,
  conflict: {
    _id: Id<"semanticConflicts">
    field: "assigneePrincipalId" | "primaryDeliverableId" | "promotedVersionId"
    currentValue: string
    proposedValue: string
    expectedValue: string
    status: "open" | "resolved"
    correlationId: string
    createdAt: number
    resolvedValue?: string
    resolvedAt?: number
  }
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

export const proposeAssigneeChange = mutation({
  args: {
    humanId: v.string(),
    expectedAssigneePrincipalId: v.id("principals"),
    proposedAssigneePrincipalId: v.id("principals"),
    watcherPrincipalIds: v.optional(v.array(v.id("principals"))),
    reason: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: v.union(
    v.object({ outcome: v.literal("applied"), conflict: v.null() }),
    v.object({
      outcome: v.literal("attention_required"),
      conflict: conflictValidator,
    })
  ),
  handler: async (ctx, args) => {
    const actor = await requirePrincipal(ctx)
    requireEditor(actor)
    const correlationId = args.correlationId.trim()
    if (!correlationId) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    }
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", actor.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const proposed = await ctx.db.get(args.proposedAssigneePrincipalId)
    if (
      !proposed ||
      proposed.organizationId !== actor.organizationId ||
      proposed.kind === "system"
    ) {
      throw new ConvexError({ code: "ASSIGNEE_NOT_FOUND" })
    }
    const watcherPrincipalIds = Array.from(
      new Set(args.watcherPrincipalIds ?? [])
    ).filter((principalId) => principalId !== proposed._id)
    for (const watcherPrincipalId of watcherPrincipalIds) {
      const watcher = await ctx.db.get(watcherPrincipalId)
      if (
        !watcher ||
        watcher.organizationId !== actor.organizationId ||
        watcher.kind === "system"
      ) {
        throw new ConvexError({ code: "WATCHER_NOT_FOUND" })
      }
    }
    const reason = args.reason?.trim() || undefined
    const founderInput = await ctx.db
      .query("founderInputDocuments")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique()
    const currentAssigneeId =
      request.assigneePrincipalId ?? request.createdByPrincipalId
    const replay = await ctx.db
      .query("semanticConflictOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", actor.organizationId)
          .eq("actorPrincipalId", actor._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (replay) {
      if (
        replay.operation !== "propose_assignee" ||
        replay.requestId !== request._id ||
        replay.expectedValue !== args.expectedAssigneePrincipalId ||
        replay.proposedValue !== args.proposedAssigneePrincipalId ||
        JSON.stringify(replay.watcherPrincipalIds ?? []) !==
          JSON.stringify(watcherPrincipalIds) ||
        replay.reason !== reason
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      }
      if (replay.outcome === "applied") {
        return { outcome: "applied" as const, conflict: null }
      }
      if (!replay.conflictId) throw new ConvexError({ code: "WRITE_FAILED" })
      const replayedConflict = await ctx.db.get(replay.conflictId)
      if (!replayedConflict) throw new ConvexError({ code: "WRITE_FAILED" })
      return {
        outcome: "attention_required" as const,
        conflict: publicConflict(request.humanId, replayedConflict),
      }
    }
    requireActiveRequest(request)

    const now = Date.now()
    const afterVersion = request.aggregateVersion + 1
    if (
      currentAssigneeId !== args.expectedAssigneePrincipalId &&
      currentAssigneeId !== args.proposedAssigneePrincipalId
    ) {
      const conflictId = await ctx.db.insert("semanticConflicts", {
        organizationId: actor.organizationId,
        requestId: request._id,
        field: "assigneePrincipalId",
        currentValue: currentAssigneeId,
        proposedValue: args.proposedAssigneePrincipalId,
        expectedValue: args.expectedAssigneePrincipalId,
        status: "open",
        createdByPrincipalId: actor._id,
        correlationId,
        createdAt: now,
      })
      await ctx.db.patch(request._id, {
        aggregateVersion: afterVersion,
        updatedAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: actor.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorPrincipalId: actor._id,
        credentialId: actor.credentialId,
        operation: "content_request.semantic_conflict_created",
        correlationId,
        occurredAt: now,
        beforeVersion: request.aggregateVersion,
        afterVersion,
      })
      await ctx.db.insert("semanticConflictOperations", {
        organizationId: actor.organizationId,
        requestId: request._id,
        actorPrincipalId: actor._id,
        operation: "propose_assignee",
        correlationId,
        expectedValue: args.expectedAssigneePrincipalId,
        proposedValue: args.proposedAssigneePrincipalId,
        watcherPrincipalIds,
        reason,
        conflictId,
        outcome: "attention_required",
        createdAt: now,
      })
      const conflict = await ctx.db.get(conflictId)
      if (!conflict) throw new ConvexError({ code: "WRITE_FAILED" })
      await refreshOperatorWorkspaceProjection(ctx, request._id)
      return {
        outcome: "attention_required" as const,
        conflict: publicConflict(request.humanId, conflict),
      }
    }

    if (
      proposed.role === "founder" &&
      founderInput &&
      founderInput.founderPrincipalId !== proposed._id
    ) {
      throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
    }

    await ctx.db.patch(request._id, {
      assigneePrincipalId: proposed._id,
      watcherPrincipalIds,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("assignmentEvents", {
      organizationId: actor.organizationId,
      requestId: request._id,
      previousAssigneePrincipalId: currentAssigneeId,
      newAssigneePrincipalId: proposed._id,
      watcherPrincipalIds,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      reason,
      correlationId,
      occurredAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: actor.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.assignee_change_applied",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    if (currentAssigneeId !== proposed._id) {
      await enqueueNotification(ctx, request, proposed, "request_assigned", now)
    }
    await ctx.db.insert("semanticConflictOperations", {
      organizationId: actor.organizationId,
      requestId: request._id,
      actorPrincipalId: actor._id,
      operation: "propose_assignee",
      correlationId,
      expectedValue: args.expectedAssigneePrincipalId,
      proposedValue: args.proposedAssigneePrincipalId,
      watcherPrincipalIds,
      reason,
      outcome: "applied",
      createdAt: now,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    return { outcome: "applied" as const, conflict: null }
  },
})

export const resolve = mutation({
  args: {
    conflictId: v.id("semanticConflicts"),
    selectedValue: v.string(),
    correlationId: v.string(),
  },
  returns: conflictValidator,
  handler: async (ctx, args) => {
    const actor = await requirePrincipal(ctx)
    requireEditor(actor)
    const correlationId = args.correlationId.trim()
    if (!correlationId) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "correlationId",
      })
    }
    const replay = await ctx.db
      .query("semanticConflictOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", actor.organizationId)
          .eq("actorPrincipalId", actor._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (replay) {
      if (
        replay.operation !== "resolve" ||
        replay.sourceConflictId !== args.conflictId ||
        replay.selectedValue !== args.selectedValue ||
        !replay.conflictId
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      }
      const replayedConflict = await ctx.db.get(replay.conflictId)
      if (!replayedConflict) throw new ConvexError({ code: "WRITE_FAILED" })
      const replayedRequest = await ctx.db.get(replayedConflict.requestId)
      if (!replayedRequest) throw new ConvexError({ code: "WRITE_FAILED" })
      return publicConflict(replayedRequest.humanId, replayedConflict)
    }
    const conflict = await ctx.db.get(args.conflictId)
    if (!conflict || conflict.organizationId !== actor.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND" })
    }
    if (conflict.status !== "open") {
      throw new ConvexError({ code: "CONFLICT_ALREADY_RESOLVED" })
    }
    if (
      args.selectedValue !== conflict.currentValue &&
      args.selectedValue !== conflict.proposedValue
    ) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "selectedValue",
      })
    }
    const request = await ctx.db.get(conflict.requestId)
    if (!request || request.organizationId !== actor.organizationId) {
      throw new ConvexError({ code: "NOT_FOUND" })
    }
    requireActiveRequest(request)
    const resolveSingleton = async (
      currentValue: string,
      applySelectedValue: (now: number) => Promise<void>
    ) => {
      const now = Date.now()
      const afterVersion = request.aggregateVersion + 1
      if (
        currentValue !== conflict.currentValue &&
        currentValue !== args.selectedValue
      ) {
        await ctx.db.patch(conflict._id, {
          status: "resolved",
          resolvedByPrincipalId: actor._id,
          resolvedValue: currentValue,
          resolvedAt: now,
        })
        const rebasedConflictId = await ctx.db.insert("semanticConflicts", {
          organizationId: actor.organizationId,
          requestId: request._id,
          field: conflict.field,
          currentValue,
          proposedValue: args.selectedValue,
          expectedValue: conflict.currentValue,
          status: "open",
          createdByPrincipalId: actor._id,
          correlationId,
          createdAt: now,
        })
        await ctx.db.patch(request._id, {
          aggregateVersion: afterVersion,
          updatedAt: now,
        })
        await ctx.db.insert("auditEvents", {
          organizationId: actor.organizationId,
          requestId: request._id,
          requestHumanId: request.humanId,
          actorPrincipalId: actor._id,
          credentialId: actor.credentialId,
          operation: "content_request.semantic_conflict_rebased",
          correlationId,
          occurredAt: now,
          beforeVersion: request.aggregateVersion,
          afterVersion,
        })
        await ctx.db.insert("semanticConflictOperations", {
          organizationId: actor.organizationId,
          requestId: request._id,
          actorPrincipalId: actor._id,
          operation: "resolve",
          correlationId,
          selectedValue: args.selectedValue,
          sourceConflictId: conflict._id,
          conflictId: rebasedConflictId,
          outcome: "attention_required",
          createdAt: now,
        })
        const rebased = await ctx.db.get(rebasedConflictId)
        if (!rebased) throw new ConvexError({ code: "WRITE_FAILED" })
        await refreshOperatorWorkspaceProjection(ctx, request._id)
        return publicConflict(request.humanId, rebased)
      }
      await applySelectedValue(now)
      await ctx.db.patch(request._id, {
        aggregateVersion: afterVersion,
        updatedAt: now,
      })
      await ctx.db.patch(conflict._id, {
        status: "resolved",
        resolvedByPrincipalId: actor._id,
        resolvedValue: args.selectedValue,
        resolvedAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: actor.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorPrincipalId: actor._id,
        credentialId: actor.credentialId,
        operation: "content_request.semantic_conflict_resolved",
        correlationId,
        occurredAt: now,
        beforeVersion: request.aggregateVersion,
        afterVersion,
      })
      await ctx.db.insert("semanticConflictOperations", {
        organizationId: actor.organizationId,
        requestId: request._id,
        actorPrincipalId: actor._id,
        operation: "resolve",
        correlationId,
        selectedValue: args.selectedValue,
        sourceConflictId: conflict._id,
        conflictId: conflict._id,
        outcome: "resolved",
        createdAt: now,
      })
      const resolved = await ctx.db.get(conflict._id)
      if (!resolved) throw new ConvexError({ code: "WRITE_FAILED" })
      await refreshOperatorWorkspaceProjection(ctx, request._id)
      return publicConflict(request.humanId, resolved)
    }
    if (conflict.field === "primaryDeliverableId") {
      if (request.lifecycle === "responded")
        throw new ConvexError({ code: "DELIVERED_PRIMARY_LOCKED" })
      const deliverables = await ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect()
      const current = deliverables.find((deliverable) => deliverable.isPrimary)
      const selected = await ctx.db.get(
        args.selectedValue as Id<"deliverables">
      )
      if (!current || !selected || selected.requestId !== request._id)
        throw new ConvexError({ code: "NOT_FOUND" })
      if ((selected.retention ?? "active") !== "active")
        throw new ConvexError({ code: "DELIVERABLE_ARCHIVED" })
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
      return resolveSingleton(current._id, async (now) => {
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
        if (current._id !== selected._id && request.lifecycle !== "responded")
          await ctx.db.insert("primaryDeliverableEvents", {
            organizationId: actor.organizationId,
            requestId: request._id,
            previousDeliverableId: current._id,
            newDeliverableId: selected._id,
            actorPrincipalId: actor._id,
            credentialId: actor.credentialId,
            correlationId,
            occurredAt: now,
          })
        await ctx.db.patch(request._id, {
          lifecycle: await lifecycleForPrimary(ctx, request, selected),
        })
      })
    }
    if (conflict.field === "promotedVersionId") {
      const selected = await ctx.db.get(
        args.selectedValue as Id<"deliverableVersions">
      )
      if (!selected || selected.requestId !== request._id)
        throw new ConvexError({ code: "NOT_FOUND" })
      const deliverable = await ctx.db.get(selected.deliverableId)
      if (!deliverable || deliverable.requestId !== request._id)
        throw new ConvexError({ code: "NOT_FOUND" })
      if ((deliverable.retention ?? "active") !== "active")
        throw new ConvexError({ code: "DELIVERABLE_ARCHIVED" })
      const proposed = await ctx.db.get(
        conflict.proposedValue as Id<"deliverableVersions">
      )
      if (!proposed || proposed.deliverableId !== deliverable._id)
        throw new ConvexError({ code: "VALIDATION_FAILED" })
      const currentValue = deliverable.promotedVersionId ?? ""
      return resolveSingleton(currentValue, async (now) => {
        await ctx.db.patch(deliverable._id, {
          promotedVersionId: selected._id,
          updatedAt: now,
        })
        if (deliverable.isPrimary && request.lifecycle !== "responded")
          await ctx.db.patch(request._id, { lifecycle: "ready_to_respond" })
        if (currentValue !== selected._id)
          await ctx.db.insert("deliverablePromotionEvents", {
            organizationId: actor.organizationId,
            requestId: request._id,
            deliverableId: deliverable._id,
            versionId: selected._id,
            previousVersionId: deliverable.promotedVersionId,
            actorPrincipalId: actor._id,
            credentialId: actor.credentialId,
            operation: "promoted",
            correlationId,
            occurredAt: now,
          })
      })
    }
    if (conflict.field !== "assigneePrincipalId") {
      throw new ConvexError({ code: "UNSUPPORTED_CONFLICT_FIELD" })
    }
    const selectedAssignee = await ctx.db.get(
      args.selectedValue as typeof request.createdByPrincipalId
    )
    if (
      !selectedAssignee ||
      selectedAssignee.organizationId !== actor.organizationId ||
      selectedAssignee.kind === "system"
    ) {
      throw new ConvexError({ code: "ASSIGNEE_NOT_FOUND" })
    }
    if (selectedAssignee.role === "founder") {
      const founderInput = await ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .unique()
      if (
        founderInput &&
        founderInput.founderPrincipalId !== selectedAssignee._id
      ) {
        throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
      }
    }
    const now = Date.now()
    const previousAssigneeId =
      request.assigneePrincipalId ?? request.createdByPrincipalId
    const afterVersion = request.aggregateVersion + 1
    if (
      previousAssigneeId !== conflict.currentValue &&
      previousAssigneeId !== selectedAssignee._id
    ) {
      await ctx.db.patch(conflict._id, {
        status: "resolved",
        resolvedByPrincipalId: actor._id,
        resolvedValue: previousAssigneeId,
        resolvedAt: now,
      })
      const rebasedConflictId = await ctx.db.insert("semanticConflicts", {
        organizationId: actor.organizationId,
        requestId: request._id,
        field: "assigneePrincipalId",
        currentValue: previousAssigneeId,
        proposedValue: selectedAssignee._id,
        expectedValue: conflict.currentValue,
        status: "open",
        createdByPrincipalId: actor._id,
        correlationId,
        createdAt: now,
      })
      await ctx.db.patch(request._id, {
        aggregateVersion: afterVersion,
        updatedAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: actor.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorPrincipalId: actor._id,
        credentialId: actor.credentialId,
        operation: "content_request.semantic_conflict_rebased",
        correlationId,
        occurredAt: now,
        beforeVersion: request.aggregateVersion,
        afterVersion,
      })
      await ctx.db.insert("semanticConflictOperations", {
        organizationId: actor.organizationId,
        requestId: request._id,
        actorPrincipalId: actor._id,
        operation: "resolve",
        correlationId,
        selectedValue: args.selectedValue,
        sourceConflictId: conflict._id,
        conflictId: rebasedConflictId,
        outcome: "attention_required",
        createdAt: now,
      })
      const rebasedConflict = await ctx.db.get(rebasedConflictId)
      if (!rebasedConflict) throw new ConvexError({ code: "WRITE_FAILED" })
      await refreshOperatorWorkspaceProjection(ctx, request._id)
      return publicConflict(request.humanId, rebasedConflict)
    }
    await ctx.db.patch(request._id, {
      assigneePrincipalId: selectedAssignee._id,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await ctx.db.patch(conflict._id, {
      status: "resolved",
      resolvedByPrincipalId: actor._id,
      resolvedValue: selectedAssignee._id,
      resolvedAt: now,
    })
    await ctx.db.insert("assignmentEvents", {
      organizationId: actor.organizationId,
      requestId: request._id,
      previousAssigneePrincipalId: previousAssigneeId,
      newAssigneePrincipalId: selectedAssignee._id,
      watcherPrincipalIds: request.watcherPrincipalIds ?? [],
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      reason: "Resolved semantic singleton conflict",
      correlationId,
      occurredAt: now,
    })
    await ctx.db.insert("auditEvents", {
      organizationId: actor.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.semantic_conflict_resolved",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
    })
    if (previousAssigneeId !== selectedAssignee._id) {
      await enqueueNotification(
        ctx,
        request,
        selectedAssignee,
        "request_assigned",
        now
      )
    }
    await ctx.db.insert("semanticConflictOperations", {
      organizationId: actor.organizationId,
      requestId: request._id,
      actorPrincipalId: actor._id,
      operation: "resolve",
      correlationId,
      selectedValue: args.selectedValue,
      sourceConflictId: conflict._id,
      conflictId: conflict._id,
      outcome: "resolved",
      createdAt: now,
    })
    const resolved = await ctx.db.get(conflict._id)
    if (!resolved) throw new ConvexError({ code: "WRITE_FAILED" })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    return publicConflict(request.humanId, resolved)
  },
})

export const listOpen = query({
  args: { humanId: v.string() },
  returns: v.array(conflictValidator),
  handler: async (ctx, args) => {
    const actor = await requirePrincipal(ctx)
    requireEditor(actor)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", actor.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const conflicts = await ctx.db
      .query("semanticConflicts")
      .withIndex("by_request_status", (index) =>
        index.eq("requestId", request._id).eq("status", "open")
      )
      .collect()
    return conflicts.map((conflict) =>
      publicConflict(request.humanId, conflict)
    )
  },
})
