import { ConvexError, v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { internal } from "./_generated/api"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import { contentRequestValidator, toPublicRequest } from "./contentRequests"
import {
  requireActiveRequest,
  requireEditor,
  requirePrincipal,
} from "./lib/authorization"
import { enqueueNotification } from "./lib/notificationOutbox"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import { requestQueueSortKey } from "./lib/requestOrdering"
import {
  assertRequestCollectionBound,
  MAX_AGENT_JOBS_PER_REQUEST,
  MAX_DELIVERY_TARGETS_PER_REQUEST,
  MAX_VOICE_CAPTURES_PER_REQUEST,
  VOICE_CAPTURE_OVERFLOW_SENTINEL,
} from "./lib/requestLimits"
import {
  requestDispositionValidator,
  requestLifecycleValidator,
  requestRetentionValidator,
} from "./schema"

const EXPIRATION_DISPATCH_LEASE_MS = 5 * 60_000

const sourceInputValidator = v.object({
  question: v.optional(v.string()),
  body: v.optional(v.string()),
  url: v.optional(v.string()),
  name: v.optional(v.string()),
  channel: v.optional(v.string()),
})

const relationSummaryValidator = v.object({
  requestId: v.id("contentRequests"),
  humanId: v.string(),
  title: v.string(),
  lifecycle: requestLifecycleValidator,
  disposition: requestDispositionValidator,
  retention: requestRetentionValidator,
})

const relationValidator = v.object({
  parent: v.union(relationSummaryValidator, v.null()),
  children: v.array(relationSummaryValidator),
  childrenTruncated: v.boolean(),
})

function relationSummary(request: Doc<"contentRequests">) {
  return {
    requestId: request._id,
    humanId: request.humanId,
    title: request.title,
    lifecycle: request.lifecycle,
    disposition: request.disposition,
    retention: request.retention,
  }
}

function required(value: string, field: string) {
  const cleaned = value.trim()
  if (!cleaned) throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return cleaned
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ")
}

function validTimestamp(value: number) {
  return (
    Number.isSafeInteger(value) &&
    value >= -8_640_000_000_000_000 &&
    value <= 8_640_000_000_000_000 &&
    Number.isFinite(new Date(value).getTime())
  )
}

function humanIdFor(requestId: Id<"contentRequests">) {
  return `CR-${requestId.slice(0, 17).toUpperCase()}`
}

async function requestForEditor(ctx: MutationCtx, humanId: string) {
  const actor = await requirePrincipal(ctx)
  requireEditor(actor)
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (index) =>
      index
        .eq("organizationId", actor.organizationId)
        .eq("humanId", humanId.trim().toUpperCase())
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  return { actor, request }
}

async function syncBoundedWorkspaceSearchRows(
  ctx: MutationCtx,
  requestId: Id<"contentRequests">,
  patch: Partial<
    Pick<
      Doc<"operatorWorkspaceSearchRows">,
      "active" | "disposition" | "queue" | "updatedAt"
    >
  >
) {
  const maximumMaterializedRows = MAX_DELIVERY_TARGETS_PER_REQUEST + 1
  const rows = await ctx.db
    .query("operatorWorkspaceSearchRows")
    .withIndex("by_request", (index) => index.eq("requestId", requestId))
    .take(maximumMaterializedRows + 1)
  if (rows.length > maximumMaterializedRows) {
    await ctx.scheduler.runAfter(
      0,
      internal.operatorWorkspace.repairLegacySearchRows,
      { requestId }
    )
    return
  }
  for (const row of rows) await ctx.db.patch(row._id, patch)
}

async function priorAudit(
  ctx: MutationCtx,
  actor: Doc<"principals"> & { credentialId: string },
  request: Doc<"contentRequests">,
  operation: string,
  correlationId: string,
  inputFingerprint: string
) {
  const event = await ctx.db
    .query("auditEvents")
    .withIndex("by_organization_actor_operation_correlation", (index) =>
      index
        .eq("organizationId", actor.organizationId)
        .eq("actorPrincipalId", actor._id)
        .eq("operation", operation)
        .eq("correlationId", correlationId)
    )
    .unique()
  if (!event) return false
  if (
    event.requestId !== request._id ||
    event.inputFingerprint !== inputFingerprint
  ) {
    throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
  }
  return true
}

async function audit(
  ctx: MutationCtx,
  input: {
    request: Doc<"contentRequests">
    actorPrincipalId: Id<"principals">
    credentialId: string
    operation: string
    correlationId: string
    beforeVersion?: number
    afterVersion: number
    inputFingerprint?: string
    occurredAt: number
  }
) {
  await ctx.db.insert("auditEvents", {
    organizationId: input.request.organizationId,
    requestId: input.request._id,
    requestHumanId: input.request.humanId,
    actorPrincipalId: input.actorPrincipalId,
    credentialId: input.credentialId,
    operation: input.operation,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
    beforeVersion: input.beforeVersion,
    afterVersion: input.afterVersion,
    inputFingerprint: input.inputFingerprint,
  })
}

async function expirationSystemActor(
  ctx: MutationCtx,
  organizationId: string,
  now: number
) {
  const existing = await ctx.db
    .query("principals")
    .withIndex("by_organization_subject", (index) =>
      index
        .eq("organizationId", organizationId)
        .eq("subject", "system:expiration")
    )
    .unique()
  if (existing) {
    if (existing.kind !== "system") {
      throw new ConvexError({ code: "SYSTEM_PRINCIPAL_CONFLICT" })
    }
    return existing
  }
  const principalId = await ctx.db.insert("principals", {
    subject: "system:expiration",
    organizationId,
    role: "agent_editor",
    kind: "system",
    updatedAt: now,
  })
  const principal = await ctx.db.get(principalId)
  if (!principal) throw new ConvexError({ code: "WRITE_FAILED" })
  return principal
}

async function resumeVoiceTranscriptions(
  ctx: MutationCtx,
  requestId: Id<"contentRequests">,
  now: number
) {
  const captures = await ctx.db
    .query("founderVoiceCaptures")
    .withIndex("by_request_created_at", (index) =>
      index.eq("requestId", requestId)
    )
    .take(MAX_VOICE_CAPTURES_PER_REQUEST + 1)
  assertRequestCollectionBound(
    captures.length,
    MAX_VOICE_CAPTURES_PER_REQUEST,
    "voice_captures"
  )
  for (const capture of captures) {
    if (
      capture.discardedAt ||
      (capture.status !== "uploaded" && capture.status !== "transcribing")
    )
      continue
    if (capture.status === "transcribing") {
      const retryAttemptCount = capture.retryAttemptCount ?? capture.attempts
      await ctx.db.patch(capture._id, {
        status: "uploaded",
        retryAttemptCount: Math.max(0, retryAttemptCount - 1),
        transcriptionLeaseExpiresAt: undefined,
        updatedAt: now,
      })
    }
    await ctx.scheduler.runAfter(0, internal.voiceCaptures.transcribe, {
      captureId: capture._id,
    })
  }
}

async function cancelUnclaimedJobs(
  ctx: MutationCtx,
  requestId: Id<"contentRequests">,
  now: number,
  reason: string
) {
  const jobs = await ctx.db
    .query("agentJobs")
    .withIndex("by_request", (index) => index.eq("requestId", requestId))
    .take(MAX_AGENT_JOBS_PER_REQUEST + 1)
  assertRequestCollectionBound(
    jobs.length,
    MAX_AGENT_JOBS_PER_REQUEST,
    "agent_jobs"
  )
  const started = jobs.filter(
    (job) =>
      job.attempts > 0 ||
      ["running", "retry_wait", "completed", "failed"].includes(job.status)
  )
  for (const job of jobs) {
    if (job.status === "queued" && job.attempts === 0) {
      await ctx.db.patch(job._id, {
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: reason,
        pausedJobStatus: "queued",
        pausedWithRequestAt: now,
        nextAttemptAt: undefined,
        claimableAt: undefined,
        updatedAt: now,
      })
      continue
    }
    if (
      job.status !== "queued" &&
      job.status !== "running" &&
      job.status !== "retry_wait"
    )
      continue
    await ctx.db.patch(job._id, {
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: `${reason}_started`,
      pausedJobStatus: job.status,
      pausedWithRequestAt: now,
      nextAttemptAt: undefined,
      claimableAt: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      reapableAt: undefined,
      claimedByPrincipalId: undefined,
      updatedAt: now,
    })
  }
  return started
}

async function resumePausedJobs(
  ctx: MutationCtx,
  requestId: Id<"contentRequests">,
  pausedAt: number,
  cancellationReason: string,
  now: number
) {
  const jobs = await ctx.db
    .query("agentJobs")
    .withIndex("by_request", (index) => index.eq("requestId", requestId))
    .take(MAX_AGENT_JOBS_PER_REQUEST + 1)
  assertRequestCollectionBound(
    jobs.length,
    MAX_AGENT_JOBS_PER_REQUEST,
    "agent_jobs"
  )
  for (const job of jobs) {
    if (
      job.status !== "cancelled" ||
      job.cancellationReason !== cancellationReason ||
      job.pausedWithRequestAt !== pausedAt ||
      !job.pausedJobStatus
    )
      continue
    const attempts =
      job.pausedJobStatus === "running"
        ? Math.max(0, job.attempts - 1)
        : job.attempts
    const canRetry = attempts < job.maxAttempts
    await ctx.db.patch(job._id, {
      status: canRetry ? "queued" : "failed",
      attempts,
      cancelledAt: undefined,
      cancellationReason: undefined,
      pausedJobStatus: undefined,
      pausedWithRequestAt: undefined,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      reapableAt: undefined,
      claimedByPrincipalId: undefined,
      nextAttemptAt: canRetry ? now : undefined,
      claimableAt: canRetry ? now : undefined,
      lastErrorCode: canRetry ? job.lastErrorCode : "RETRY_BUDGET_EXHAUSTED",
      updatedAt: now,
    })
  }
}

const childDispositionMode = v.union(v.literal("archive"), v.literal("restore"))
const childDispositionResource = v.union(
  v.literal("deliverables"),
  v.literal("delivery_targets"),
  v.literal("agent_jobs"),
  v.literal("voice_captures"),
  v.literal("search_rows")
)

export const continueArchiveChildren = internalMutation({
  args: {
    requestId: v.id("contentRequests"),
    marker: v.number(),
    transitionToken: v.string(),
    mode: childDispositionMode,
    resource: childDispositionResource,
    cursor: v.optional(v.string()),
    processed: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (
      !request ||
      request.retention !== "archived" ||
      request.archiveTransitionToken !== args.transitionToken ||
      request.archiveTransitionMode !== args.mode ||
      request.archiveTransitionMarker !== args.marker
    )
      return null
    const pagination = { cursor: args.cursor ?? null, numItems: 25 }
    let continueCursor: string
    let isDone: boolean
    let processed = args.processed ?? 0
    if (args.resource === "deliverables") {
      const page = await ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .paginate(pagination)
      for (const deliverable of page.page) {
        if (args.mode === "archive") {
          if ((deliverable.retention ?? "active") !== "active") continue
          await ctx.db.patch(deliverable._id, {
            retention: "archived",
            archivedWithRequestAt: args.marker,
            updatedAt: Date.now(),
          })
        } else if (deliverable.archivedWithRequestAt === args.marker) {
          await ctx.db.patch(deliverable._id, {
            retention: "active",
            archivedWithRequestAt: undefined,
            updatedAt: Date.now(),
          })
        }
      }
      ;({ continueCursor, isDone } = page)
      processed += page.page.length
    } else if (args.resource === "delivery_targets") {
      const page = await ctx.db
        .query("deliveryTargets")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .paginate(pagination)
      for (const target of page.page) {
        if (args.mode === "archive") {
          if (target.retention !== "active") continue
          await ctx.db.patch(target._id, {
            retention: "archived",
            archivedWithRequestAt: args.marker,
            updatedAt: Date.now(),
          })
        } else if (target.archivedWithRequestAt === args.marker) {
          await ctx.db.patch(target._id, {
            retention: "active",
            archivedWithRequestAt: undefined,
            updatedAt: Date.now(),
          })
        }
      }
      ;({ continueCursor, isDone } = page)
      processed += page.page.length
    } else if (args.resource === "agent_jobs") {
      const page = await ctx.db
        .query("agentJobs")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .paginate(pagination)
      for (const job of page.page) {
        if (args.mode === "archive") {
          if (
            job.status !== "queued" &&
            job.status !== "running" &&
            job.status !== "retry_wait"
          )
            continue
          await ctx.db.patch(job._id, {
            status: "cancelled",
            cancelledAt: args.marker,
            cancellationReason: "request_archived",
            pausedJobStatus: job.status,
            pausedWithRequestAt: args.marker,
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            reapableAt: undefined,
            claimedByPrincipalId: undefined,
            nextAttemptAt: undefined,
            claimableAt: undefined,
            updatedAt: Date.now(),
          })
        } else if (
          job.status === "cancelled" &&
          job.cancellationReason === "request_archived" &&
          job.pausedWithRequestAt === args.marker &&
          job.pausedJobStatus
        ) {
          const attempts =
            job.pausedJobStatus === "running"
              ? Math.max(0, job.attempts - 1)
              : job.attempts
          const canRetry = attempts < job.maxAttempts
          await ctx.db.patch(job._id, {
            status: canRetry ? "queued" : "failed",
            attempts,
            cancelledAt: undefined,
            cancellationReason: canRetry
              ? "request_restoration_pending"
              : undefined,
            pausedJobStatus: canRetry ? job.pausedJobStatus : undefined,
            pausedWithRequestAt: canRetry ? args.marker : undefined,
            nextAttemptAt: undefined,
            claimableAt: undefined,
            lastErrorCode: canRetry
              ? job.lastErrorCode
              : "RETRY_BUDGET_EXHAUSTED",
            updatedAt: Date.now(),
          })
        }
      }
      ;({ continueCursor, isDone } = page)
      processed += page.page.length
    } else if (args.resource === "voice_captures") {
      if (args.mode === "archive") return null
      const page = await ctx.db
        .query("founderVoiceCaptures")
        .withIndex("by_request_created_at", (index) =>
          index.eq("requestId", request._id)
        )
        .paginate(pagination)
      for (const capture of page.page) {
        if (
          capture.discardedAt ||
          (capture.status !== "uploaded" && capture.status !== "transcribing")
        )
          continue
        if (capture.status === "transcribing") {
          const retryAttemptCount =
            capture.retryAttemptCount ?? capture.attempts
          await ctx.db.patch(capture._id, {
            status: "uploaded",
            retryAttemptCount: Math.max(0, retryAttemptCount - 1),
            transcriptionLeaseExpiresAt: undefined,
            updatedAt: Date.now(),
          })
        }
      }
      ;({ continueCursor, isDone } = page)
      processed += page.page.length
    } else {
      const page = await ctx.db
        .query("operatorWorkspaceSearchRows")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .paginate(pagination)
      for (const row of page.page)
        await ctx.db.patch(row._id, {
          active: false,
          retained: false,
          updatedAt: Date.now(),
        })
      ;({ continueCursor, isDone } = page)
      processed += page.page.length
    }
    if (!isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.requestDisposition.continueArchiveChildren,
        { ...args, cursor: continueCursor, processed }
      )
    else {
      const latest = await ctx.db.get(request._id)
      if (
        !latest ||
        latest.archiveTransitionToken !== args.transitionToken ||
        latest.archiveTransitionPendingResources === undefined
      )
        return null
      const hasOverflowTargets =
        latest.archiveTransitionHasOverflowTargets ||
        (args.resource === "delivery_targets" &&
          processed > MAX_DELIVERY_TARGETS_PER_REQUEST)
      if (latest.archiveTransitionPendingResources > 1) {
        await ctx.db.patch(latest._id, {
          archiveTransitionPendingResources:
            latest.archiveTransitionPendingResources - 1,
          archiveTransitionHasOverflowTargets: hasOverflowTargets,
        })
        return null
      }
      if (args.mode === "restore") {
        await ctx.db.patch(latest._id, {
          retention: "active",
          archivedAt: undefined,
          autoExpirationDueAt:
            latest.origin === "automated_scout" &&
            latest.disposition === "active"
              ? latest.expiresAt
              : undefined,
          expirationDispatchToken: undefined,
          expirationOriginalDueAt: undefined,
          archiveTransitionToken: undefined,
          archiveTransitionMode: undefined,
          archiveTransitionMarker: undefined,
          archiveTransitionPendingResources: undefined,
          archiveTransitionHasOverflowTargets: undefined,
          updatedAt: Date.now(),
        })
        await ctx.scheduler.runAfter(
          0,
          internal.requestDisposition.activateRestoredJobs,
          { requestId: latest._id, marker: args.marker }
        )
        await ctx.scheduler.runAfter(
          0,
          internal.requestDisposition.resumeRestoredVoiceCaptures,
          { requestId: latest._id }
        )
        if (hasOverflowTargets) {
          const projection = await ctx.db
            .query("operatorWorkspaceItems")
            .withIndex("by_request", (index) =>
              index.eq("requestId", latest._id)
            )
            .unique()
          if (projection) {
            const reason = "Legacy delivery target count requires remediation"
            const attentionReasons = projection.attentionReasons.includes(
              reason
            )
              ? projection.attentionReasons
              : [...projection.attentionReasons, reason]
            await ctx.db.patch(projection._id, {
              active: true,
              retained: true,
              queue: "attention_required",
              attentionReasons,
              attentionReasonCount: attentionReasons.length,
              updatedAt: Date.now(),
            })
          }
          await ctx.scheduler.runAfter(
            0,
            internal.operatorWorkspace.repairLegacySearchRows,
            { requestId: latest._id }
          )
        } else await refreshOperatorWorkspaceProjection(ctx, latest._id)
      } else {
        await ctx.db.patch(latest._id, {
          archiveTransitionToken: undefined,
          archiveTransitionMode: undefined,
          archiveTransitionMarker: undefined,
          archiveTransitionPendingResources: undefined,
          archiveTransitionHasOverflowTargets: undefined,
          updatedAt: Date.now(),
        })
      }
    }
    return null
  },
})

export const activateRestoredJobs = internalMutation({
  args: {
    requestId: v.id("contentRequests"),
    marker: v.number(),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (!request || request.retention !== "active") return null
    const page = await ctx.db
      .query("agentJobs")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .paginate({ cursor: args.cursor ?? null, numItems: 25 })
    const now = Date.now()
    for (const job of page.page) {
      if (
        job.status !== "queued" ||
        job.cancellationReason !== "request_restoration_pending" ||
        job.pausedWithRequestAt !== args.marker
      )
        continue
      await ctx.db.patch(job._id, {
        cancellationReason: undefined,
        pausedJobStatus: undefined,
        pausedWithRequestAt: undefined,
        nextAttemptAt: now,
        claimableAt: now,
        updatedAt: now,
      })
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.requestDisposition.activateRestoredJobs,
        {
          requestId: request._id,
          marker: args.marker,
          cursor: page.continueCursor,
        }
      )
    return null
  },
})

export const resumeRestoredVoiceCaptures = internalMutation({
  args: {
    requestId: v.id("contentRequests"),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (!request || request.retention !== "active") return null
    const page = await ctx.db
      .query("founderVoiceCaptures")
      .withIndex("by_request_created_at", (index) =>
        index.eq("requestId", request._id)
      )
      .paginate({ cursor: args.cursor ?? null, numItems: 25 })
    for (const capture of page.page) {
      if (capture.discardedAt || capture.status !== "uploaded") continue
      await ctx.scheduler.runAfter(0, internal.voiceCaptures.transcribe, {
        captureId: capture._id,
      })
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.requestDisposition.resumeRestoredVoiceCaptures,
        { requestId: request._id, cursor: page.continueCursor }
      )
    return null
  },
})

export const setExpiration = mutation({
  args: {
    humanId: v.string(),
    expiresAt: v.union(v.number(), v.null()),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const { actor, request } = await requestForEditor(ctx, args.humanId)
    const correlationId = required(args.correlationId, "correlationId")
    if (args.expiresAt !== null && !validTimestamp(args.expiresAt)) {
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "expiresAt" })
    }
    const fingerprint = JSON.stringify({ expiresAt: args.expiresAt })
    if (
      await priorAudit(
        ctx,
        actor,
        request,
        "content_request.expiration_set",
        correlationId,
        fingerprint
      )
    ) {
      const replay = await ctx.db.get(request._id)
      if (!replay) throw new ConvexError({ code: "WRITE_FAILED" })
      return toPublicRequest(ctx, replay)
    }
    requireActiveRequest(request)
    if (args.expiresAt !== null && args.expiresAt <= Date.now()) {
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "expiresAt" })
    }
    const now = Date.now()
    const afterVersion = request.aggregateVersion + 1
    const expiresAt = args.expiresAt ?? undefined
    await ctx.db.patch(request._id, {
      expiresAt,
      autoExpirationDueAt:
        request.origin === "automated_scout" &&
        request.disposition === "active" &&
        request.retention === "active"
          ? expiresAt
          : undefined,
      expirationDispatchToken: undefined,
      expirationOriginalDueAt: undefined,
      expirationReviewRequiredAt: undefined,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await audit(ctx, {
      request,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.expiration_set",
      correlationId,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      inputFingerprint: fingerprint,
      occurredAt: now,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, updated)
  },
})

