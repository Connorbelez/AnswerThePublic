import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
import { requestQueueSortKey } from "./lib/requestOrdering"
import { lifecycleForPrimary } from "./lib/deliverableLifecycle"
import { normalizeSourceUrl } from "../shared/url-normalization"

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
