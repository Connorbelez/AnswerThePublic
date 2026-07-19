import { paginationOptsValidator } from "convex/server"
import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
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
import { projectDeliveryLifecycle } from "./lib/deliveryLifecycle"
import { enqueueNotification } from "./lib/notificationOutbox"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import { isSubstantialRewrite } from "./lib/productMetricClassification"
import {
  assertWithinRequestLimit,
  MAX_DELIVERY_TARGETS_PER_REQUEST,
} from "./lib/requestLimits"

const receiptValidator = v.object({
  receiptId: v.id("deliveryReceipts"),
  versionId: v.id("deliverableVersions"),
  channel: v.string(),
  destinationLabel: v.string(),
  destinationUrl: v.union(v.string(), v.null()),
  note: v.union(v.string(), v.null()),
  confirmedByPrincipalId: v.id("principals"),
  confirmationMethod: v.union(v.literal("human"), v.literal("integration")),
  integrationIdentity: v.union(v.string(), v.null()),
  externalReceiptId: v.union(v.string(), v.null()),
  respondedAt: v.number(),
})

const targetValidator = v.object({
  targetId: v.id("deliveryTargets"),
  requestHumanId: v.string(),
  deliverableId: v.id("deliverables"),
  channel: v.string(),
  destinationLabel: v.string(),
  destinationUrl: v.union(v.string(), v.null()),
  isOriginal: v.boolean(),
  isRequired: v.boolean(),
  retention: v.union(v.literal("active"), v.literal("archived")),
  currentReceiptId: v.union(v.id("deliveryReceipts"), v.null()),
  currentReceipt: v.union(receiptValidator, v.null()),
  receiptHistory: v.array(receiptValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
})

function requiredText(value: string, max: number) {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > max)
    throw new ConvexError({ code: "VALIDATION_FAILED" })
  return cleaned
}

async function publicReceipt(receipt: Doc<"deliveryReceipts">) {
  return {
    receiptId: receipt._id,
    versionId: receipt.versionId,
    channel: receipt.channel,
    destinationLabel: receipt.destinationLabel,
    destinationUrl: receipt.destinationUrl ?? null,
    note: receipt.note ?? null,
    confirmedByPrincipalId: receipt.confirmedByPrincipalId,
    confirmationMethod: receipt.confirmationMethod,
    integrationIdentity: receipt.integrationIdentity ?? null,
    externalReceiptId: receipt.externalReceiptId ?? null,
    respondedAt: receipt.respondedAt,
  }
}

async function publicTarget(
  ctx: QueryCtx | MutationCtx,
  target: Doc<"deliveryTargets">
) {
  const request = await ctx.db.get(target.requestId)
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  const receipts = await ctx.db
    .query("deliveryReceipts")
    .withIndex("by_target_responded_at", (index) =>
      index.eq("targetId", target._id)
    )
    .order("desc")
    .collect()
  const current = target.currentReceiptId
    ? receipts.find((receipt) => receipt._id === target.currentReceiptId)
    : undefined
  return {
    targetId: target._id,
    requestHumanId: request.humanId,
    deliverableId: target.deliverableId,
    channel: target.channel,
    destinationLabel: target.destinationLabel,
    destinationUrl: target.destinationUrl ?? null,
    isOriginal: target.isOriginal,
    isRequired: target.isRequired,
    retention: target.retention,
    currentReceiptId: target.currentReceiptId ?? null,
    currentReceipt: current ? await publicReceipt(current) : null,
    receiptHistory: await Promise.all(receipts.map(publicReceipt)),
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  }
}

async function targetForPrincipal(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  targetId: Id<"deliveryTargets">
) {
  const target = await ctx.db.get(targetId)
  if (!target || target.organizationId !== organizationId)
    throw new ConvexError({ code: "NOT_FOUND" })
  return target
}

async function requestByHumanId(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  humanId: string
) {
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (index) =>
      index
        .eq("organizationId", organizationId)
        .eq("humanId", humanId.trim().toUpperCase())
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  return request
}