export const expire = mutation({
  args: {
    humanId: v.string(),
    reason: v.string(),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const { actor, request } = await requestForEditor(ctx, args.humanId)
    const correlationId = required(args.correlationId, "correlationId")
    const reason = required(args.reason, "reason")
    const fingerprint = JSON.stringify({ reason })
    if (
      await priorAudit(
        ctx,
        actor,
        request,
        "content_request.expired",
        correlationId,
        fingerprint
      )
    ) {
      const replay = await ctx.db.get(request._id)
      if (!replay) throw new ConvexError({ code: "WRITE_FAILED" })
      return toPublicRequest(ctx, replay)
    }
    if (request.retention !== "active") {
      throw new ConvexError({ code: "ARCHIVED_REQUEST" })
    }
    if (request.disposition !== "active") {
      throw new ConvexError({ code: "REQUEST_ALREADY_EXPIRED" })
    }
    const now = Date.now()
    const started = await cancelUnclaimedJobs(
      ctx,
      request._id,
      now,
      "request_expired"
    )
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      disposition: "expired",
      expiredAt: now,
      expirationReason: reason,
      autoExpirationDueAt: undefined,
      expirationDispatchToken: undefined,
      expirationOriginalDueAt: undefined,
      expirationReviewRequiredAt: started.length ? now : undefined,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await audit(ctx, {
      request,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.expired",
      correlationId,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      inputFingerprint: fingerprint,
      occurredAt: now,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, updated)
  },
})

export const restoreExpired = mutation({
  args: {
    humanId: v.string(),
    expiresAt: v.optional(v.union(v.number(), v.null())),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const { actor, request } = await requestForEditor(ctx, args.humanId)
    const correlationId = required(args.correlationId, "correlationId")
    const replacement = args.expiresAt ?? null
    if (replacement !== null && !validTimestamp(replacement)) {
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "expiresAt" })
    }
    const fingerprint = JSON.stringify({ expiresAt: replacement })
    if (
      await priorAudit(
        ctx,
        actor,
        request,
        "content_request.expiration_restored",
        correlationId,
        fingerprint
      )
    ) {
      const replay = await ctx.db.get(request._id)
      if (!replay) throw new ConvexError({ code: "WRITE_FAILED" })
      return toPublicRequest(ctx, replay)
    }
    if (replacement !== null && replacement <= Date.now()) {
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "expiresAt" })
    }
    if (request.retention !== "active")
      throw new ConvexError({ code: "ARCHIVED_REQUEST" })
    if (request.disposition !== "expired")
      throw new ConvexError({ code: "REQUEST_NOT_EXPIRED" })
    const now = Date.now()
    const expiresAt = replacement ?? undefined
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      disposition: "active",
      expiresAt,
      autoExpirationDueAt:
        request.origin === "automated_scout" ? expiresAt : undefined,
      expirationDispatchToken: undefined,
      expirationOriginalDueAt: undefined,
      expiredAt: undefined,
      expirationReason: undefined,
      expirationReviewRequiredAt: undefined,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    if (request.expiredAt) {
      await resumePausedJobs(
        ctx,
        request._id,
        request.expiredAt,
        "request_expired",
        now
      )
      await resumePausedJobs(
        ctx,
        request._id,
        request.expiredAt,
        "request_expired_started",
        now
      )
    }
    await resumeVoiceTranscriptions(ctx, request._id, now)
    await audit(ctx, {
      request,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.expiration_restored",
      correlationId,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      inputFingerprint: fingerprint,
      occurredAt: now,
    })
    await refreshOperatorWorkspaceProjection(ctx, request._id)
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, updated)
  },
})

