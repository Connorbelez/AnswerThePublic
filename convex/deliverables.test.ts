// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = {
  subject: "operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "operator-session",
}

describe("deliverable versions and promotion", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("keeps promoted versions stable until explicit promotion and reassigns primary atomically", async () => {
    const workspace = convexTest(schema, modules).withIdentity(identity)
    await workspace.mutation(api.principals.syncCurrent)
    const request = await workspace.mutation(api.contentRequests.createManual, {
      title: "Explain mortgage portability",
      origin: "manual",
      correlationId: "create-deliverable-request",
    })
    const initial = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    expect(initial).toHaveLength(1)
    expect(initial[0]).toMatchObject({ isPrimary: true, versions: [] })

    const first = await workspace.mutation(api.deliverables.createVersion, {
      deliverableId: initial[0].deliverableId,
      body: "First ready response",
      correlationId: "primary-version-1",
    })
    expect(first.currentCandidateVersionId).toBe(first.promotedVersionId)
    const firstPromoted = first.promotedVersionId
    const regenerated = await workspace.mutation(
      api.deliverables.createVersion,
      {
        deliverableId: first.deliverableId,
        body: "Regenerated candidate",
        changeSummary: "Tighter opening",
        correlationId: "primary-version-2",
      }
    )
    expect(regenerated.currentCandidateVersionId).not.toBe(firstPromoted)
    expect(regenerated.promotedVersionId).toBe(firstPromoted)
    expect(regenerated.versions.map((version) => version.body)).toEqual([
      "Regenerated candidate",
      "First ready response",
    ])

    const promoted = await workspace.mutation(api.deliverables.promote, {
      deliverableId: regenerated.deliverableId,
      versionId: regenerated.currentCandidateVersionId!,
      expectedPromotedVersionId: firstPromoted,
      correlationId: "promote-version-2",
    })
    expect(promoted.outcome).toBe("applied")
    expect(promoted.deliverable.promotedVersionId).toBe(
      regenerated.currentCandidateVersionId
    )
    const derivative = await workspace.mutation(
      api.deliverables.createDerivative,
      {
        humanId: request.humanId,
        kind: "linkedin_post",
        name: "LinkedIn post",
        body: "A concise social derivative",
        correlationId: "create-linkedin",
      }
    )
    expect(derivative).toMatchObject({
      isPrimary: false,
      promotedVersionId: null,
    })

    const reassigned = await workspace.mutation(api.deliverables.setPrimary, {
      humanId: request.humanId,
      deliverableId: derivative.deliverableId,
      expectedPrimaryDeliverableId: initial[0].deliverableId,
      correlationId: "reassign-primary",
    })
    expect(reassigned.outcome).toBe("applied")
    expect(
      reassigned.deliverables.filter((deliverable) => deliverable.isPrimary)
    ).toEqual([
      expect.objectContaining({ deliverableId: derivative.deliverableId }),
    ])
    const evidence = await workspace.run(async (ctx) => ({
      versions: await ctx.db.query("deliverableVersions").collect(),
      audit: await ctx.db.query("auditEvents").collect(),
      promotions: await ctx.db.query("deliverablePromotionEvents").collect(),
      primaryEvents: await ctx.db.query("primaryDeliverableEvents").collect(),
      savedRequest: await ctx.db.get(request.requestId),
    }))
    expect(evidence.versions).toHaveLength(3)
    expect(evidence.promotions).toHaveLength(2)
    expect(evidence.savedRequest?.lifecycle).toBe("pending")
    expect(evidence.primaryEvents).toEqual([
      expect.objectContaining({
        previousDeliverableId: initial[0].deliverableId,
        newDeliverableId: derivative.deliverableId,
      }),
    ])
    expect(evidence.audit.map((event) => event.operation)).toEqual(
      expect.arrayContaining([
        "deliverable.version_created",
        "deliverable.promoted",
        "deliverable.primary_reassigned",
      ])
    )
  })

  it("replays retried writes without duplicating deliverables, versions, or audit", async () => {
    const workspace = convexTest(schema, modules).withIdentity(identity)
    await workspace.mutation(api.principals.syncCurrent)
    const request = await workspace.mutation(api.contentRequests.createManual, {
      title: "Explain a mortgage renewal",
      origin: "manual",
      correlationId: "create-idempotent-request",
    })
    const [primary] = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const derivativeInput = {
      humanId: request.humanId,
      kind: "email",
      name: "Email answer",
      body: "Initial email",
      correlationId: "stable-derivative",
    }
    const derivative = await workspace.mutation(
      api.deliverables.createDerivative,
      derivativeInput
    )
    const derivativeReplay = await workspace.mutation(
      api.deliverables.createDerivative,
      derivativeInput
    )
    expect(derivativeReplay.deliverableId).toBe(derivative.deliverableId)
    await expect(
      workspace.mutation(api.deliverables.createDerivative, {
        ...derivativeInput,
        name: "Different payload",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })

    const versionInput = {
      deliverableId: derivative.deliverableId,
      body: "Revised email",
      correlationId: "stable-version",
    }
    const version = await workspace.mutation(
      api.deliverables.createVersion,
      versionInput
    )
    const versionReplay = await workspace.mutation(
      api.deliverables.createVersion,
      versionInput
    )
    expect(versionReplay.versions).toEqual(version.versions)

    const primaryInput = {
      humanId: request.humanId,
      deliverableId: derivative.deliverableId,
      expectedPrimaryDeliverableId: primary.deliverableId,
      correlationId: "stable-primary",
    }
    await workspace.mutation(api.deliverables.setPrimary, primaryInput)
    await workspace.mutation(api.deliverables.setPrimary, primaryInput)
    await workspace.run((ctx) =>
      ctx.db.patch(request.requestId, { lifecycle: "responded" })
    )
    await expect(
      workspace.mutation(api.deliverables.setPrimary, primaryInput)
    ).resolves.toMatchObject({ outcome: "applied" })
    const evidence = await workspace.run(async (ctx) => ({
      deliverables: await ctx.db.query("deliverables").collect(),
      versions: await ctx.db.query("deliverableVersions").collect(),
      operations: await ctx.db.query("deliverableOperations").collect(),
      primaryEvents: await ctx.db.query("primaryDeliverableEvents").collect(),
    }))
    expect(evidence.deliverables).toHaveLength(2)
    expect(evidence.versions).toHaveLength(2)
    expect(evidence.operations).toHaveLength(3)
    expect(evidence.primaryEvents).toHaveLength(1)
  })

  it("persists stale singleton changes for explicit resolution", async () => {
    const workspace = convexTest(schema, modules).withIdentity(identity)
    await workspace.mutation(api.principals.syncCurrent)
    const request = await workspace.mutation(api.contentRequests.createManual, {
      title: "Compare variable and fixed rates",
      origin: "manual",
      correlationId: "create-conflict-request",
    })
    const [primary] = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const first = await workspace.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "First",
      correlationId: "conflict-version-1",
    })
    const second = await workspace.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Second",
      correlationId: "conflict-version-2",
    })
    const third = await workspace.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Third",
      correlationId: "conflict-version-3",
    })
    const applied = await workspace.mutation(api.deliverables.promote, {
      deliverableId: primary.deliverableId,
      versionId: second.currentCandidateVersionId!,
      expectedPromotedVersionId: first.promotedVersionId,
      correlationId: "fresh-promotion",
    })
    expect(applied.outcome).toBe("applied")
    const stale = await workspace.mutation(api.deliverables.promote, {
      deliverableId: primary.deliverableId,
      versionId: third.currentCandidateVersionId!,
      expectedPromotedVersionId: first.promotedVersionId,
      correlationId: "stale-promotion",
    })
    expect(stale).toMatchObject({
      outcome: "attention_required",
      conflict: { field: "promotedVersionId" },
    })
    expect(stale.deliverable.promotedVersionId).toBe(
      second.currentCandidateVersionId
    )
    const replay = await workspace.mutation(api.deliverables.promote, {
      deliverableId: primary.deliverableId,
      versionId: third.currentCandidateVersionId!,
      expectedPromotedVersionId: first.promotedVersionId,
      correlationId: "stale-promotion",
    })
    expect(replay.conflict?.conflictId).toBe(stale.conflict?.conflictId)

    const derivativeOne = await workspace.mutation(
      api.deliverables.createDerivative,
      {
        humanId: request.humanId,
        kind: "short",
        name: "Short one",
        correlationId: "derivative-one",
      }
    )
    const derivativeTwo = await workspace.mutation(
      api.deliverables.createDerivative,
      {
        humanId: request.humanId,
        kind: "short",
        name: "Short two",
        correlationId: "derivative-two",
      }
    )
    await workspace.mutation(api.deliverables.setPrimary, {
      humanId: request.humanId,
      deliverableId: derivativeOne.deliverableId,
      expectedPrimaryDeliverableId: primary.deliverableId,
      correlationId: "fresh-primary",
    })
    const stalePrimary = await workspace.mutation(api.deliverables.setPrimary, {
      humanId: request.humanId,
      deliverableId: derivativeTwo.deliverableId,
      expectedPrimaryDeliverableId: primary.deliverableId,
      correlationId: "stale-primary",
    })
    expect(stalePrimary).toMatchObject({
      outcome: "attention_required",
      conflict: { field: "primaryDeliverableId" },
    })
    expect(
      stalePrimary.deliverables.find((deliverable) => deliverable.isPrimary)
        ?.deliverableId
    ).toBe(derivativeOne.deliverableId)
    const conflicts = await workspace.query(api.semanticConflicts.listOpen, {
      humanId: request.humanId,
    })
    expect(conflicts.map((conflict) => conflict.field).sort()).toEqual([
      "primaryDeliverableId",
      "promotedVersionId",
    ])
    const promotionConflict = conflicts.find(
      (conflict) => conflict.field === "promotedVersionId"
    )!
    const fourth = await workspace.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Fourth",
      correlationId: "conflict-version-4",
    })
    await workspace.mutation(api.deliverables.promote, {
      deliverableId: primary.deliverableId,
      versionId: fourth.currentCandidateVersionId!,
      expectedPromotedVersionId: second.currentCandidateVersionId,
      correlationId: "later-promotion",
    })
    const rebasedPromotion = await workspace.mutation(
      api.semanticConflicts.resolve,
      {
        conflictId: promotionConflict.conflictId,
        selectedValue: promotionConflict.proposedValue,
        correlationId: "resolve-stale-promotion",
      }
    )
    expect(rebasedPromotion).toMatchObject({
      status: "open",
      currentValue: fourth.currentCandidateVersionId,
      proposedValue: promotionConflict.proposedValue,
    })
    const resolvedPromotion = await workspace.mutation(
      api.semanticConflicts.resolve,
      {
        conflictId: rebasedPromotion.conflictId,
        selectedValue: rebasedPromotion.proposedValue,
        correlationId: "resolve-rebased-promotion",
      }
    )
    expect(resolvedPromotion).toMatchObject({
      status: "resolved",
      resolvedValue: rebasedPromotion.proposedValue,
    })
    const primaryConflict = conflicts.find(
      (conflict) => conflict.field === "primaryDeliverableId"
    )!
    await workspace.run((ctx) =>
      ctx.db.patch(derivativeTwo.deliverableId, { retention: "archived" })
    )
    await expect(
      workspace.mutation(api.semanticConflicts.resolve, {
        conflictId: primaryConflict.conflictId,
        selectedValue: primaryConflict.proposedValue,
        correlationId: "blocked-archived-resolution",
      })
    ).rejects.toMatchObject({ data: { code: "DELIVERABLE_ARCHIVED" } })
    await workspace.run((ctx) =>
      ctx.db.patch(derivativeTwo.deliverableId, { retention: "active" })
    )
    await workspace.run((ctx) =>
      ctx.db.patch(request.requestId, { lifecycle: "responded" })
    )
    await expect(
      workspace.mutation(api.semanticConflicts.resolve, {
        conflictId: primaryConflict.conflictId,
        selectedValue: primaryConflict.proposedValue,
        correlationId: "blocked-post-delivery-resolution",
      })
    ).rejects.toMatchObject({ data: { code: "DELIVERED_PRIMARY_LOCKED" } })
    await workspace.run((ctx) =>
      ctx.db.patch(request.requestId, { lifecycle: "ready_to_respond" })
    )
    await workspace.mutation(api.semanticConflicts.resolve, {
      conflictId: primaryConflict.conflictId,
      selectedValue: primaryConflict.proposedValue,
      correlationId: "resolve-stale-primary",
    })
    const resolvedDeliverables = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    expect(
      resolvedDeliverables.find((deliverable) => deliverable.isPrimary)
        ?.deliverableId
    ).toBe(derivativeTwo.deliverableId)
    expect(
      await workspace.query(api.semanticConflicts.listOpen, {
        humanId: request.humanId,
      })
    ).toEqual([])
  })

  it.each(["pending", "in_progress"] as const)(
    "advances a %s request when a promoted derivative becomes primary",
    async (lifecycle) => {
      const workspace = convexTest(schema, modules).withIdentity(identity)
      await workspace.mutation(api.principals.syncCurrent)
      const request = await workspace.mutation(
        api.contentRequests.createManual,
        {
          title: `Promoted derivative from ${lifecycle}`,
          origin: "manual",
          correlationId: `create-${lifecycle}`,
        }
      )
      await workspace.run((ctx) =>
        ctx.db.patch(request.requestId, { lifecycle })
      )
      const [primary] = await workspace.query(api.deliverables.list, {
        humanId: request.humanId,
      })
      const derivative = await workspace.mutation(
        api.deliverables.createDerivative,
        {
          humanId: request.humanId,
          kind: "article",
          name: "Article",
          body: "Ready article",
          correlationId: `derivative-${lifecycle}`,
        }
      )
      await workspace.mutation(api.deliverables.promote, {
        deliverableId: derivative.deliverableId,
        versionId: derivative.currentCandidateVersionId!,
        expectedPromotedVersionId: null,
        correlationId: `promote-derivative-${lifecycle}`,
      })
      await workspace.mutation(api.deliverables.setPrimary, {
        humanId: request.humanId,
        deliverableId: derivative.deliverableId,
        expectedPrimaryDeliverableId: primary.deliverableId,
        correlationId: `select-derivative-${lifecycle}`,
      })
      const saved = await workspace.run((ctx) => ctx.db.get(request.requestId))
      expect(saved?.lifecycle).toBe("ready_to_respond")
    }
  )

  it("backfills exactly one primary response for legacy requests", async () => {
    const workspace = convexTest(schema, modules).withIdentity(identity)
    const principal = await workspace.mutation(api.principals.syncCurrent)
    const requestId = await workspace.run((ctx) =>
      ctx.db.insert("contentRequests", {
        organizationId: "org_fairlend",
        humanId: "CR-LEGACY",
        title: "Legacy request",
        normalizedTitle: "legacy request",
        searchText: "cr-legacy legacy request",
        aliases: [],
        origin: "manual",
        priority: "critical",
        lifecycle: "pending",
        disposition: "active",
        retention: "active",
        assigneePrincipalId: principal.principalId,
        watcherPrincipalIds: [],
        createdByPrincipalId: principal.principalId,
        aggregateVersion: 1,
        queueSortKey: "0:0:legacy",
        createdAt: 1,
        updatedAt: 1,
      })
    )
    const first = await workspace.mutation(
      internal.migrations.backfillPrimaryDeliverables,
      {}
    )
    const second = await workspace.mutation(
      internal.migrations.backfillPrimaryDeliverables,
      {}
    )
    const saved = await workspace.run((ctx) =>
      ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", requestId))
        .collect()
    )
    expect(first.migrated).toBe(1)
    expect(second.migrated).toBe(0)
    expect(saved).toEqual([expect.objectContaining({ isPrimary: true })])
  })

  it("never selects an archived deliverable as the active primary", async () => {
    const workspace = convexTest(schema, modules).withIdentity(identity)
    await workspace.mutation(api.principals.syncCurrent)
    const request = await workspace.mutation(api.contentRequests.createManual, {
      title: "Archived derivative",
      origin: "manual",
      correlationId: "create-archived-request",
    })
    const [primary] = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const derivative = await workspace.mutation(
      api.deliverables.createDerivative,
      {
        humanId: request.humanId,
        kind: "archive_test",
        name: "Archived output",
        body: "Archived version",
        correlationId: "create-archived-derivative",
      }
    )
    await workspace.run((ctx) =>
      ctx.db.patch(derivative.deliverableId, { retention: "archived" })
    )
    await expect(
      workspace.mutation(api.deliverables.createVersion, {
        deliverableId: derivative.deliverableId,
        body: "Forbidden archived candidate",
        correlationId: "version-on-archived",
      })
    ).rejects.toMatchObject({ data: { code: "DELIVERABLE_ARCHIVED" } })
    await expect(
      workspace.mutation(api.deliverables.promote, {
        deliverableId: derivative.deliverableId,
        versionId: derivative.currentCandidateVersionId!,
        expectedPromotedVersionId: null,
        correlationId: "promote-on-archived",
      })
    ).rejects.toMatchObject({ data: { code: "DELIVERABLE_ARCHIVED" } })
    await expect(
      workspace.mutation(api.deliverables.setPrimary, {
        humanId: request.humanId,
        deliverableId: derivative.deliverableId,
        expectedPrimaryDeliverableId: primary.deliverableId,
        correlationId: "select-archived",
      })
    ).rejects.toMatchObject({ data: { code: "DELIVERABLE_ARCHIVED" } })
    const visible = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    expect(visible.filter((deliverable) => deliverable.isPrimary)).toEqual([
      expect.objectContaining({ deliverableId: primary.deliverableId }),
    ])
    await workspace.run(async (ctx) => {
      await ctx.db.patch(primary.deliverableId, { retention: "archived" })
      await ctx.db.patch(request.requestId, { lifecycle: "ready_to_respond" })
      return null
    })
    await workspace.mutation(
      internal.migrations.backfillPrimaryDeliverables,
      {}
    )
    const migrated = await workspace.run((ctx) =>
      ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) =>
          index.eq("requestId", request.requestId)
        )
        .collect()
    )
    expect(
      migrated.filter(
        (deliverable) =>
          (deliverable.retention ?? "active") === "active" &&
          deliverable.isPrimary
      )
    ).toHaveLength(1)
    expect(
      migrated.filter(
        (deliverable) =>
          deliverable.retention === "archived" && deliverable.isPrimary
      )
    ).toEqual([])
    const repairedRequest = await workspace.run((ctx) =>
      ctx.db.get(request.requestId)
    )
    expect(repairedRequest?.lifecycle).toBe("pending")
  })

  it("projects ready lifecycle when migration selects a promoted active primary", async () => {
    const workspace = convexTest(schema, modules).withIdentity(identity)
    await workspace.mutation(api.principals.syncCurrent)
    const request = await workspace.mutation(api.contentRequests.createManual, {
      title: "Promoted migration candidate",
      origin: "manual",
      correlationId: "create-promoted-migration",
    })
    const [oldPrimary] = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const replacement = await workspace.mutation(
      api.deliverables.createDerivative,
      {
        humanId: request.humanId,
        kind: "replacement",
        name: "Replacement",
        body: "Promoted replacement",
        correlationId: "create-promoted-replacement",
      }
    )
    await workspace.mutation(api.deliverables.promote, {
      deliverableId: replacement.deliverableId,
      versionId: replacement.currentCandidateVersionId!,
      expectedPromotedVersionId: null,
      correlationId: "promote-replacement",
    })
    await workspace.run((ctx) =>
      ctx.db.patch(oldPrimary.deliverableId, { retention: "archived" })
    )
    await workspace.mutation(
      internal.migrations.backfillPrimaryDeliverables,
      {}
    )
    const savedRequest = await workspace.run((ctx) =>
      ctx.db.get(request.requestId)
    )
    expect(savedRequest?.lifecycle).toBe("ready_to_respond")
    const [visiblePrimary] = await workspace.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    expect(visiblePrimary).toMatchObject({
      deliverableId: replacement.deliverableId,
      isPrimary: true,
    })
  })
})
