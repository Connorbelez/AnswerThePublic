import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
import { requestQueueSortKey } from "./lib/requestOrdering"

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
