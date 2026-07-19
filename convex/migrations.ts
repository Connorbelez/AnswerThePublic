import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation, internalQuery } from "./_generated/server"
import { requestQueueSortKey } from "./lib/requestOrdering"
import { lifecycleForPrimary } from "./lib/deliverableLifecycle"
import { projectDeliveryLifecycle } from "./lib/deliveryLifecycle"
import { refreshOperatorWorkspaceProjection } from "./lib/operatorWorkspaceProjection"
import { normalizeSourceUrl } from "../shared/url-normalization"
import { normalizeLegacyDeliveryChannel } from "../shared/delivery-channel"
import {
  MAX_VOICE_CAPTURES_PER_REQUEST,
  VOICE_CAPTURE_OVERFLOW_SENTINEL,
} from "./lib/requestLimits"

export const backfillAssignmentFields = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contentRequests").paginate({
      cursor: args.cursor ?? null,
      numItems: 100,
    })
    let migrated = 0
    for (const request of page.page) {
      if (
        request.assigneePrincipalId &&
        request.watcherPrincipalIds &&
        request.queueSortKey
      ) {
        continue
      }
      await ctx.db.patch(request._id, {
        assigneePrincipalId:
          request.assigneePrincipalId ?? request.createdByPrincipalId,
        watcherPrincipalIds: request.watcherPrincipalIds ?? [],
        queueSortKey:
          request.queueSortKey ??
          requestQueueSortKey(
            request.origin,
            request.priority,
            request.createdAt
          ),
      })
      migrated += 1
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillAssignmentFields,
        { cursor: page.continueCursor }
      )
    }
    return { migrated, done: page.isDone }
  },
})

export const backfillNormalizedSourceUrls = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contentRequests").paginate({
      cursor: args.cursor ?? null,
      numItems: 100,
    })
    let migrated = 0
    for (const request of page.page) {
      if (request.normalizedSourceUrl || !request.sourceSnapshotId) continue
      const source = await ctx.db.get(request.sourceSnapshotId)
      const normalizedSourceUrl = source?.url
        ? normalizeSourceUrl(source.url)
        : null
      if (!normalizedSourceUrl) continue
      const conflictingRequest = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_normalized_source_url", (index) =>
          index
            .eq("organizationId", request.organizationId)
            .eq("normalizedSourceUrl", normalizedSourceUrl)
        )
        .first()
      if (conflictingRequest && conflictingRequest._id !== request._id) {
        const existingConflict = await ctx.db
          .query("migrationConflicts")
          .withIndex("by_request_type", (index) =>
            index
              .eq("requestId", request._id)
              .eq("type", "normalized_source_url_collision")
          )
          .unique()
        if (!existingConflict) {
          await ctx.db.insert("migrationConflicts", {
            organizationId: request.organizationId,
            type: "normalized_source_url_collision",
            requestId: request._id,
            conflictingRequestId: conflictingRequest._id,
            normalizedSourceUrl,
            resolved: false,
            createdAt: Date.now(),
          })
        }
        continue
      }
      await ctx.db.patch(request._id, { normalizedSourceUrl })
      migrated += 1
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillNormalizedSourceUrls,
        { cursor: page.continueCursor }
      )
    }
    return { migrated, done: page.isDone }
  },
})

/**
 * Introduced with deliverable versioning. Safe to rerun: requests that already
 * have a deliverable are left untouched, while legacy requests receive the
 * single empty primary response required by the domain invariant.
 */
