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
        requestType: undefined,
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
      "request_type",
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
    await backend.mutation(internal.migrations.backfillContentRequestTypes, {})

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

    await backend.run(async (ctx) => {
      await ctx.db.patch(legacy.requestId, {
        normalizedSourceUrl: "https://example.com/community/thread",
      })
    })
    await expect(
      backend.query(internal.migrations.validateV1Invariants, {})
    ).resolves.toMatchObject({
      issues: [
        {
          humanId: legacy.humanId,
          code: "normalized_source_url_collision",
        },
      ],
    })
  })

  it("exempts Expert Interview provenance from Standard Request URL deduplication", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const expert = await backend.mutation(api.expertInterviews.create, {
      title: "Expert source provenance",
      origin: "manual",
      source: { url: "https://example.com/expert-source?utm_source=legacy" },
      brief: {
        topic: "Delayed closing recovery",
        summary: "A practitioner interview about recovery sequencing.",
        audience: "Ontario borrowers",
        framing: "insider_knowledge",
        fairlendPosture: "Educational and evidence-led.",
        founderContribution: "Explain the recovery sequence.",
      },
      gaps: [
        {
          id: "gap-recovery",
          kind: "reality_on_the_ground",
          title: "First-hour recovery sequence",
          existingCoverage: "Published guidance covers ordinary closings.",
          whyItFallsShort: "It omits recovery sequencing.",
          expertOpportunity: "Capture the practitioner sequence.",
          citations: [
            {
              label: "Published closing guide",
              url: "https://example.com/closing-guide",
              supports: "The ordinary process that omits recovery.",
            },
          ],
        },
      ],
      questions: [
        {
          id: "question-first-call",
          question: "Who do you call first?",
          motivation: "Expose the recovery sequence.",
          gapIds: ["gap-recovery"],
        },
      ],
      correlationId: "create-expert-source-provenance",
    })
    await backend.run((ctx) =>
      ctx.db.patch(expert.request.requestId, {
        normalizedSourceUrl: "https://example.com/expert-source",
      })
    )

    await expect(
      backend.mutation(internal.migrations.backfillNormalizedSourceUrls, {})
    ).resolves.toMatchObject({ migrated: 1, done: true })
    const stored = await backend.run((ctx) =>
      ctx.db.get(expert.request.requestId)
    )
    expect(stored?.normalizedSourceUrl).toBeUndefined()
    const validation = await backend.query(
      internal.migrations.validateV1Invariants,
      {}
    )
    expect(
      validation.issues.filter((issue) => issue.humanId === expert.humanId)
    ).toEqual([])

    const standard = await backend.mutation(api.contentRequests.createManual, {
      title: "Standard request for the same source",
      origin: "manual",
      source: { url: "https://example.com/expert-source" },
      correlationId: "create-standard-same-expert-source",
    })
    expect(standard.humanId).not.toBe(expert.humanId)
    expect(standard.requestType).toBe("standard")
  })

  it("ignores a legacy Expert package when backfilling an earlier Standard URL", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    const principal = await backend.mutation(api.principals.syncCurrent)
    const standard = await backend.mutation(api.contentRequests.createManual, {
      title: "Earlier legacy Standard request",
      origin: "manual",
      correlationId: "earlier-legacy-standard",
    })
    const sourceUrl = "https://example.com/shared-legacy-source"
    const sourceSnapshotId = await backend.run((ctx) =>
      ctx.db.insert("sourceSnapshots", {
        organizationId: "org_fairlend",
        requestId: standard.requestId,
        url: sourceUrl,
        capturedByPrincipalId: principal.principalId,
        capturedAt: 1,
      })
    )
    await backend.run((ctx) =>
      ctx.db.patch(standard.requestId, {
        sourceSnapshotId,
        normalizedSourceUrl: undefined,
      })
    )
    const expert = await backend.mutation(api.expertInterviews.create, {
      title: "Later legacy Expert request",
      origin: "manual",
      source: { url: sourceUrl },
      brief: {
        topic: "Legacy source classification",
        summary: "Preserve a practitioner package independently.",
        audience: "Ontario borrowers",
        framing: "insider_knowledge",
        fairlendPosture: "Educational and evidence-led.",
        founderContribution: "Explain the practical sequence.",
      },
      gaps: [
        {
          id: "gap-legacy",
          kind: "reality_on_the_ground",
          title: "Legacy practitioner detail",
          existingCoverage: "Published guidance covers the baseline.",
          whyItFallsShort: "It omits practitioner detail.",
          expertOpportunity: "Capture the real sequence.",
          citations: [
            {
              label: "Published guide",
              url: "https://example.com/published-guide",
              supports: "The baseline coverage.",
            },
          ],
        },
      ],
      questions: [
        {
          id: "question-legacy",
          question: "What happens in practice?",
          motivation: "Capture the missing sequence.",
          gapIds: ["gap-legacy"],
        },
      ],
      correlationId: "later-legacy-expert",
    })
    await backend.run((ctx) =>
      ctx.db.patch(expert.request.requestId, {
        requestType: "standard",
        normalizedSourceUrl: sourceUrl,
      })
    )

    const before = await backend.query(
      internal.migrations.validateV1Invariants,
      {}
    )
    expect(before.issues).toContainEqual({
      humanId: expert.humanId,
      code: "request_type",
    })
    await backend.mutation(internal.migrations.backfillNormalizedSourceUrls, {})
    await backend.mutation(internal.migrations.backfillContentRequestTypes, {})
    const state = await backend.run(async (ctx) => ({
      standard: await ctx.db.get(standard.requestId),
      expert: await ctx.db.get(expert.request.requestId),
      conflicts: await ctx.db.query("migrationConflicts").collect(),
    }))
    expect(state.standard?.normalizedSourceUrl).toBe(sourceUrl)
    expect(state.standard?.requestType).toBe("standard")
    expect(state.expert?.normalizedSourceUrl).toBeUndefined()
    expect(state.expert?.requestType).toBe("expert_interview")
    expect(state.conflicts).toEqual([])
  })

  it("idempotently reconstructs completed founder promotions and refreshes their projection", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const founder = workspace.withIdentity({
      ...operatorIdentity,
      subject: "migration-founder",
      role: "founder",
      jti: "migration-founder-session",
    })
    await operator.mutation(api.principals.syncCurrent)
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    const created = await operator.mutation(api.contentRequests.createManual, {
      title: "Previously promoted founder request",
      origin: "manual",
      correlationId: "create-legacy-promotion",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: created.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      correlationId: "assign-legacy-promotion",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: created.humanId,
    })
    if (!primary) throw new Error("Primary deliverable missing")
    await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Prepared response",
      correlationId: "version-legacy-promotion",
    })
    await operator.mutation(api.deliverables.createDerivative, {
      humanId: created.humanId,
      kind: "blog_article",
      name: "Blog article",
      correlationId: "derivative-legacy-promotion",
    })

    await expect(
      operator.query(internal.migrations.validateV1Invariants, {})
    ).resolves.toMatchObject({
      issues: [{ humanId: created.humanId, code: "founder_handoff" }],
    })

    await expect(
      operator.mutation(internal.migrations.backfillFounderHandoffs, {})
    ).resolves.toEqual({ migrated: 1, done: true })
    await expect(
      operator.mutation(internal.migrations.backfillFounderHandoffs, {})
    ).resolves.toEqual({ migrated: 0, done: true })

    await expect(
      operator.query(api.founderHandoffs.getCurrent, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject({
      recipient: { principalId: founderPrincipal.principalId },
      selectedFormats: ["original_response", "blog_article"],
      stage: "ready",
      emailStatus: null,
    })
    await expect(
      operator.query(internal.migrations.validateV1Invariants, {})
    ).resolves.toMatchObject({ issues: [] })
  })
})
