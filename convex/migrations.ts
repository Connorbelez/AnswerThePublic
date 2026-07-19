import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
import { requestQueueSortKey } from "./lib/requestOrdering"
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