export const backfillPrimaryDeliverables = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contentRequests").paginate({
      cursor: args.cursor ?? null,
      numItems: 100,
    })
    let migrated = 0
    for (const request of page.page) {
      const deliverables = await ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect()
      const now = Date.now()
      const active = deliverables.filter(
        (deliverable) => (deliverable.retention ?? "active") === "active"
      )
      let selected = active
        .sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id))
        .find((deliverable) => deliverable.isPrimary)
      if (!selected) selected = active[0]
      if (!selected) {
        const selectedId = await ctx.db.insert("deliverables", {
          organizationId: request.organizationId,
          requestId: request._id,
          kind: "primary_response",
          name: "Primary response",
          isPrimary: true,
          retention: "active",
          createdAt: now,
          updatedAt: now,
        })
        selected = (await ctx.db.get(selectedId)) ?? undefined
        if (!selected) throw new Error("Primary deliverable insert failed")
      }
      const ordered = deliverables.sort(
        (a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id)
      )
      let changed = deliverables.length === 0 || active.length === 0
      for (const deliverable of ordered) {
        const shouldBePrimary = deliverable._id === selected._id
        if (deliverable.isPrimary !== shouldBePrimary) {
          await ctx.db.patch(deliverable._id, {
            isPrimary: shouldBePrimary,
            updatedAt: now,
          })
          changed = true
        }
      }
      if (changed) {
        await ctx.db.patch(request._id, {
          lifecycle: await lifecycleForPrimary(ctx, request, selected),
          updatedAt: now,
        })
        migrated += 1
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillPrimaryDeliverables,
        { cursor: page.continueCursor }
      )
    return { migrated, done: page.isDone }
  },
})

export const backfillOriginalDeliveryTargets = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contentRequests").paginate({
      cursor: args.cursor ?? null,
      numItems: 100,
    })
    let migrated = 0
    for (const request of page.page) {
      const targets = await ctx.db
        .query("deliveryTargets")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect()
      const deliverables = await ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect()
      const primary = deliverables.find(
        (deliverable) =>
          deliverable.isPrimary &&
          (deliverable.retention ?? "active") === "active"
      )
      if (!primary) continue
      const source = request.sourceSnapshotId
        ? await ctx.db.get(request.sourceSnapshotId)
        : null
      const now = Date.now()
      const originalTargets = targets
        .filter((target) => target.isOriginal)
        .sort(
          (a, b) =>
            Number(Boolean(b.currentReceiptId)) -
              Number(Boolean(a.currentReceiptId)) || a.createdAt - b.createdAt
        )
      const selected =
        originalTargets.find((target) => target.currentReceiptId) ??
        originalTargets.find((target) => target.retention === "active") ??
        originalTargets[0]
      let changed = false
      if (selected) {
        if (
          selected.retention !== "active" ||
          !selected.isRequired ||
          selected.deliverableId !== primary._id ||
          selected.channel !==
            normalizeLegacyDeliveryChannel(source?.channel, source?.url)
        ) {
          await ctx.db.patch(selected._id, {
            retention: "active",
            isRequired: true,
            deliverableId: primary._id,
            channel: normalizeLegacyDeliveryChannel(
              source?.channel,
              source?.url
            ),
            updatedAt: now,
          })
          changed = true
        }
        for (const duplicate of originalTargets)
          if (duplicate._id !== selected._id) {
            await ctx.db.patch(duplicate._id, {
              isOriginal: false,
              isRequired: false,
              retention: "archived",
              updatedAt: now,
            })
            changed = true
          }
      } else {
        await ctx.db.insert("deliveryTargets", {
          organizationId: request.organizationId,
          requestId: request._id,
          deliverableId: primary._id,
          channel: normalizeLegacyDeliveryChannel(source?.channel, source?.url),
          destinationLabel:
            source?.name?.trim() || "Original opportunity response",
          destinationUrl: source?.url?.trim() || undefined,
          isOriginal: true,
          isRequired: true,
          retention: "active",
          createdByPrincipalId: request.createdByPrincipalId,
          createdAt: now,
          updatedAt: now,
        })
        changed = true
      }
      if (!changed) continue
      await projectDeliveryLifecycle(ctx, request)
      migrated += 1
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillOriginalDeliveryTargets,
        { cursor: page.continueCursor }
      )
    return { migrated, done: page.isDone }
  },
})