export const archive = mutation({
  args: { humanId: v.string(), correlationId: v.string() },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const { actor, request } = await requestForEditor(ctx, args.humanId)
    const correlationId = required(args.correlationId, "correlationId")
    const fingerprint = JSON.stringify({ retention: "archived" })
    if (
      await priorAudit(
        ctx,
        actor,
        request,
        "content_request.archived",
        correlationId,
        fingerprint
      )
    ) {
      const replay = await ctx.db.get(request._id)
      if (!replay) throw new ConvexError({ code: "WRITE_FAILED" })
      return toPublicRequest(ctx, replay)
    }
    if (request.retention === "archived")
      throw new ConvexError({ code: "REQUEST_ALREADY_ARCHIVED" })
    if (request.archiveTransitionToken)
      throw new ConvexError({ code: "DISPOSITION_TRANSITION_IN_PROGRESS" })
    const now = Date.now()
    const transitionToken = crypto.randomUUID()
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      retention: "archived",
      archivedAt: now,
      archiveTransitionToken: transitionToken,
      archiveTransitionMode: "archive",
      archiveTransitionMarker: now,
      archiveTransitionPendingResources: 4,
      archiveTransitionHasOverflowTargets: false,
      autoExpirationDueAt: undefined,
      expirationDispatchToken: undefined,
      expirationOriginalDueAt: undefined,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await audit(ctx, {
      request,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.archived",
      correlationId,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      inputFingerprint: fingerprint,
      occurredAt: now,
    })
    for (const resource of [
      "deliverables",
      "delivery_targets",
      "agent_jobs",
      "search_rows",
    ] as const)
      await ctx.scheduler.runAfter(
        0,
        internal.requestDisposition.continueArchiveChildren,
        {
          requestId: request._id,
          marker: now,
          transitionToken,
          mode: "archive",
          resource,
        }
      )
    const projection = await ctx.db
      .query("operatorWorkspaceItems")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique()
    if (projection)
      await ctx.db.patch(projection._id, {
        active: false,
        retained: false,
        updatedAt: now,
      })
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, updated)
  },
})

