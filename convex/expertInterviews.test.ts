// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "expert-interview-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "expert-interview-operator-session",
}

const interviewPackage = {
  brief: {
    topic: "Bridge financing when a bank closing is delayed",
    summary: "A practical Ontario guide to recovering a time-sensitive deal.",
    audience: "Ontario mortgage brokers and borrowers",
    framing: "insider_knowledge" as const,
    fairlendPosture: "Useful first; commercial relevance disclosed.",
    founderContribution: "A real recovery sequence and decision criteria.",
  },
  gaps: [
    {
      id: "gap-second",
      kind: "missing_evidence" as const,
      title: "The missing recovery evidence",
      existingCoverage: "Guides describe standard closing timelines.",
      whyItFallsShort: "They omit what practitioners do after a delay.",
      expertOpportunity: "Document the second-stage recovery decision.",
      citations: [
        {
          label: "Ontario guidance",
          url: "https://example.test/ontario-guidance",
          supports: "Standard disclosure obligations",
        },
      ],
    },
    {
      id: "gap-first",
      kind: "reality_on_the_ground" as const,
      title: "The first hour",
      existingCoverage: "Guides list bridge-loan eligibility.",
      whyItFallsShort: "They do not describe a live closing failure.",
      expertOpportunity: "Explain who gets called first and why.",
      citations: [
        {
          label: "Bridge eligibility guide",
          url: "https://example.test/bridge-eligibility",
          supports: "The published eligibility coverage that omits recovery.",
        },
      ],
    },
  ],
  questions: [
    {
      id: "q-second",
      question: "What decision follows confirmation of the shortfall?",
      motivation: "Capture the second-stage recovery decision.",
      gapIds: ["gap-second"],
    },
    {
      id: "q-first",
      question: "What do you do in the first hour after the bank slips?",
      motivation: "Capture the recovery sequence missing from indexed guides.",
      gapIds: ["gap-first"],
    },
  ],
  operatorInstructions:
    "Use an Ontario broker's point of view before inference.",
}

