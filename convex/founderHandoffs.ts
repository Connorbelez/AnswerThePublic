import { ConvexError, v } from "convex/values"

import { mutation, query } from "./_generated/server"
import {
  founderHandoffFormatValidator,
  founderHandoffStatusValidator,
} from "./schema"
import {
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import {
  findCurrentFounderHandoff,
  founderHandoffStatus,
} from "./lib/founderHandoff"
import { enqueueNotification } from "./lib/notificationOutbox"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import {
  founderHandoffFormats,
  type FounderHandoffFormat,
} from "../shared/founder-handoff"

const finalizeResultValidator = v.union(
  v.object({
    outcome: v.literal("applied"),
    handoff: founderHandoffStatusValidator,
  }),
  v.object({
    outcome: v.literal("already_applied"),
    handoff: founderHandoffStatusValidator,
  })
)

function requiredText(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return normalized
}

function normalizedFormats(input: Array<FounderHandoffFormat>) {
  const selected = new Set<FounderHandoffFormat>([
    "original_response",
    ...input,
  ])
  return founderHandoffFormats.filter((format) => selected.has(format))
}

export const getCurrent = query({
  args: { humanId: v.string() },
  returns: v.union(founderHandoffStatusValidator, v.null()),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", args.humanId.trim().toUpperCase())
      )
      .unique()
    if (!request) return null
    return founderHandoffStatus(ctx, request)
  },
})

export const finalize = mutation({
  args: {
    humanId: v.string(),
    recipientPrincipalId: v.id("principals"),
    selectedFormats: v.array(founderHandoffFormatValidator),
    note: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: finalizeResultValidator,
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
    requireActiveRequest(request)
    const existing = await findCurrentFounderHandoff(ctx, request._id)
    if (existing) {
      const handoff = await founderHandoffStatus(ctx, request)
      if (!handoff) throw new ConvexError({ code: "WRITE_FAILED" })
      return { outcome: "already_applied" as const, handoff }
    }
    const recipient = await ctx.db.get(args.recipientPrincipalId)
    if (
      !recipient ||
      recipient.organizationId !== actor.organizationId ||
      recipient.role !== "founder" ||
      (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
        recipient._id
    )
      throw new ConvexError({ code: "HANDOFF_RECIPIENT_NOT_ASSIGNED" })

    const formats = normalizedFormats(args.selectedFormats)
    const [deliverables, targets] = await Promise.all([
      ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect(),
      ctx.db
        .query("deliveryTargets")
        .withIndex("by_request_retention", (index) =>
          index.eq("requestId", request._id).eq("retention", "active")
        )
        .collect(),
    ])
    const activeDeliverables = deliverables.filter(
      (deliverable) => (deliverable.retention ?? "active") === "active"
    )
    const primary = activeDeliverables.find(
      (deliverable) => deliverable.isPrimary
    )
    if (!primary) throw new ConvexError({ code: "PRIMARY_DELIVERABLE_MISSING" })
    if (
      !targets.some(
        (target) =>
          target.isOriginal &&
          target.isRequired &&
          target.deliverableId === primary._id
      )
    )
      throw new ConvexError({ code: "ORIGINAL_TARGET_REQUIRED" })
    for (const format of formats) {
      if (format === "original_response") continue
      if (
        !activeDeliverables.some((deliverable) => deliverable.kind === format)
      )
        throw new ConvexError({
          code: "SELECTED_FORMAT_MISSING",
          format,
        })
    }

    const correlationId = requiredText(args.correlationId, "correlationId")
    const now = Date.now()
    const notificationId = await enqueueNotification(
      ctx,
      request,
      recipient,
      "founder_handoff",
      now
    )
    await ctx.db.insert("founderHandoffs", {
      organizationId: actor.organizationId,
      requestId: request._id,
      recipientPrincipalId: recipient._id,
      selectedFormats: formats,
      note: args.note?.trim() || undefined,
      state: "active",
      notificationId,
      createdByPrincipalId: actor._id,
      correlationId,
      deliveredAt: now,
      createdAt: now,
      updatedAt: now,
    })
    const afterVersion = request.aggregateVersion + 1
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
      operation: "founder_handoff.created",
      correlationId,
      occurredAt: now,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      inputFingerprint: JSON.stringify({
        recipientPrincipalId: recipient._id,
        selectedFormats: formats,
        note: args.note?.trim() || null,
      }),
    })
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const handoff = await founderHandoffStatus(ctx, updated)
    if (!handoff) throw new ConvexError({ code: "WRITE_FAILED" })
    return { outcome: "applied" as const, handoff }
  },
})