export const backfillOperatorWorkspace = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contentRequests").paginate({
      cursor: args.cursor ?? null,
      numItems: 50,
    })
    for (const request of page.page) {
      const targets = await ctx.db
        .query("deliveryTargets")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect()
      for (const target of targets) {
        if (target.hasHistoricalReceipt !== undefined) continue
        const receipt = await ctx.db
          .query("deliveryReceipts")
          .withIndex("by_target_responded_at", (index) =>
            index.eq("targetId", target._id)
          )
          .first()
        await ctx.db.patch(target._id, {
          hasHistoricalReceipt: Boolean(receipt),
        })
      }
      await refreshOperatorWorkspaceProjection(ctx, request._id)
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillOperatorWorkspace,
        {
          cursor: page.continueCursor,
        }
      )
    return { migrated: page.page.length, done: page.isDone }
  },
})

/**
 * Introduced with indexed job claiming. This keeps the hot claim path bounded
 * while making every pre-existing non-terminal job visible to that index.
 * Safe to rerun because jobs with the correct claimability timestamp are
 * unchanged and terminal jobs are removed from the claim index.
 */
export const backfillAgentJobClaimability = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("agentJobs").paginate({
      cursor: args.cursor ?? null,
      numItems: 100,
    })
    let migrated = 0
    for (const job of page.page) {
      const claimableAt =
        job.status === "queued"
          ? (job.nextAttemptAt ?? job.createdAt)
          : job.status === "retry_wait"
            ? (job.nextAttemptAt ?? job.updatedAt)
            : job.status === "running"
              ? (job.leaseExpiresAt ?? job.updatedAt)
              : undefined
      const reapableAt =
        job.status === "running" && job.attempts >= job.maxAttempts
          ? (job.leaseExpiresAt ?? job.updatedAt)
          : undefined
      if (job.claimableAt === claimableAt && job.reapableAt === reapableAt)
        continue
      await ctx.db.patch(job._id, { claimableAt, reapableAt })
      migrated += 1
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillAgentJobClaimability,
        { cursor: page.continueCursor }
      )
    return { migrated, done: page.isDone }
  },
})

export const backfillActiveVoiceCaptureCounts = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ migrated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contentRequests").paginate({
      cursor: args.cursor ?? null,
      numItems: 50,
    })
    let migrated = 0
    for (const request of page.page) {
      if (request.activeVoiceCaptureCount !== undefined) continue
      const captures = await ctx.db
        .query("founderVoiceCaptures")
        .withIndex("by_request_created_at", (index) =>
          index.eq("requestId", request._id)
        )
        .take(MAX_VOICE_CAPTURES_PER_REQUEST + 1)
      const activeVoiceCaptureCount =
        captures.length > MAX_VOICE_CAPTURES_PER_REQUEST
          ? VOICE_CAPTURE_OVERFLOW_SENTINEL
          : captures.filter((capture) => !capture.discardedAt).length
      await ctx.db.patch(request._id, { activeVoiceCaptureCount })
      if (captures.length > MAX_VOICE_CAPTURES_PER_REQUEST)
        await ctx.scheduler.runAfter(
          0,
          internal.migrations.recountActiveVoiceCaptures,
          {
            requestId: request._id,
            generation: request.voiceCaptureCountGeneration ?? 0,
            count: 0,
          }
        )
      migrated += 1
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillActiveVoiceCaptureCounts,
        { cursor: page.continueCursor }
      )
    return { migrated, done: page.isDone }
  },
})

