// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"

import { internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

describe("storage ownership maintenance", () => {
  it("reaps abandoned uploads while preserving actively claimed objects", async () => {
    const workspace = convexTest(schema, modules)
    const { abandoned, claimed } = await workspace.run(async (ctx) => {
      const abandoned = await ctx.storage.store(
        new Blob(["abandoned"], { type: "text/plain" })
      )
      const claimed = await ctx.storage.store(
        new Blob(["claimed"], { type: "text/plain" })
      )
      await ctx.db.insert("storageObjectClaims", {
        storageId: claimed,
        ownerKind: "guest_evidence",
        ownerId: "asset-owned-by-a-live-aggregate",
        claimedAt: Date.now(),
      })
      return { abandoned, claimed }
    })

    const result = await workspace.mutation(
      internal.storageMaintenance.reapOrphanedStorageObjects,
      { cutoff: Date.now() + 1_000 }
    )

    expect(result).toMatchObject({ deleted: 1, isDone: true })
    expect(
      await workspace.run((ctx) => ctx.db.system.get(abandoned))
    ).toBeNull()
    expect(
      await workspace.run((ctx) => ctx.db.system.get(claimed))
    ).not.toBeNull()
  })

  it("finishes deletion for objects whose ownership tombstone is durable", async () => {
    const workspace = convexTest(schema, modules)
    const storageId = await workspace.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["delete-me"], { type: "text/plain" })
      )
      await ctx.db.insert("storageObjectClaims", {
        storageId,
        ownerKind: "guest_evidence",
        ownerId: "discarded-asset",
        claimedAt: Date.now() - 10_000,
        deletedAt: Date.now() - 5_000,
      })
      return storageId
    })

    const result = await workspace.mutation(
      internal.storageMaintenance.reapOrphanedStorageObjects,
      { cutoff: Date.now() + 1_000 }
    )

    expect(result.deleted).toBe(1)
    expect(
      await workspace.run((ctx) => ctx.db.system.get(storageId))
    ).toBeNull()
  })
})
