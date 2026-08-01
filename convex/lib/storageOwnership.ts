import { ConvexError } from "convex/values"

import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

export type StorageOwnerKind = "guest_evidence" | "founder_voice"

export async function claimStorageObject(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  ownerKind: StorageOwnerKind,
  ownerId: string
) {
  const existingClaim = await ctx.db
    .query("storageObjectClaims")
    .withIndex("by_storage", (index) => index.eq("storageId", storageId))
    .unique()
  if (existingClaim) {
    if (
      existingClaim.ownerKind !== ownerKind ||
      existingClaim.ownerId !== ownerId ||
      existingClaim.deletedAt
    )
      throw new ConvexError({ code: "STORAGE_OBJECT_ALREADY_BOUND" })
    return existingClaim._id
  }

  // Historical rows predate the ownership registry. These checks make the
  // registry safe to introduce without allowing an old object to be rebound.
  const [guestAsset, founderCapture] = await Promise.all([
    ctx.db
      .query("responseAssets")
      .withIndex("by_storage", (index) => index.eq("storageId", storageId))
      .first(),
    ctx.db
      .query("founderVoiceCaptures")
      .withIndex("by_storage", (index) => index.eq("storageId", storageId))
      .first(),
  ])
  if (
    (guestAsset &&
      (ownerKind !== "guest_evidence" || guestAsset._id !== ownerId)) ||
    (founderCapture &&
      (ownerKind !== "founder_voice" || founderCapture._id !== ownerId))
  )
    throw new ConvexError({ code: "STORAGE_OBJECT_ALREADY_BOUND" })

  return ctx.db.insert("storageObjectClaims", {
    storageId,
    ownerKind,
    ownerId,
    claimedAt: Date.now(),
  })
}

export async function markStorageObjectDeleted(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  ownerKind: StorageOwnerKind,
  ownerId: string
) {
  const claim = await ctx.db
    .query("storageObjectClaims")
    .withIndex("by_storage", (index) => index.eq("storageId", storageId))
    .unique()
  if (
    !claim ||
    claim.ownerKind !== ownerKind ||
    claim.ownerId !== ownerId ||
    claim.deletedAt
  )
    throw new ConvexError({ code: "STORAGE_OWNERSHIP_REQUIRED" })
  await ctx.db.patch(claim._id, { deletedAt: Date.now() })
}

export function storageOwnerId(
  document: Pick<Doc<"responseAssets"> | Doc<"founderVoiceCaptures">, "_id">
) {
  return String(document._id)
}
