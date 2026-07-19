// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "migration-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "migration-operator-session",
}

describe("V1 migration deployment gate", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("detects legacy rows and proves every V1 backfill restores its invariant", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    const principal = await backend.mutation(api.principals.syncCurrent)
    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Legacy migration fixture",
      origin: "manual",
      source: {
        url: "https://Example.com/community/thread?utm_source=legacy",
      },
      correlationId: "create-migration-fixture",
    })

    await backend.run(async (ctx) => {
      const request = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", created.humanId)
        )
        .unique()
      if (!request) throw new Error("Migration fixture missing")
      for (const target of await ctx.db
        .query("deliveryTargets")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect())
        await ctx.db.delete(target._id)
      for (const deliverable of await ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect())
        await ctx.db.delete(deliverable._id)
      const projection = await ctx.db
        .query("operatorWorkspaceItems")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .unique()
      if (projection) await ctx.db.delete(projection._id)
      await ctx.db.patch(request._id, {
        assigneePrincipalId: undefined,
        watcherPrincipalIds: undefined,
        queueSortKey: undefined,
        activeVoiceCaptureCount: undefined,
        normalizedSourceUrl: undefined,
      })
      const documentId = await ctx.db.insert("founderInputDocuments", {
        organizationId: "org_fairlend",
        requestId: request._id,
        founderPrincipalId: principal.principalId,
        text: "Legacy founder input",
        revision: 1,
        hasMeaningfulDraft: true,
        createdAt: 100,
        updatedAt: 100,
      })
      const founderVersionId = await ctx.db.insert("founderInputVersions", {
        organizationId: "org_fairlend",
        requestId: request._id,
        documentId,
        text: "Legacy founder input",
        heads: ["legacy-head"],
        revision: 1,
        actorPrincipalId: principal.principalId,
        actorSubject: "migration-operator",
        correlationId: "legacy-founder-version",
        occurredAt: 100,
      })
      await ctx.db.insert("agentJobs", {
        organizationId: "org_fairlend",
        requestId: request._id,
        requestTitle: request.title,
        type: "primary_response",
        status: "queued",
        founderVersionId,
        contextSnapshot: [],
        attempts: 0,
        maxAttempts: 3,
        leaseGeneration: 0,
        createdAt: 200,
        updatedAt: 200,
      })
    })

    const before = await backend.query(
      internal.migrations.validateV1Invariants,
      {}
    )
    expect(before.issues.map((issue) => issue.code).sort()).toEqual([
      "agent_job_claimability",
      "assignment_fields",
      "normalized_source_url",
      "operator_projection",
      "original_target",
      "primary_deliverable",
      "voice_capture_count",
    ])

    await backend.mutation(internal.migrations.backfillAssignmentFields, {})
    await backend.mutation(internal.migrations.backfillNormalizedSourceUrls, {})
    await backend.mutation(internal.migrations.backfillPrimaryDeliverables, {})
    await backend.mutation(
      internal.migrations.backfillOriginalDeliveryTargets,
      {}
    )
    await backend.mutation(internal.migrations.backfillAgentJobClaimability, {})
    await backend.mutation(
      internal.migrations.backfillActiveVoiceCaptureCounts,
      {}
    )
    await backend.mutation(internal.migrations.backfillOperatorWorkspace, {})

    await expect(
      backend.query(internal.migrations.validateV1Invariants, {})
    ).resolves.toMatchObject({ checked: 1, done: true, issues: [] })

    await backend.run(async (ctx) => {
      const request = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", created.humanId)
        )
        .unique()
      if (!request) throw new Error("Migration fixture missing")
      await ctx.db.patch(request._id, { retention: "archived" })
      for (const deliverable of await ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect())
        await ctx.db.patch(deliverable._id, { retention: "archived" })
      for (const target of await ctx.db
        .query("deliveryTargets")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect())
        await ctx.db.patch(target._id, { retention: "archived" })
      for (const job of await ctx.db
        .query("agentJobs")
        .withIndex("by_request", (index) => index.eq("requestId", request._id))
        .collect())
        await ctx.db.patch(job._id, {
          status: "cancelled",
          claimableAt: undefined,
          reapableAt: undefined,
        })
    })
    await expect(
      backend.query(internal.migrations.validateV1Invariants, {})
    ).resolves.toMatchObject({ checked: 1, done: true, issues: [] })
  })

  it("blocks the gate on an unresolved normalized URL collision", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    const principal = await backend.mutation(api.principals.syncCurrent)
    await backend.mutation(api.contentRequests.createManual, {
      title: "Existing canonical opportunity",
      origin: "manual",
      source: { url: "https://example.com/community/thread?utm_source=first" },
      correlationId: "create-existing-canonical",
    })
    const legacy = await backend.mutation(api.contentRequests.createManual, {
      title: "Legacy colliding opportunity",
      origin: "manual",
      correlationId: "create-legacy-collision",
    })
    await backend.run(async (ctx) => {
      const sourceSnapshotId = await ctx.db.insert("sourceSnapshots", {
        organizationId: "org_fairlend",
        requestId: legacy.requestId,
        url: "https://example.com/community/thread?utm_campaign=legacy",
        captureKind: "manual_supplemental",
        capturedByPrincipalId: principal.principalId,
        capturedAt: 100,
      })
      await ctx.db.patch(legacy.requestId, {
        sourceSnapshotId,
        normalizedSourceUrl: undefined,
      })
    })

    await backend.mutation(internal.migrations.backfillNormalizedSourceUrls, {})
    const validation = await backend.query(
      internal.migrations.validateV1Invariants,
      {}
    )
    expect(validation.issues).toEqual([
      {
        humanId: legacy.humanId,
        code: "normalized_source_url_collision",
      },
    ])
  })
})