async function priorOperation(
  ctx: QueryCtx | MutationCtx,
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  operation:
    | "create_target"
    | "set_required"
    | "set_retention"
    | "confirm"
    | "reopen",
  correlationId: string,
  fingerprint: string
) {
  const prior = await ctx.db
    .query("deliveryOperations")
    .withIndex("by_organization_actor_operation_correlation", (index) =>
      index
        .eq("organizationId", principal.organizationId)
        .eq("actorPrincipalId", principal._id)
        .eq("operation", operation)
        .eq("correlationId", correlationId)
    )
    .unique()
  if (prior && prior.inputFingerprint !== fingerprint)
    throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
  return prior
}

async function audit(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  principal: Awaited<ReturnType<typeof requirePrincipal>>,
  operation: string,
  correlationId: string,
  now: number,
  productMetric?: {
    responseCompleted: boolean
    deliveryBeforeExpiration?: boolean
    agentDraftDelivered: boolean
    substantialOperatorRewrite: boolean
  }
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
    productMetric,
  })
  await refreshOperatorWorkspaceProjection(ctx, request._id)
}

async function classifyDeliveryMetric(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  version: Doc<"deliverableVersions">,
  respondedAt: number,
  responseCompleted: boolean
) {
  const versions = await ctx.db
    .query("deliverableVersions")
    .withIndex("by_deliverable_ordinal", (index) =>
      index
        .eq("deliverableId", version.deliverableId)
        .lte("ordinal", version.ordinal)
    )
    .order("desc")
    .collect()
  const agentDraft = versions.find((candidate) => candidate.sourceJobId)
  const author = agentDraft
    ? await ctx.db.get(version.createdByPrincipalId)
    : null
  const operatorAuthored =
    author?.role === "operator_editor" || author?.role === "administrator"

  return {
    responseCompleted,
    ...(request.expiresAt === undefined
      ? {}
      : { deliveryBeforeExpiration: respondedAt <= request.expiresAt }),
    agentDraftDelivered: Boolean(agentDraft),
    substantialOperatorRewrite: Boolean(
      agentDraft &&
      agentDraft._id !== version._id &&
      operatorAuthored &&
      isSubstantialRewrite(agentDraft.body, version.body)
    ),
  }
}

async function notifyOperators(
  ctx: MutationCtx,
  request: Doc<"contentRequests">,
  now: number
) {
  const [operators, administrators] = await Promise.all([
    ctx.db
      .query("principals")
      .withIndex("by_organization_role", (q) =>
        q
          .eq("organizationId", request.organizationId)
          .eq("role", "operator_editor")
      )
      .collect(),
    ctx.db
      .query("principals")
      .withIndex("by_organization_role", (q) =>
        q
          .eq("organizationId", request.organizationId)
          .eq("role", "administrator")
      )
      .collect(),
  ])
  for (const recipient of [...operators, ...administrators])
    await enqueueNotification(ctx, request, recipient, "delivery_reopened", now)
}

export const list = query({
  args: { humanId: v.string() },
  returns: v.array(targetValidator),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await requestByHumanId(
      ctx,
      principal.organizationId,
      args.humanId
    )
    const targets = await ctx.db
      .query("deliveryTargets")
      .withIndex("by_request_retention", (index) =>
        index.eq("requestId", request._id).eq("retention", "active")
      )
      .take(MAX_DELIVERY_TARGETS_PER_REQUEST + 1)
    return Promise.all(
      targets
        .sort(
          (a, b) =>
            Number(a.retention === "archived") -
              Number(b.retention === "archived") ||
            Number(b.isOriginal) - Number(a.isOriginal) ||
            Number(b.isRequired) - Number(a.isRequired) ||
            a.createdAt - b.createdAt
        )
        .map((target) => publicTarget(ctx, target))
    )
  },
})