export const restoreArchived = mutation({
  args: { humanId: v.string(), correlationId: v.string() },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const { actor, request } = await requestForEditor(ctx, args.humanId)
    const correlationId = required(args.correlationId, "correlationId")
    const fingerprint = JSON.stringify({ retention: "active" })
    if (
      await priorAudit(
        ctx,
        actor,
        request,
        "content_request.archive_restored",
        correlationId,
        fingerprint
      )
    ) {
      const replay = await ctx.db.get(request._id)
      if (!replay) throw new ConvexError({ code: "WRITE_FAILED" })
      return toPublicRequest(ctx, replay)
    }
    if (request.retention !== "archived" || !request.archivedAt)
      throw new ConvexError({ code: "REQUEST_NOT_ARCHIVED" })
    if (request.archiveTransitionToken)
      throw new ConvexError({ code: "DISPOSITION_TRANSITION_IN_PROGRESS" })
    const now = Date.now()
    const restorationSourceAt = request.archivedAt
    const transitionToken = crypto.randomUUID()
    const afterVersion = request.aggregateVersion + 1
    await ctx.db.patch(request._id, {
      archiveTransitionToken: transitionToken,
      archiveTransitionMode: "restore",
      archiveTransitionMarker: restorationSourceAt,
      archiveTransitionPendingResources: 5,
      archiveTransitionHasOverflowTargets: false,
      aggregateVersion: afterVersion,
      updatedAt: now,
    })
    await audit(ctx, {
      request,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.archive_restored",
      correlationId,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      inputFingerprint: fingerprint,
      occurredAt: now,
    })
    for (const resource of [
      "deliverables",
      "delivery_targets",
      "agent_jobs",
      "voice_captures",
      "search_rows",
    ] as const)
      await ctx.scheduler.runAfter(
        0,
        internal.requestDisposition.continueArchiveChildren,
        {
          requestId: request._id,
          marker: restorationSourceAt,
          transitionToken,
          mode: "restore",
          resource,
        }
      )
    const updated = await ctx.db.get(request._id)
    if (!updated) throw new ConvexError({ code: "WRITE_FAILED" })
    return toPublicRequest(ctx, updated)
  },
})

