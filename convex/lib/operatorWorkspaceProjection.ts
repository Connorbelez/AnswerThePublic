import type { Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import type { MutationCtx } from "../_generated/server"
import { MAX_DELIVERY_TARGETS_PER_REQUEST } from "./requestLimits"

function deriveQueue(input: {
  lifecycle: string
  assigneeRole: string
  jobStatus: string | null
  attentionReasonCount: number
  requiredTotal: number
  requiredConfirmed: number
}) {
  if (input.attentionReasonCount > 0 || input.jobStatus === "failed")
    return "attention_required" as const
  if (
    input.requiredTotal > 0 &&
    input.requiredConfirmed === input.requiredTotal
  )
    return "delivered" as const
  if (["queued", "running", "retry_wait"].includes(input.jobStatus ?? ""))
    return "agent_drafting" as const
  if (
    input.assigneeRole === "founder" &&
    ["pending", "in_progress"].includes(input.lifecycle)
  )
    return "needs_elie" as const
  return "needs_operator" as const
}

export async function refreshOperatorWorkspaceProjection(
  ctx: MutationCtx,
  requestId: Id<"contentRequests">
) {
  const request = await ctx.db.get(requestId)
  if (!request) return
  const assignee = await ctx.db.get(
    request.assigneePrincipalId ?? request.createdByPrincipalId
  )
  if (!assignee) return
  const [latestJob, targets, conflicts, remediation, source] =
    await Promise.all([
      ctx.db
        .query("agentJobs")
        .withIndex("by_request_created_at", (index) =>
          index.eq("requestId", request._id)
        )
        .order("desc")
        .first(),
      ctx.db
        .query("deliveryTargets")
        .withIndex("by_request_retention", (index) =>
          index.eq("requestId", request._id).eq("retention", "active")
        )
        .take(MAX_DELIVERY_TARGETS_PER_REQUEST + 1),
      ctx.db
        .query("semanticConflicts")
        .withIndex("by_request_status", (index) =>
          index.eq("requestId", request._id).eq("status", "open")
        )
        .take(101),
      ctx.db
        .query("migrationConflicts")
        .withIndex("by_request_resolved", (index) =>
          index.eq("requestId", request._id).eq("resolved", false)
        )
        .take(101),
      request.sourceSnapshotId ? ctx.db.get(request.sourceSnapshotId) : null,
    ])
  const targetOverflow = targets.length > MAX_DELIVERY_TARGETS_PER_REQUEST
  const activeTargets = targets.slice(0, MAX_DELIVERY_TARGETS_PER_REQUEST)
  const required = activeTargets.filter((target) => target.isRequired)
  const confirmed = required.filter((target) => target.currentReceiptId).length
  const attentionReasons = [
    ...conflicts.map((conflict) => `Resolve ${conflict.field} conflict`),
    ...remediation.map(() => "Resolve source URL import collision"),
    ...activeTargets
      .filter(
        (target) => target.hasHistoricalReceipt && !target.currentReceiptId
      )
      .map(
        (target) => `Reconfirm reopened delivery: ${target.destinationLabel}`
      ),
    ...(latestJob?.status === "failed"
      ? ["Agent drafting retries exhausted"]
      : []),
    ...(request.expirationReviewRequiredAt
      ? ["Review protected work after its expiration deadline"]
      : []),
    ...(targetOverflow
      ? ["Legacy delivery target count requires remediation"]
      : []),
  ]
  const attentionReasonCount = attentionReasons.length
  const deliveryChannels = Array.from(
    new Set(activeTargets.map((target) => target.channel))
  ).sort()
  const retained = request.retention === "active"
  const active = retained && request.disposition === "active"
  const manualCritical =
    request.origin === "manual" || request.priority === "critical"
  const orderBucket = `${request.origin === "automated_scout" ? "01" : "00"}:${
    { critical: "00", high: "01", normal: "02", low: "03" }[request.priority]
  }`
  const updatedAt = Date.now()
  const queue = deriveQueue({
    lifecycle: request.lifecycle,
    assigneeRole: assignee.role,
    jobStatus: latestJob?.status ?? null,
    attentionReasonCount,
    requiredTotal: required.length,
    requiredConfirmed: confirmed,
  })
  const value = {
    organizationId: request.organizationId,
    requestId: request._id,
    humanId: request.humanId,
    normalizedTitle: request.normalizedTitle,
    searchText: [
      "operatorworkspaceall",
      request.searchText,
      source?.name,
      source?.channel,
      source?.question,
      ...deliveryChannels,
      ...deliveryChannels.map(
        (channel) =>
          `deliverychannel${channel.toLocaleLowerCase("en-CA").replace(/[^a-z0-9]+/g, "")}`
      ),
    ]
      .filter(Boolean)
      .join(" "),
    active,
    retained,
    manualCritical,
    orderBucket,
    queue,
    priority: request.priority,
    origin: request.origin,
    lifecycle: request.lifecycle,
    disposition: request.disposition,
    assigneePrincipalId: assignee._id,
    agentJobStatus: latestJob?.status,
    requiredDeliveryConfirmed: confirmed,
    requiredDeliveryTotal: required.length,
    openConflictCount: conflicts.length,
    attentionReasonCount,
    attentionReasons,
    deliveryChannels,
    sortKey: request.queueSortKey ?? `${request.createdAt}:${request._id}`,
    nextActionChangedAt: Math.max(
      request.updatedAt,
      latestJob?.updatedAt ?? 0,
      ...activeTargets.map((target) => target.updatedAt),
      ...conflicts.map((conflict) => conflict.createdAt),
      ...remediation.map((conflict) => conflict.createdAt)
    ),
    updatedAt,
  }
  const existing = await ctx.db
    .query("operatorWorkspaceItems")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .unique()
  if (existing)
    await ctx.db.patch(existing._id, {
      ...value,
      searchRepairGeneration: undefined,
    })
  else await ctx.db.insert("operatorWorkspaceItems", value)

  const existingSearchRows = await ctx.db
    .query("operatorWorkspaceSearchRows")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .take(MAX_DELIVERY_TARGETS_PER_REQUEST + 2)
  if (
    targetOverflow ||
    existingSearchRows.length > MAX_DELIVERY_TARGETS_PER_REQUEST + 1
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.operatorWorkspace.repairLegacySearchRows,
      { requestId: request._id }
    )
    return
  }
  for (const row of existingSearchRows) await ctx.db.delete(row._id)
  const channelKeys = [
    "",
    ...new Set(
      deliveryChannels.map((channel) =>
        channel.toLocaleLowerCase("en-CA").trim()
      )
    ),
  ]
  for (const channelKey of channelKeys)
    await ctx.db.insert("operatorWorkspaceSearchRows", {
      organizationId: request.organizationId,
      requestId: request._id,
      humanId: request.humanId,
      normalizedTitle: request.normalizedTitle,
      searchText: value.searchText,
      channelKey,
      active,
      retained,
      manualCritical,
      orderBucket,
      queue,
      priority: request.priority,
      origin: request.origin,
      lifecycle: request.lifecycle,
      disposition: request.disposition,
      assigneePrincipalId: assignee._id,
      sortKey: value.sortKey,
      updatedAt,
    })
}
