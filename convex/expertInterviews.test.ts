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
      citations: [],
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