export const listArchived = query({
  args: { humanId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(targetValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await requestByHumanId(
      ctx,
      principal.organizationId,
      args.humanId
    )
    const result = await ctx.db
      .query("deliveryTargets")
      .withIndex("by_request_retention", (index) =>
        index.eq("requestId", request._id).eq("retention", "archived")
      )
      .paginate(args.paginationOpts)
    return {
      page: await Promise.all(
        result.page.map((target) => publicTarget(ctx, target))
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    }
  },
})

export const createTarget = mutation({
  args: {
    humanId: v.string(),
    deliverableId: v.id("deliverables"),
    channel: v.string(),
    destinationLabel: v.string(),
    destinationUrl: v.optional(v.string()),
    isRequired: v.optional(v.boolean()),
    correlationId: v.string(),
  },
  returns: targetValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const request = await requestByHumanId(
      ctx,
      principal.organizationId,
      args.humanId
    )
    const deliverable = await ctx.db.get(args.deliverableId)
    if (!deliverable || deliverable.requestId !== request._id)
      throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const fingerprint = JSON.stringify({
      requestId: request._id,
      deliverableId: deliverable._id,
      channel: args.channel.trim(),
      destinationLabel: args.destinationLabel.trim(),
      destinationUrl: args.destinationUrl?.trim() ?? null,
      isRequired: args.isRequired ?? false,
    })
    const replay = await priorOperation(
      ctx,
      principal,
      "create_target",
      correlationId,
      fingerprint
    )
    if (replay)
      return publicTarget(
        ctx,
        await targetForPrincipal(ctx, principal.organizationId, replay.targetId)
      )
    requireActiveRequest(request)
    const requestTargets = await ctx.db
      .query("deliveryTargets")
      .withIndex("by_request_retention", (index) =>
        index.eq("requestId", request._id).eq("retention", "active")
      )
      .take(MAX_DELIVERY_TARGETS_PER_REQUEST + 1)
    assertWithinRequestLimit(
      requestTargets.length,
      MAX_DELIVERY_TARGETS_PER_REQUEST,
      "delivery_targets"
    )
    if ((deliverable.retention ?? "active") !== "active")
      throw new ConvexError({ code: "NOT_FOUND" })
    const now = Date.now()
    const targetId = await ctx.db.insert("deliveryTargets", {
      organizationId: principal.organizationId,
      requestId: request._id,
      deliverableId: deliverable._id,
      channel: requiredText(args.channel, 100),
      destinationLabel: requiredText(args.destinationLabel, 300),
      destinationUrl: args.destinationUrl?.trim().slice(0, 2_000) || undefined,
      isOriginal: false,
      isRequired: args.isRequired ?? false,
      retention: "active",
      createdByPrincipalId: principal._id,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("deliveryOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      operation: "create_target",
      correlationId,
      inputFingerprint: fingerprint,
      targetId,
      createdAt: now,
    })
    await projectDeliveryLifecycle(ctx, request)
    await audit(
      ctx,
      request,
      principal,
      "delivery_target.created",
      correlationId,
      now
    )
    return publicTarget(
      ctx,
      await targetForPrincipal(ctx, principal.organizationId, targetId)
    )
  },
})

export const setRequired = mutation({
  args: {
    targetId: v.id("deliveryTargets"),
    isRequired: v.boolean(),
    correlationId: v.string(),
    expectedAggregateVersion: v.optional(v.number()),
  },
  returns: targetValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const target = await targetForPrincipal(
      ctx,
      principal.organizationId,
      args.targetId
    )
    const request = await ctx.db.get(target.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const fingerprint = `${target._id}:${args.isRequired}`
    const replay = await priorOperation(
      ctx,
      principal,
      "set_required",
      correlationId,
      fingerprint
    )
    if (replay) return publicTarget(ctx, target)
    if (
      args.expectedAggregateVersion !== undefined &&
      request.aggregateVersion !== args.expectedAggregateVersion
    )
      throw new ConvexError({ code: "CONFIRMATION_STALE" })
    requireActiveRequest(request)
    if (target.retention !== "active")
      throw new ConvexError({ code: "NOT_FOUND" })
    if (target.isOriginal && !args.isRequired)
      throw new ConvexError({ code: "ORIGINAL_TARGET_REQUIRED" })
    const now = Date.now()
    await ctx.db.patch(target._id, {
      isRequired: args.isRequired,
      updatedAt: now,
    })
    await projectDeliveryLifecycle(ctx, request)
    await ctx.db.insert("deliveryOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      operation: "set_required",
      correlationId,
      inputFingerprint: fingerprint,
      targetId: target._id,
      createdAt: now,
    })
    await audit(
      ctx,
      request,
      principal,
      "delivery_target.required_changed",
      correlationId,
      now
    )
    return publicTarget(
      ctx,
      await targetForPrincipal(ctx, principal.organizationId, target._id)
    )
  },
})

export const setRetention = mutation({
  args: {
    targetId: v.id("deliveryTargets"),
    retention: v.union(v.literal("active"), v.literal("archived")),
    correlationId: v.string(),
    expectedAggregateVersion: v.optional(v.number()),
  },
  returns: targetValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const target = await targetForPrincipal(
      ctx,
      principal.organizationId,
      args.targetId
    )
    const request = await ctx.db.get(target.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const fingerprint = `${target._id}:${args.retention}`
    const replay = await priorOperation(
      ctx,
      principal,
      "set_retention",
      correlationId,
      fingerprint
    )
    if (replay)
      return publicTarget(
        ctx,
        await targetForPrincipal(ctx, principal.organizationId, replay.targetId)
      )
    if (
      args.expectedAggregateVersion !== undefined &&
      request.aggregateVersion !== args.expectedAggregateVersion
    )
      throw new ConvexError({ code: "CONFIRMATION_STALE" })
    requireActiveRequest(request)
    if (target.retention === args.retention)
      throw new ConvexError({ code: "DELIVERY_TARGET_RETENTION_UNCHANGED" })
    if (args.retention === "archived" && target.isOriginal)
      throw new ConvexError({ code: "ORIGINAL_TARGET_REQUIRED" })
    if (args.retention === "active") {
      const activeTargets = await ctx.db
        .query("deliveryTargets")
        .withIndex("by_request_retention", (index) =>
          index.eq("requestId", request._id).eq("retention", "active")
        )
        .take(MAX_DELIVERY_TARGETS_PER_REQUEST)
      assertWithinRequestLimit(
        activeTargets.length,
        MAX_DELIVERY_TARGETS_PER_REQUEST,
        "delivery_targets"
      )
    }
    const now = Date.now()
    await ctx.db.patch(target._id, {
      retention: args.retention,
      archivedWithRequestAt: undefined,
      updatedAt: now,
    })
    await ctx.db.insert("deliveryOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      operation: "set_retention",
      correlationId,
      inputFingerprint: fingerprint,
      targetId: target._id,
      createdAt: now,
    })
    await projectDeliveryLifecycle(ctx, request)
    await audit(
      ctx,
      request,
      principal,
      args.retention === "archived"
        ? "delivery_target.archived"
        : "delivery_target.restored",
      correlationId,
      now
    )
    return publicTarget(
      ctx,
      await targetForPrincipal(ctx, principal.organizationId, target._id)
    )
  },
})

