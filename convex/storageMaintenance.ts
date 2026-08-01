import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"

const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1_000
const STORAGE_SWEEP_PAGE_SIZE = 100

export const reapOrphanedStorageObjects = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    cutoff: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    deleted: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - ORPHAN_GRACE_MS
    const page = await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: STORAGE_SWEEP_PAGE_SIZE,
      })
    let deleted = 0

    for (const storedObject of page.page) {
      if (storedObject._creationTime > cutoff) continue
      const [claim, guestAsset, founderCapture] = await Promise.all([
        ctx.db
          .query("storageObjectClaims")
          .withIndex("by_storage", (index) =>
            index.eq("storageId", storedObject._id)
          )
          .unique(),
        ctx.db
          .query("responseAssets")
          .withIndex("by_storage", (index) =>
            index.eq("storageId", storedObject._id)
          )
          .first(),
        ctx.db
          .query("founderVoiceCaptures")
          .withIndex("by_storage", (index) =>
            index.eq("storageId", storedObject._id)
          )
          .first(),
      ])
      if ((claim && !claim.deletedAt) || guestAsset || founderCapture) continue
      await ctx.storage.delete(storedObject._id)
      deleted += 1
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.storageMaintenance.reapOrphanedStorageObjects,
        {
          cursor: page.continueCursor,
          cutoff,
        }
      )
    }

    return {
      scanned: page.page.length,
      deleted,
      isDone: page.isDone,
    }
  },
})