describe("first-class Expert Interview persistence", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("keeps Standard Requests as the compatible default", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)

    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "A standard request",
      origin: "manual",
      correlationId: "standard-request-1",
    })

    expect(request.requestType).toBe("standard")
    await expect(
      backend.query(api.expertInterviews.getByHumanId, {
        humanId: request.humanId,
      })
    ).resolves.toBeNull()
  })

  it("creates the complete Expert Interview aggregate atomically, distinctly, and idempotently", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const sharedSourceUrl = "https://example.test/shared-source"
    const standard = await backend.mutation(api.contentRequests.createManual, {
      title: "Existing standard request",
      origin: "manual",
      source: { url: sharedSourceUrl },
      correlationId: "atomic-existing-standard",
    })
    const completePackage = {
      ...interviewPackage,
      gaps: interviewPackage.gaps.map((gap, index) => ({
        ...gap,
        citations:
          gap.citations.length > 0
            ? gap.citations
            : [
                {
                  label: `Supporting source ${index + 1}`,
                  url: `https://example.test/support-${index + 1}`,
                  supports: "The indexed coverage that leaves this gap open.",
                },
              ],
      })),
    }
    const createInput = {
      title: "Atomic expert interview",
      origin: "manual" as const,
      source: {
        question: completePackage.brief.topic,
        url: sharedSourceUrl,
        name: "Expert interview",
        channel: "expert_interview",
      },
      aliases: ["bridge recovery"],
      ...completePackage,
      correlationId: "atomic-expert-create",
    }

    const first = await backend.mutation(
      api.expertInterviews.create,
      createInput
    )
    const replay = await backend.mutation(
      api.expertInterviews.create,
      createInput
    )
    const standardAfter = await backend.query(
      api.contentRequests.getByHumanId,
      { humanId: standard.humanId }
    )
    const expert = await backend.query(api.contentRequests.getByHumanId, {
      humanId: first.humanId,
    })
    const contexts = await backend.query(api.scoutIngestions.listContext, {
      humanId: first.humanId,
    })

    expect(replay).toEqual(first)
    expect(first.humanId).not.toBe(standard.humanId)
    expect(standardAfter?.requestType).toBe("standard")
    expect(expert).toMatchObject({
      requestType: "expert_interview",
      priority: "critical",
      aggregateVersion: 6,
      source: {
        url: sharedSourceUrl,
        channel: "expert_interview",
      },
    })
    expect(first.package.gaps.map(({ id }) => id)).toEqual([
      "gap-second",
      "gap-first",
    ])
    expect(first.gaps).toHaveLength(1)
    expect(first.gaps[0]?.bulletPoints).toHaveLength(2)
    expect(first.gaps[0]?.bulletPoints[0]).toContain("gap-second")
    expect(first.gaps[0]?.bulletPoints[1]).toContain("gap-first")
    expect(first.gaps[0]?.citations).toHaveLength(2)
    expect(first.questions).toHaveLength(1)
    expect(first.questions[0]?.bulletPoints).toHaveLength(2)
    expect(first.questions[0]?.bulletPoints[0]).toContain("q-second")
    expect(first.questions[0]?.bulletPoints[1]).toContain("q-first")
    expect(contexts).toHaveLength(4)
    const sameSourceManual = await backend.mutation(
      api.contentRequests.createManual,
      {
        title: "Another manual request for the shared source",
        origin: "manual",
        source: { url: sharedSourceUrl },
        correlationId: "atomic-shared-source-manual-replay",
      }
    )
    expect(sameSourceManual.humanId).toBe(standard.humanId)

    const updatedPackage = {
      ...completePackage,
      brief: {
        ...completePackage.brief,
        summary: "Updated summary kept in sync with projected context.",
      },
    }
    await backend.mutation(api.expertInterviews.savePackage, {
      humanId: first.humanId,
      ...updatedPackage,
      correlationId: "atomic-expert-package-update",
    })
    const delayedReplay = await backend.mutation(
      api.expertInterviews.create,
      createInput
    )
    expect(delayedReplay.humanId).toBe(first.humanId)
    expect(delayedReplay.package.brief.summary).toBe(
      "Updated summary kept in sync with projected context."
    )
    expect(delayedReplay.brief.bulletPoints).toContain(
      "Summary: Updated summary kept in sync with projected context."
    )
    expect(delayedReplay.request.aggregateVersion).toBe(11)
    const packageAudits = await backend.run(async (ctx) =>
      (await ctx.db.query("auditEvents").collect()).filter(
        (event) =>
          event.requestId === first.request.requestId &&
          event.operation === "expert_interview.package_saved"
      )
    )
    expect(packageAudits).toHaveLength(2)
    expect(
      packageAudits.every((event) =>
        /^[a-f0-9]{64}$/.test(event.inputFingerprint ?? "")
      )
    ).toBe(true)

    await expect(
      backend.mutation(api.expertInterviews.create, {
        ...createInput,
        title: "Changed atomic expert interview",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
  })

  it("rolls back atomic Expert Interview creation when nested evidence is invalid", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const before = await backend.run((ctx) =>
      ctx.db.query("contentRequests").collect()
    )

    await expect(
      backend.mutation(api.expertInterviews.create, {
        title: "Invalid atomic expert interview",
        origin: "manual",
        ...interviewPackage,
        gaps: interviewPackage.gaps.map((gap) => ({
          ...gap,
          citations: [],
        })),
        correlationId: "atomic-expert-invalid",
      })
    ).rejects.toMatchObject({
      data: { code: "VALIDATION_FAILED", field: "gaps.citations" },
    })

    const after = await backend.run((ctx) =>
      ctx.db.query("contentRequests").collect()
    )
    expect(after).toHaveLength(before.length)
  })

  it("keeps a misclassified legacy Expert URL outside manual Standard deduplication", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const sourceUrl = "https://example.test/legacy-expert-only-source"
    const expert = await backend.mutation(api.expertInterviews.create, {
      title: "Legacy misclassified Expert Interview",
      origin: "manual",
      source: { url: sourceUrl },
      ...interviewPackage,
      correlationId: "legacy-misclassified-expert",
    })
    await backend.run((ctx) =>
      ctx.db.patch(expert.request.requestId, {
        requestType: "standard",
        normalizedSourceUrl: sourceUrl,
      })
    )

    const standard = await backend.mutation(api.contentRequests.createManual, {
      title: "Standard request for a legacy Expert source",
      origin: "manual",
      source: { url: sourceUrl },
      correlationId: "standard-after-misclassified-expert",
    })

    expect(standard.humanId).not.toBe(expert.humanId)
    expect(standard.requestType).toBe("standard")
    await expect(
      backend.query(api.contentRequests.list, {})
    ).resolves.toHaveLength(2)
  })

  it("rejects root and derived correlation collisions before writing", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    await backend.mutation(api.contentRequests.createManual, {
      title: "Existing root correlation",
      origin: "manual",
      correlationId: "expert-collision-root",
    })
    const contextRequest = await backend.mutation(
      api.contentRequests.createManual,
      {
        title: "Existing context correlation",
        origin: "manual",
        correlationId: "expert-collision-context-request",
      }
    )
    await backend.mutation(api.scoutIngestions.upsertContext, {
      humanId: contextRequest.humanId,
      kind: "source_summary",
      title: "Existing source summary",
      bulletPoints: ["Already reserved."],
      citations: [],
      correlationId: "expert-collision-derived:brief",
    })
    const before = await backend.run((ctx) =>
      ctx.db.query("expertInterviews").collect()
    )

    await expect(
      backend.mutation(api.expertInterviews.create, {
        title: "Colliding root expert interview",
        origin: "manual",
        ...interviewPackage,
        correlationId: "expert-collision-root",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    await expect(
      backend.mutation(api.expertInterviews.create, {
        title: "Colliding derived expert interview",
        origin: "manual",
        ...interviewPackage,
        correlationId: "expert-collision-derived",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })

    const after = await backend.run((ctx) =>
      ctx.db.query("expertInterviews").collect()
    )
    expect(after).toHaveLength(before.length)
  })

  it("rejects audit-only derived correlation reservations before package writes", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    const principal = await backend.mutation(api.principals.syncCurrent)
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Audit-only collision request",
      origin: "manual",
      correlationId: "audit-only-collision-request",
    })
    await backend.run((ctx) =>
      ctx.db.insert("auditEvents", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        requestHumanId: request.humanId,
        actorPrincipalId: principal.principalId,
        credentialId: operatorIdentity.jti,
        operation: "context.upserted",
        correlationId: "audit-only-package:brief",
        occurredAt: 1,
        afterVersion: 2,
        inputFingerprint: "legacy-audit-reservation",
      })
    )

    await expect(
      backend.mutation(api.expertInterviews.savePackage, {
        humanId: request.humanId,
        ...interviewPackage,
        correlationId: "audit-only-package",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    await expect(
      backend.query(api.expertInterviews.getByHumanId, {
        humanId: request.humanId,
      })
    ).resolves.toBeNull()
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: request.humanId,
      })
    ).resolves.toMatchObject({ requestType: "standard" })
  })

  it("rejects invalid original-source URLs before atomic creation", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)

    await expect(
      backend.mutation(api.expertInterviews.create, {
        title: "Invalid source Expert Interview",
        origin: "manual",
        source: { url: "javascript:alert(1)" },
        ...interviewPackage,
        gaps: interviewPackage.gaps.map((gap, index) => ({
          ...gap,
          citations:
            gap.citations.length > 0
              ? gap.citations
              : [
                  {
                    label: `Evidence ${index + 1}`,
                    url: `https://example.test/evidence-${index + 1}`,
                    supports: "Supporting evidence.",
                  },
                ],
        })),
        correlationId: "atomic-invalid-source",
      })
    ).rejects.toMatchObject({
      data: { code: "VALIDATION_FAILED", field: "source.url" },
    })
  })

  it("persists and reads the complete ordered package without title inference", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "How bridge financing works when the timeline breaks",
      origin: "cli",
      source: {
        question: interviewPackage.brief.topic,
        channel: "expert_interview",
      },
      correlationId: "expert-request-1",
    })

    const first = await backend.mutation(api.expertInterviews.savePackage, {
      humanId: created.humanId,
      ...interviewPackage,
      correlationId: "expert-package-1",
    })
    const retried = await backend.mutation(api.expertInterviews.savePackage, {
      humanId: created.humanId,
      ...interviewPackage,
      correlationId: "expert-package-1",
    })
    const request = await backend.query(api.contentRequests.getByHumanId, {
      humanId: created.humanId,
    })
    const read = await backend.query(api.expertInterviews.getByHumanId, {
      humanId: created.humanId,
    })

    expect(request?.requestType).toBe("expert_interview")
    expect(retried).toEqual(first)
    expect(read).toEqual(first)
    expect(read?.operatorInstructions).toBe(
      "Use an Ontario broker's point of view before inference."
    )
    expect(read?.gaps.map(({ id }: { id: string }) => id)).toEqual([
      "gap-second",
      "gap-first",
    ])
    expect(read?.questions.map(({ id }: { id: string }) => id)).toEqual([
      "q-second",
      "q-first",
    ])
    expect(read?.gaps[0]?.citations).toEqual([
      {
        label: "Ontario guidance",
        url: "https://example.test/ontario-guidance",
        supports: "Standard disclosure obligations",
      },
    ])
    expect(read?.questions[0]).toMatchObject({
      motivation: "Capture the second-stage recovery decision.",
      gapIds: ["gap-second"],
    })
  })

  it("replays a legacy package with empty citations before enforcing new-write rules", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    const principal = await backend.mutation(api.principals.syncCurrent)
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Legacy empty-citation package",
      origin: "manual",
      correlationId: "legacy-empty-package-request",
    })
    const legacyPackage = {
      ...interviewPackage,
      gaps: interviewPackage.gaps.map((gap) => ({
        ...gap,
        citations: [],
      })),
    }
    await backend.run(async (ctx) => {
      await ctx.db.insert("expertInterviews", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        ...legacyPackage,
        createdByPrincipalId: principal.principalId,
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        requestHumanId: request.humanId,
        actorPrincipalId: principal.principalId,
        credentialId: operatorIdentity.jti,
        operation: "expert_interview.package_saved",
        correlationId: "legacy-empty-package-save",
        occurredAt: 1,
        afterVersion: 2,
        inputFingerprint: JSON.stringify(legacyPackage),
      })
    })

    const replay = await backend.mutation(api.expertInterviews.savePackage, {
      humanId: request.humanId,
      ...legacyPackage,
      correlationId: "legacy-empty-package-save",
    })
    expect(replay.gaps.every((gap) => gap.citations.length === 0)).toBe(true)

    await expect(
      backend.mutation(api.expertInterviews.savePackage, {
        humanId: request.humanId,
        ...legacyPackage,
        brief: {
          ...legacyPackage.brief,
          summary: "A changed legacy retry must still fail idempotency.",
        },
        correlationId: "legacy-empty-package-save",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
  })

  it("enforces Content Request founder authorization on package reads", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const assignedFounder = workspace.withIdentity({
      ...operatorIdentity,
      subject: "assigned-expert-founder",
      role: "founder",
      jti: "assigned-expert-founder-session",
    })
    const otherFounder = workspace.withIdentity({
      ...operatorIdentity,
      subject: "other-expert-founder",
      role: "founder",
      jti: "other-expert-founder-session",
    })
    await operator.mutation(api.principals.syncCurrent)
    const assigned = await assignedFounder.mutation(api.principals.syncCurrent)
    await otherFounder.mutation(api.principals.syncCurrent)
    const created = await operator.mutation(api.contentRequests.createManual, {
      title: "Founder-scoped expert interview",
      origin: "manual",
      correlationId: "expert-founder-scope-request",
    })
    await operator.mutation(api.expertInterviews.savePackage, {
      humanId: created.humanId,
      ...interviewPackage,
      correlationId: "expert-founder-scope-package",
    })
    await operator.run((ctx) =>
      ctx.db.patch(created.requestId, {
        assigneePrincipalId: assigned.principalId,
      })
    )

    await expect(
      assignedFounder.query(api.expertInterviews.getByHumanId, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject({ requestHumanId: created.humanId })
    await expect(
      otherFounder.query(api.contentRequests.getByHumanId, {
        humanId: created.humanId,
      })
    ).rejects.toMatchObject({ data: { code: "RESOURCE_ACCESS_DENIED" } })
    await expect(
      otherFounder.query(api.expertInterviews.getByHumanId, {
        humanId: created.humanId,
      })
    ).rejects.toMatchObject({ data: { code: "RESOURCE_ACCESS_DENIED" } })
  })

  it.each([
    {
      name: "gap count",
      package: {
        ...interviewPackage,
        gaps: Array.from({ length: 51 }, (_, index) => ({
          ...interviewPackage.gaps[0]!,
          id: `gap-${index}`,
        })),
      },
      field: "gaps",
    },
    {
      name: "nested string length",
      package: {
        ...interviewPackage,
        brief: {
          ...interviewPackage.brief,
          summary: "x".repeat(10_001),
        },
      },
      field: "brief.summary",
    },
    {
      name: "serialized byte size",
      package: {
        ...interviewPackage,
        gaps: Array.from({ length: 50 }, (_, index) => ({
          ...interviewPackage.gaps[0]!,
          id: `gap-${index}`,
          existingCoverage: "é".repeat(6_000),
          whyItFallsShort: "é".repeat(3_000),
          expertOpportunity: "é".repeat(2_000),
        })),
        questions: Array.from({ length: 100 }, (_, index) => ({
          ...interviewPackage.questions[0]!,
          id: `question-${index}`,
          gapIds: [`gap-${index % 50}`],
        })),
      },
      field: "package",
    },
  ])(
    "rejects an excessive $name before changing request state",
    async ({ package: oversizedPackage, field }) => {
      const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
      await backend.mutation(api.principals.syncCurrent)
      const created = await backend.mutation(api.contentRequests.createManual, {
        title: "Bounded expert interview",
        origin: "manual",
        correlationId: `bounded-${field}-request`,
      })

      await expect(
        backend.mutation(api.expertInterviews.savePackage, {
          humanId: created.humanId,
          ...oversizedPackage,
          correlationId: `bounded-${field}-package`,
        })
      ).rejects.toMatchObject({
        data: { code: "VALIDATION_FAILED", field },
      })
      await expect(
        backend.query(api.contentRequests.getByHumanId, {
          humanId: created.humanId,
        })
      ).resolves.toMatchObject({ requestType: "standard" })
      await expect(
        backend.query(api.expertInterviews.getByHumanId, {
          humanId: created.humanId,
        })
      ).resolves.toBeNull()
    }
  )

  it("rejects malformed nested citations before changing request state", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Validated expert interview",
      origin: "manual",
      correlationId: "validated-expert-request",
    })

    await expect(
      backend.mutation(api.expertInterviews.savePackage, {
        humanId: created.humanId,
        ...interviewPackage,
        gaps: [
          {
            ...interviewPackage.gaps[0]!,
            citations: [
              {
                label: "Unsafe citation",
                url: "javascript:alert(1)",
                supports: "Nothing safe",
              },
            ],
          },
        ],
        correlationId: "validated-expert-package",
      })
    ).rejects.toMatchObject({
      data: { code: "VALIDATION_FAILED", field: "gaps.citations.url" },
    })
    await expect(
      backend.mutation(api.expertInterviews.savePackage, {
        humanId: created.humanId,
        ...interviewPackage,
        gaps: interviewPackage.gaps.map((gap) => ({
          ...gap,
          citations: [],
        })),
        correlationId: "validated-empty-citations",
      })
    ).rejects.toMatchObject({
      data: { code: "VALIDATION_FAILED", field: "gaps.citations" },
    })
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject({ requestType: "standard" })
  })

  it("backfills legacy requests to the Standard Request type", async () => {
    const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Legacy request without a durable type",
      origin: "manual",
      correlationId: "legacy-request-type-1",
    })
    await backend.run((ctx) =>
      ctx.db.patch(created.requestId, { requestType: undefined })
    )

    const before = await backend.query(
      internal.migrations.validateV1Invariants,
      {}
    )
    expect(before.issues).toContainEqual({
      humanId: created.humanId,
      code: "request_type",
    })
    await expect(
      backend.mutation(internal.migrations.backfillContentRequestTypes, {})
    ).resolves.toEqual({ migrated: 1, done: true })
    await expect(
      backend.query(internal.migrations.validateV1Invariants, {})
    ).resolves.toMatchObject({ issues: [] })
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject({ requestType: "standard" })
  })
})