export const recordIntegrationSuccess = internalMutation({
  args: {
    organizationId: v.string(),
    targetId: v.id("deliveryTargets"),
    versionId: v.id("deliverableVersions"),
    provider: v.string(),
    integrationIdentity: v.string(),
    externalReceiptId: v.string(),
    succeededAt: v.number(),
  },
  returns: v.id("integrationDeliverySuccesses"),
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId)
    const version = await ctx.db.get(args.versionId)
    const deliverable = version ? await ctx.db.get(version.deliverableId) : null
    if (
      !target ||
      target.organizationId !== args.organizationId ||
      !version ||
      version.deliverableId !== target.deliverableId ||
      !deliverable
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const existing = await ctx.db
      .query("integrationDeliverySuccesses")
      .withIndex("by_target_external_receipt", (index) =>
        index
          .eq("targetId", target._id)
          .eq("externalReceiptId", requiredText(args.externalReceiptId, 300))
      )
      .unique()
    if (existing) {
      if (
        existing.versionId !== version._id ||
        existing.provider !== args.provider.trim() ||
        existing.integrationIdentity !== args.integrationIdentity.trim()
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return existing._id
    }
    if (
      target.retention !== "active" ||
      (deliverable.retention ?? "active") !== "active"
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const request = await ctx.db.get(target.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    requireActiveRequest(request)
    return ctx.db.insert("integrationDeliverySuccesses", {
      organizationId: args.organizationId,
      targetId: target._id,
      versionId: version._id,
      provider: requiredText(args.provider, 100),
      integrationIdentity: requiredText(args.integrationIdentity, 300),
      externalReceiptId: requiredText(args.externalReceiptId, 300),
      succeededAt: args.succeededAt,
      recordedAt: Date.now(),
    })
  },
})

export const confirm = mutation({
  args: {
    targetId: v.id("deliveryTargets"),
    versionId: v.id("deliverableVersions"),
    note: v.optional(v.string()),
    integrationSuccessId: v.optional(v.id("integrationDeliverySuccesses")),
    correlationId: v.string(),
    expectedAggregateVersion: v.optional(v.number()),
  },
  returns: targetValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const target = await targetForPrincipal(
      ctx,
      principal.organizationId,
      args.targetId
    )
    const version = await ctx.db.get(args.versionId)
    const deliverable = await ctx.db.get(target.deliverableId)
    if (
      !version ||
      version.deliverableId !== target.deliverableId ||
      !deliverable
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    const request = await ctx.db.get(target.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const fingerprint = JSON.stringify({
      targetId: target._id,
      versionId: version._id,
      note: args.note?.trim() ?? null,
      integrationSuccessId: args.integrationSuccessId ?? null,
    })
    const replay = await priorOperation(
      ctx,
      principal,
      "confirm",
      correlationId,
      fingerprint
    )
    if (replay)
      return publicTarget(
        ctx,
        await targetForPrincipal(ctx, principal.organizationId, replay.targetId)
      )
    if (
      args.expectedAggregateVersion !== undefined &&
      request.aggregateVersion !== args.expectedAggregateVersion
    )
      throw new ConvexError({ code: "CONFIRMATION_STALE" })
    requireActiveRequest(request)
    if (
      target.retention !== "active" ||
      (deliverable.retention ?? "active") !== "active"
    )
      throw new ConvexError({ code: "NOT_FOUND" })
    if (deliverable.promotedVersionId !== version._id)
      throw new ConvexError({ code: "PROMOTED_VERSION_REQUIRED" })
    if (target.currentReceiptId)
      throw new ConvexError({ code: "DELIVERY_ALREADY_CONFIRMED" })
    let integration: Doc<"integrationDeliverySuccesses"> | null = null
    if (principal.role === "agent_editor") {
      if (!args.integrationSuccessId)
        throw new ConvexError({ code: "HUMAN_CONFIRMATION_REQUIRED" })
      integration = await ctx.db.get(args.integrationSuccessId)
      if (
        !integration ||
        integration.organizationId !== principal.organizationId ||
        integration.targetId !== target._id ||
        integration.versionId !== version._id ||
        integration.consumedByReceiptId
      )
        throw new ConvexError({ code: "INTEGRATION_SUCCESS_REQUIRED" })
    } else if (args.integrationSuccessId) {
      integration = await ctx.db.get(args.integrationSuccessId)
      if (
        !integration ||
        integration.organizationId !== principal.organizationId ||
        integration.targetId !== target._id ||
        integration.versionId !== version._id ||
        integration.consumedByReceiptId
      )
        throw new ConvexError({ code: "INTEGRATION_SUCCESS_REQUIRED" })
    }
    const now = Date.now()
    const respondedAt = integration?.succeededAt ?? now
    const receiptId = await ctx.db.insert("deliveryReceipts", {
      organizationId: principal.organizationId,
      requestId: request._id,
      targetId: target._id,
      deliverableId: target.deliverableId,
      versionId: version._id,
      channel: target.channel,
      destinationLabel: target.destinationLabel,
      destinationUrl: target.destinationUrl,
      note: args.note?.trim().slice(0, 2_000) || undefined,
      confirmedByPrincipalId: principal._id,
      credentialId: principal.credentialId,
      confirmationMethod: integration ? "integration" : "human",
      integrationIdentity: integration?.integrationIdentity,
      externalReceiptId: integration?.externalReceiptId,
      respondedAt,
      createdAt: now,
    })
    await ctx.db.patch(target._id, {
      currentReceiptId: receiptId,
      hasHistoricalReceipt: true,
      updatedAt: now,
    })
    if (integration)
      await ctx.db.patch(integration._id, { consumedByReceiptId: receiptId })
    await ctx.db.insert("deliveryReceiptEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      targetId: target._id,
      receiptId,
      event: "confirmed",
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      correlationId,
      occurredAt: now,
    })
    await ctx.db.insert("deliveryOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      operation: "confirm",
      correlationId,
      inputFingerprint: fingerprint,
      targetId: target._id,
      receiptId,
      createdAt: now,
    })
    await projectDeliveryLifecycle(ctx, request)
    const projectedRequest = await ctx.db.get(request._id)
    if (!projectedRequest) throw new ConvexError({ code: "WRITE_FAILED" })
    const productMetric = await classifyDeliveryMetric(
      ctx,
      request,
      version,
      respondedAt,
      projectedRequest.lifecycle === "responded"
    )
    await audit(
      ctx,
      request,
      principal,
      "delivery_receipt.confirmed",
      correlationId,
      now,
      productMetric
    )
    return publicTarget(
      ctx,
      await targetForPrincipal(ctx, principal.organizationId, target._id)
    )
  },
})

export const reopen = mutation({
  args: {
    targetId: v.id("deliveryTargets"),
    correlationId: v.string(),
    expectedAggregateVersion: v.optional(v.number()),
  },
  returns: targetValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const target = await targetForPrincipal(
      ctx,
      principal.organizationId,
      args.targetId
    )
    const request = await ctx.db.get(target.requestId)
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const correlationId = requiredText(args.correlationId, 200)
    const replay = await ctx.db
      .query("deliveryOperations")
      .withIndex("by_organization_actor_operation_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("operation", "reopen")
          .eq("correlationId", correlationId)
      )
      .unique()
    if (replay) {
      if (replay.targetId !== target._id)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      return publicTarget(ctx, target)
    }
    if (
      args.expectedAggregateVersion !== undefined &&
      request.aggregateVersion !== args.expectedAggregateVersion
    )
      throw new ConvexError({ code: "CONFIRMATION_STALE" })
    requireActiveRequest(request)
    if (target.retention !== "active")
      throw new ConvexError({ code: "NOT_FOUND" })
    if (!target.currentReceiptId)
      throw new ConvexError({ code: "DELIVERY_NOT_CONFIRMED" })
    const fingerprint = `${target._id}:${target.currentReceiptId}`
    const receiptId = target.currentReceiptId
    const now = Date.now()
    await ctx.db.patch(target._id, {
      currentReceiptId: undefined,
      updatedAt: now,
    })
    await ctx.db.insert("deliveryReceiptEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      targetId: target._id,
      receiptId,
      event: "reopened",
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      correlationId,
      occurredAt: now,
    })
    await ctx.db.insert("deliveryOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      operation: "reopen",
      correlationId,
      inputFingerprint: fingerprint,
      targetId: target._id,
      receiptId,
      createdAt: now,
    })
    await projectDeliveryLifecycle(ctx, request)
    await audit(
      ctx,
      request,
      principal,
      "delivery_receipt.reopened",
      correlationId,
      now
    )
    await notifyOperators(ctx, request, now)
    return publicTarget(
      ctx,
      await targetForPrincipal(ctx, principal.organizationId, target._id)
    )
  },
})