export const createFollowUp = mutation({
  args: {
    parentHumanId: v.string(),
    title: v.string(),
    reason: v.string(),
    source: v.optional(sourceInputValidator),
    correlationId: v.string(),
  },
  returns: contentRequestValidator,
  handler: async (ctx, args) => {
    const { actor, request: parent } = await requestForEditor(
      ctx,
      args.parentHumanId
    )
    const title = required(args.title, "title")
    const reason = required(args.reason, "reason")
    const correlationId = required(args.correlationId, "correlationId")
    const fingerprint = JSON.stringify({
      title,
      reason,
      source: args.source ?? null,
    })
    const prior = await ctx.db
      .query("followUpOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", actor.organizationId)
          .eq("actorPrincipalId", actor._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (
        prior.parentRequestId !== parent._id ||
        prior.inputFingerprint !== fingerprint
      )
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      const replay = await ctx.db.get(prior.childRequestId)
      if (!replay) throw new ConvexError({ code: "WRITE_FAILED" })
      return toPublicRequest(ctx, replay)
    }
    const now = Date.now()
    const childId = await ctx.db.insert("contentRequests", {
      humanId: "pending",
      organizationId: actor.organizationId,
      title,
      normalizedTitle: normalized(title),
      searchText: [
        title,
        args.source?.question,
        args.source?.body,
        args.source?.url,
        args.source?.name,
        args.source?.channel,
      ]
        .filter(Boolean)
        .join(" "),
      queueSortKey: requestQueueSortKey("manual", "critical", now),
      aliases: [],
      origin: "manual",
      priority: "critical",
      lifecycle: "pending",
      disposition: "active",
      retention: "active",
      aggregateVersion: 1,
      parentRequestId: parent._id,
      followUpReason: reason,
      assigneePrincipalId:
        parent.assigneePrincipalId ?? parent.createdByPrincipalId,
      watcherPrincipalIds: parent.watcherPrincipalIds ?? [],
      createdByPrincipalId: actor._id,
      createdAt: now,
      updatedAt: now,
    })
    const humanId = humanIdFor(childId)
    const deliverableId = await ctx.db.insert("deliverables", {
      organizationId: actor.organizationId,
      requestId: childId,
      kind: "primary_response",
      name: "Primary response",
      isPrimary: true,
      retention: "active",
      createdAt: now,
      updatedAt: now,
    })
    let sourceSnapshotId: Id<"sourceSnapshots"> | undefined
    if (args.source) {
      sourceSnapshotId = await ctx.db.insert("sourceSnapshots", {
        organizationId: actor.organizationId,
        requestId: childId,
        ...args.source,
        captureKind: "manual_supplemental",
        capturedByPrincipalId: actor._id,
        capturedAt: now,
      })
    }
    await ctx.db.insert("deliveryTargets", {
      organizationId: actor.organizationId,
      requestId: childId,
      deliverableId,
      channel: args.source?.channel?.trim() || "original_opportunity",
      destinationLabel: args.source?.name?.trim() || "Follow-up response",
      destinationUrl: args.source?.url?.trim() || undefined,
      isOriginal: true,
      isRequired: true,
      retention: "active",
      createdByPrincipalId: actor._id,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(childId, { humanId, sourceSnapshotId })
    const parentAfterVersion = parent.aggregateVersion + 1
    await ctx.db.patch(parent._id, {
      aggregateVersion: parentAfterVersion,
      updatedAt: now,
    })
    await ctx.db.insert("followUpOperations", {
      organizationId: actor.organizationId,
      parentRequestId: parent._id,
      childRequestId: childId,
      actorPrincipalId: actor._id,
      correlationId,
      inputFingerprint: fingerprint,
      createdAt: now,
    })
    await audit(ctx, {
      request: parent,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.follow_up_created",
      correlationId,
      beforeVersion: parent.aggregateVersion,
      afterVersion: parentAfterVersion,
      inputFingerprint: fingerprint,
      occurredAt: now,
    })
    const child = await ctx.db.get(childId)
    if (!child) throw new ConvexError({ code: "WRITE_FAILED" })
    await audit(ctx, {
      request: child,
      actorPrincipalId: actor._id,
      credentialId: actor.credentialId,
      operation: "content_request.created",
      correlationId,
      afterVersion: 1,
      inputFingerprint: fingerprint,
      occurredAt: now,
    })
    const assignee = await ctx.db.get(
      child.assigneePrincipalId ?? child.createdByPrincipalId
    )
    if (assignee?.role === "founder") {
      await enqueueNotification(ctx, child, assignee, "request_assigned", now)
      await enqueueNotification(
        ctx,
        child,
        assignee,
        "critical_escalation",
        now
      )
    }
    await refreshOperatorWorkspaceProjection(ctx, parent._id)
    await refreshOperatorWorkspaceProjection(ctx, childId)
    return toPublicRequest(ctx, child)
  },
})

export const getRelations = query({
  args: { humanId: v.string() },
  returns: relationValidator,
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
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const parent = request.parentRequestId
      ? await ctx.db.get(request.parentRequestId)
      : null
    const children = await ctx.db
      .query("contentRequests")
      .withIndex("by_parent_created_at", (index) =>
        index.eq("parentRequestId", request._id)
      )
      .take(101)
    return {
      parent: parent ? relationSummary(parent) : null,
      children: children.slice(0, 100).map(relationSummary),
      childrenTruncated: children.length > 100,
    }
  },
})

export const expireDueRequest = internalMutation({
  args: {
    requestId: v.id("contentRequests"),
    expectedDueAt: v.number(),
    dispatchToken: v.string(),
    now: v.number(),
  },
  returns: v.object({
    outcome: v.union(
      v.literal("expired"),
      v.literal("protected"),
      v.literal("stale")
    ),
    cancelledJobs: v.number(),
  }),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (
      !request ||
      request.expirationDispatchToken !== args.dispatchToken ||
      request.expirationOriginalDueAt !== args.expectedDueAt ||
      args.expectedDueAt > args.now ||
      request.origin !== "automated_scout" ||
      request.disposition !== "active" ||
      request.retention !== "active"
    ) {
      if (request?.expirationDispatchToken === args.dispatchToken)
        await ctx.db.patch(request._id, {
          autoExpirationDueAt: undefined,
          expirationDispatchToken: undefined,
          expirationOriginalDueAt: undefined,
        })
      return { outcome: "stale" as const, cancelledJobs: 0 }
    }
    const [founderInput, jobs, legacyVoiceCaptures] = await Promise.all([
      ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .unique(),
      ctx.db
        .query("agentJobs")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .take(MAX_AGENT_JOBS_PER_REQUEST + 1),
      request.activeVoiceCaptureCount === undefined
        ? ctx.db
            .query("founderVoiceCaptures")
            .withIndex("by_request_created_at", (index) =>
              index.eq("requestId", request._id)
            )
            .take(MAX_VOICE_CAPTURES_PER_REQUEST + 1)
        : [],
    ])
    if (
      request.activeVoiceCaptureCount === undefined &&
      legacyVoiceCaptures.length > MAX_VOICE_CAPTURES_PER_REQUEST
    ) {
      const generation = request.voiceCaptureCountGeneration ?? 0
      await ctx.db.patch(request._id, {
        activeVoiceCaptureCount: VOICE_CAPTURE_OVERFLOW_SENTINEL,
        autoExpirationDueAt: args.now + EXPIRATION_DISPATCH_LEASE_MS,
        expirationDispatchToken: undefined,
        expirationOriginalDueAt: args.expectedDueAt,
        updatedAt: args.now,
      })
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recountActiveVoiceCaptures,
        { requestId: request._id, generation, count: 0 }
      )
      return { outcome: "stale" as const, cancelledJobs: 0 }
    }
    const startedJob = jobs.some(
      (job) =>
        job.attempts > 0 ||
        ["running", "retry_wait", "completed", "failed"].includes(job.status)
    )
    const meaningfulProgress =
      Boolean(founderInput?.hasMeaningfulDraft) ||
      (request.activeVoiceCaptureCount ??
        legacyVoiceCaptures.filter((capture) => !capture.discardedAt).length) >
        0 ||
      request.lifecycle !== "pending" ||
      startedJob ||
      jobs.length > MAX_AGENT_JOBS_PER_REQUEST
    const afterVersion = request.aggregateVersion + 1
    const correlationId = `expiration:${request._id}:${args.expectedDueAt}`
    const systemActor = await expirationSystemActor(
      ctx,
      request.organizationId,
      args.now
    )
    const projection = await ctx.db
      .query("operatorWorkspaceItems")
      .withIndex("by_request", (index) => index.eq("requestId", request._id))
      .unique()
    if (meaningfulProgress) {
      await ctx.db.patch(request._id, {
        autoExpirationDueAt: undefined,
        expirationDispatchToken: undefined,
        expirationOriginalDueAt: undefined,
        expirationReviewRequiredAt: args.now,
        aggregateVersion: afterVersion,
        updatedAt: args.now,
      })
      await audit(ctx, {
        request,
        actorPrincipalId: systemActor._id,
        credentialId: "system:expiration",
        operation: "content_request.expiration_review_required",
        correlationId,
        beforeVersion: request.aggregateVersion,
        afterVersion,
        occurredAt: args.now,
      })
      if (projection) {
        const reason = "Review protected work after its expiration deadline"
        const attentionReasons = projection.attentionReasons.includes(reason)
          ? projection.attentionReasons
          : [...projection.attentionReasons, reason]
        await ctx.db.patch(projection._id, {
          queue: "attention_required",
          attentionReasons,
          attentionReasonCount: attentionReasons.length,
          nextActionChangedAt: args.now,
          updatedAt: args.now,
        })
      }
      await syncBoundedWorkspaceSearchRows(ctx, request._id, {
        queue: "attention_required",
        updatedAt: args.now,
      })
      return { outcome: "protected" as const, cancelledJobs: 0 }
    }
    let cancelledJobs = 0
    for (const job of jobs) {
      if (job.status !== "queued" || job.attempts > 0) continue
      cancelledJobs += 1
      await ctx.db.patch(job._id, {
        status: "cancelled",
        cancelledAt: args.now,
        cancellationReason: "request_expired",
        pausedJobStatus: "queued",
        pausedWithRequestAt: args.now,
        nextAttemptAt: undefined,
        claimableAt: undefined,
        updatedAt: args.now,
      })
    }
    await ctx.db.patch(request._id, {
      disposition: "expired",
      expiredAt: args.now,
      expirationReason: "automatic_expiration",
      autoExpirationDueAt: undefined,
      expirationDispatchToken: undefined,
      expirationOriginalDueAt: undefined,
      aggregateVersion: afterVersion,
      updatedAt: args.now,
    })
    await audit(ctx, {
      request,
      actorPrincipalId: systemActor._id,
      credentialId: "system:expiration",
      operation: "content_request.expired",
      correlationId,
      beforeVersion: request.aggregateVersion,
      afterVersion,
      occurredAt: args.now,
    })
    if (projection)
      await ctx.db.patch(projection._id, {
        active: false,
        disposition: "expired",
        agentJobStatus:
          jobs[0]?.status === "queued" ? "cancelled" : jobs[0]?.status,
        updatedAt: args.now,
      })
    await syncBoundedWorkspaceSearchRows(ctx, request._id, {
      active: false,
      disposition: "expired",
      updatedAt: args.now,
    })
    return { outcome: "expired" as const, cancelledJobs }
  },
})

export const expireDue = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now()
    const due = await ctx.db
      .query("contentRequests")
      .withIndex("by_auto_expiration_due_at", (index) =>
        index.gt("autoExpirationDueAt", 0).lte("autoExpirationDueAt", now)
      )
      .take(100)
    for (const request of due) {
      const expectedDueAt =
        request.expirationOriginalDueAt ?? request.autoExpirationDueAt!
      const dispatchToken = crypto.randomUUID()
      await ctx.db.patch(request._id, {
        autoExpirationDueAt: now + EXPIRATION_DISPATCH_LEASE_MS,
        expirationDispatchToken: dispatchToken,
        expirationOriginalDueAt: expectedDueAt,
      })
      await ctx.scheduler.runAfter(
        0,
        internal.requestDisposition.expireDueRequest,
        {
          requestId: request._id,
          expectedDueAt,
          dispatchToken,
          now,
        }
      )
    }
    return { scheduled: due.length }
  },
})