export const recountActiveVoiceCaptures = internalMutation({
  args: {
    requestId: v.id("contentRequests"),
    generation: v.number(),
    count: v.number(),
    cursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId)
    if (!request) return null
    const currentGeneration = request.voiceCaptureCountGeneration ?? 0
    if (currentGeneration !== args.generation) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recountActiveVoiceCaptures,
        {
          requestId: request._id,
          generation: currentGeneration,
          count: 0,
        }
      )
      return null
    }
    const page = await ctx.db
      .query("founderVoiceCaptures")
      .withIndex("by_request_created_at", (index) =>
        index.eq("requestId", request._id)
      )
      .paginate({ cursor: args.cursor ?? null, numItems: 50 })
    const count =
      args.count + page.page.filter((capture) => !capture.discardedAt).length
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recountActiveVoiceCaptures,
        {
          requestId: request._id,
          generation: args.generation,
          count,
          cursor: page.continueCursor,
        }
      )
      return null
    }
    const latest = await ctx.db.get(request._id)
    if ((latest?.voiceCaptureCountGeneration ?? 0) !== args.generation) {
      if (latest)
        await ctx.scheduler.runAfter(
          0,
          internal.migrations.recountActiveVoiceCaptures,
          {
            requestId: latest._id,
            generation: latest.voiceCaptureCountGeneration ?? 0,
            count: 0,
          }
        )
      return null
    }
    await ctx.db.patch(request._id, { activeVoiceCaptureCount: count })
    return null
  },
})

const invariantIssueValidator = v.object({
  humanId: v.string(),
  code: v.string(),
})

/**
 * Read-only deployment gate for the V1 backfills. Run it page-by-page after
 * migrations; production is ready only when every page returns zero issues.
 */
export const validateV1Invariants = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    checked: v.number(),
    done: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    issues: v.array(invariantIssueValidator),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("contentRequests").paginate({
      cursor: args.cursor ?? null,
      numItems: 50,
    })
    const issues: Array<{ humanId: string; code: string }> = []
    for (const request of page.page) {
      if (
        !request.assigneePrincipalId ||
        request.watcherPrincipalIds === undefined ||
        !request.queueSortKey
      )
        issues.push({ humanId: request.humanId, code: "assignment_fields" })
      if (request.activeVoiceCaptureCount === undefined)
        issues.push({ humanId: request.humanId, code: "voice_capture_count" })

      const [deliverables, targets, projection, jobs] = await Promise.all([
        ctx.db
          .query("deliverables")
          .withIndex("by_request", (index) =>
            index.eq("requestId", request._id)
          )
          .collect(),
        ctx.db
          .query("deliveryTargets")
          .withIndex("by_request", (index) =>
            index.eq("requestId", request._id)
          )
          .collect(),
        ctx.db
          .query("operatorWorkspaceItems")
          .withIndex("by_request", (index) =>
            index.eq("requestId", request._id)
          )
          .unique(),
        ctx.db
          .query("agentJobs")
          .withIndex("by_request", (index) =>
            index.eq("requestId", request._id)
          )
          .collect(),
      ])
      const primaryDeliverables = deliverables.filter(
        (deliverable) =>
          (deliverable.retention ?? "active") === "active" &&
          deliverable.isPrimary
      )
      if (primaryDeliverables.length !== 1)
        issues.push({ humanId: request.humanId, code: "primary_deliverable" })
      const originalTargets = targets.filter(
        (target) =>
          target.retention === "active" &&
          target.isOriginal &&
          target.isRequired
      )
      if (originalTargets.length !== 1)
        issues.push({ humanId: request.humanId, code: "original_target" })
      if (!projection)
        issues.push({ humanId: request.humanId, code: "operator_projection" })

      for (const job of jobs) {
        const claimableAt =
          job.status === "queued"
            ? (job.nextAttemptAt ?? job.createdAt)
            : job.status === "retry_wait"
              ? (job.nextAttemptAt ?? job.updatedAt)
              : job.status === "running"
                ? (job.leaseExpiresAt ?? job.updatedAt)
                : undefined
        const reapableAt =
          job.status === "running" && job.attempts >= job.maxAttempts
            ? (job.leaseExpiresAt ?? job.updatedAt)
            : undefined
        if (job.claimableAt !== claimableAt || job.reapableAt !== reapableAt) {
          issues.push({
            humanId: request.humanId,
            code: "agent_job_claimability",
          })
          break
        }
      }
    }
    return {
      checked: page.page.length,
      done: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
      issues,
    }
  },
})
