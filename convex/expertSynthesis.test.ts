// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = {
  subject: "expert-synthesis-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "expert-synthesis-session",
}

async function fixture() {
  const workspace = convexTest(schema, modules)
  const backend = workspace.withIdentity(identity)
  const principal = await backend.mutation(api.principals.syncCurrent)
  const request = await backend.mutation(api.contentRequests.createManual, {
    title: "Delayed closing recovery",
    origin: "manual",
    correlationId: "synthesis-request",
  })
  await backend.mutation(api.expertInterviews.savePackage, {
    humanId: request.humanId,
    brief: {
      topic: "Delayed closings",
      summary: "A practical recovery guide.",
      audience: "Ontario borrowers",
      framing: "insider_knowledge",
      fairlendPosture: "Educational.",
      founderContribution: "Recovery sequences.",
    },
    gaps: [
      {
        id: "gap-1",
        kind: "reality_on_the_ground",
        title: "First hour",
        existingCoverage: "Normal process.",
        whyItFallsShort: "No recovery sequence.",
        expertOpportunity: "Compare practitioner sequences.",
        citations: [
          {
            label: "Bridge closing guide",
            url: "https://example.test/bridge-closing-guide",
            supports: "The ordinary process that omits recovery sequencing.",
          },
        ],
      },
    ],
    questions: [
      {
        id: "q-1",
        question: "Who do you call first?",
        motivation: "Expose the recovery sequence.",
        gapIds: ["gap-1"],
      },
    ],
    correlationId: "synthesis-package",
  })
  const seeded = await backend.run(async (ctx) => {
    const contextItemId = await ctx.db.insert("contextItems", {
      organizationId: "org_fairlend",
      requestId: request.requestId,
      kind: "source_summary",
      title: "Expert interview brief",
      bulletPoints: ["Topic: delayed closings"],
      citations: [],
      updatedByPrincipalId: principal.principalId,
      createdAt: 1,
      updatedAt: 1,
    })
    const contextVersionId = await ctx.db.insert("contextItemVersions", {
      organizationId: "org_fairlend",
      requestId: request.requestId,
      contextItemId,
      ordinal: 1,
      kind: "source_summary",
      title: "Expert interview brief",
      bulletPoints: ["Topic: delayed closings"],
      citations: [],
      actorPrincipalId: principal.principalId,
      credentialId: identity.jti,
      correlationId: "context-1",
      createdAt: 1,
    })
    const personId = await ctx.db.insert("people", {
      organizationId: "org_fairlend",
      displayName: "Alex Expert",
      normalizedDisplayName: "alex expert",
      email: "alex@example.test",
      normalizedEmail: "alex@example.test",
      searchText: "alex expert alex@example.test",
      isFounder: false,
      createdAt: 1,
      updatedAt: 1,
    })
    const grantId = await ctx.db.insert("guestAccessGrants", {
      organizationId: "org_fairlend",
      requestId: request.requestId,
      assignedPersonId: personId,
      currentTokenHash: "hash",
      tokenVersion: 1,
      expiresAt: 100_000,
      state: "submitted",
      createdByPrincipalId: principal.principalId,
      createdAt: 1,
      updatedAt: 10,
      latestActivityAt: 10,
    })
    const workspaceId = await ctx.db.insert("responseWorkspaces", {
      organizationId: "org_fairlend",
      requestId: request.requestId,
      grantId,
      answerMode: "one_by_one",
      batchText: "",
      questionAnswers: [
        { questionId: "q-1", text: "Call the closing lawyer." },
      ],
      revision: 2,
      lockedAt: 10,
      createdAt: 1,
      updatedAt: 10,
    })
    const submissionId = await ctx.db.insert("responseSubmissions", {
      organizationId: "org_fairlend",
      requestId: request.requestId,
      requestHumanId: request.humanId,
      grantId,
      workspaceId,
      assignedPersonId: personId,
      respondentDisplayName: "Alex Expert",
      respondentEmail: "alex@example.test",
      workspaceRevision: 2,
      answerMode: "one_by_one",
      batchText: "",
      questionAnswers: [
        { questionId: "q-1", text: "Call the closing lawyer." },
      ],
      questions: [
        {
          questionId: "q-1",
          question: "Who do you call first?",
          motivation: "Expose the recovery sequence.",
          position: 0,
          version: 7,
        },
      ],
      assetSnapshots: [],
      submittedAt: 10,
    })
    return { contextVersionId, submissionId }
  })
  return { workspace, backend, principal, request, ...seeded }
}

describe("Expert Synthesis submission selection", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.EXPERT_SYNTHESIS_SNAPSHOT_SECRET =
      "expert-synthesis-test-secret-with-at-least-32-bytes"
  })
  afterEach(() => vi.useRealTimers())

  it("issues a tamper-evident snapshot only for included evidence and preserves the exact context versions", async () => {
    const { backend, contextVersionId, request, submissionId } = await fixture()
    await backend.run(async (ctx) => {
      const principal = await ctx.db.query("principals").first()
      if (!principal) throw new Error("Missing principal fixture")
      const unrelatedItemId = await ctx.db.insert("contextItems", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        kind: "guardrails",
        title: "Unrelated brand note",
        bulletPoints: ["Not used by Expert Synthesis."],
        citations: [],
        updatedByPrincipalId: principal._id,
        createdAt: 2,
        updatedAt: 2,
      })
      await ctx.db.insert("contextItemVersions", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        contextItemId: unrelatedItemId,
        ordinal: 1,
        kind: "guardrails",
        title: "Unrelated brand note",
        bulletPoints: ["Not used by Expert Synthesis."],
        citations: [],
        actorPrincipalId: principal._id,
        credentialId: identity.jti,
        correlationId: "unrelated-context",
        createdAt: 2,
      })
    })
    const synthesisContextVersionIds = await backend.query(
      api.expertSynthesis.listContextVersionIds,
      {
        humanId: request.humanId,
      }
    )
    expect(synthesisContextVersionIds).toHaveLength(5)
    expect(synthesisContextVersionIds).toContain(contextVersionId)

    await expect(
      backend.mutation(api.expertSynthesis.createProcessingSnapshot, {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-undecided-snapshot",
      })
    ).rejects.toThrow("EXPERT_INTERVIEW_SUBMISSION_DECISIONS_REQUIRED")

    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-for-snapshot",
    })
    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-context-snapshot",
      }
    )
    await backend.run(async (ctx) => {
      const prior = await ctx.db.get(contextVersionId)
      if (!prior) throw new Error("Missing context fixture")
      const { _id: _priorId, _creationTime: _priorCreated, ...snapshot } = prior
      void _priorId
      void _priorCreated
      await ctx.db.insert("contextItemVersions", {
        ...snapshot,
        ordinal: 2,
        bulletPoints: ["A newer context version"],
        correlationId: "context-2",
        createdAt: 2,
      })
    })

    await expect(
      backend.query(api.expertSynthesis.verifyProcessingSnapshot, {
        humanId: request.humanId,
        processingToken: snapshot.processingToken,
        submissionIds: [submissionId],
      })
    ).rejects.toThrow("EXPERT_SYNTHESIS_SNAPSHOT_STALE")
    await expect(
      backend.query(api.expertSynthesis.verifyProcessingSnapshot, {
        humanId: request.humanId,
        processingToken: `${snapshot.processingToken.slice(0, -1)}${
          snapshot.processingToken.endsWith("0") ? "1" : "0"
        }`,
        submissionIds: [submissionId],
      })
    ).rejects.toThrow("INVALID_EXPERT_SYNTHESIS_SNAPSHOT")
  })

  it("reuses one prepared snapshot for an exact correlation retry and rejects key reuse", async () => {
    const { backend, request, submissionId } = await fixture()
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-for-idempotent-preparation",
    })
    const input = {
      humanId: request.humanId,
      submissionIds: [submissionId],
      synthesisInstructions: "Lead with the exact recovery sequence.",
      correlationId: "prepare-idempotent-synthesis",
    }

    const first = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      input
    )
    const replay = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      input
    )
    expect(replay).toEqual(first)
    expect(
      await backend.run((ctx) =>
        ctx.db.query("expertSynthesisProcessingSnapshots").collect()
      )
    ).toHaveLength(1)
    await expect(
      backend.mutation(api.expertSynthesis.createProcessingSnapshot, {
        ...input,
        synthesisInstructions: "Use a different structure.",
      })
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSED")
  })

  it("lists immutable evidence as undecided until an attributable include or exclude decision is made", async () => {
    const { workspace, backend, request, submissionId } = await fixture()
    const sensitiveFileName = "private-borrower-closing-notes.pdf"
    const sensitiveTranscript =
      "The borrower disclosed a private lender escalation."
    await workspace.run(async (ctx) => {
      const submission = await ctx.db.get(submissionId)
      if (!submission) throw new Error("Missing response Submission")
      const assetId = await ctx.db.insert("responseAssets", {
        organizationId: submission.organizationId,
        requestId: submission.requestId,
        grantId: submission.grantId,
        workspaceId: submission.workspaceId,
        clientAssetId: "redaction-boundary-asset",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: sensitiveFileName,
        mimeType: "application/pdf",
        sizeBytes: 1_024,
        uploadState: "uploaded",
        transcriptionState: "transcribed",
        transcript: sensitiveTranscript,
        transcriptVersion: 1,
        transcriptionAttempt: 1,
        retryHistory: [],
        version: 1,
        submittedAt: submission.submittedAt,
        createdAt: submission.submittedAt,
        updatedAt: submission.submittedAt,
      })
      await ctx.db.patch(submission._id, {
        assetSnapshots: [
          {
            assetId,
            version: 1,
            transcriptVersion: 1,
            kind: "attachment",
            scope: { kind: "batch" },
          },
        ],
      })
    })

    const undecided = await backend.mutation(
      api.expertSynthesis.listSubmissions,
      {
        humanId: request.humanId,
      }
    )
    expect(undecided).toEqual([
      expect.objectContaining({
        submissionId,
        respondent: {
          personId: expect.any(String),
          displayName: "Alex Expert",
          email: "alex@example.test",
        },
        progress: { completed: 1, total: 1 },
        inclusion: { state: "undecided", decidedBy: null, decidedAt: null },
      }),
    ])
    const undecidedPayload = JSON.stringify(undecided)
    expect(undecidedPayload).not.toContain("Call the closing lawyer.")
    expect(undecidedPayload).not.toContain(sensitiveFileName)
    expect(undecidedPayload).not.toContain(sensitiveTranscript)
    expect(undecidedPayload).not.toContain("questionAnswers")
    expect(undecidedPayload).not.toContain("batchText")
    expect(undecidedPayload).not.toContain('"assets"')

    const excludedDecision = await backend.mutation(
      api.expertSynthesis.setSubmissionInclusion,
      {
        humanId: request.humanId,
        submissionId,
        included: false,
        correlationId: "exclude-alex",
      }
    )
    expect(excludedDecision.inclusion.state).toBe("excluded")
    expect(JSON.stringify(excludedDecision)).not.toContain(
      "Call the closing lawyer."
    )
    expect(JSON.stringify(excludedDecision)).not.toContain(sensitiveFileName)
    expect(JSON.stringify(excludedDecision)).not.toContain(sensitiveTranscript)
    const includedDecision = await backend.mutation(
      api.expertSynthesis.setSubmissionInclusion,
      {
        humanId: request.humanId,
        submissionId,
        included: true,
        correlationId: "include-alex",
      }
    )
    expect(includedDecision.inclusion.state).toBe("included")
    expect(JSON.stringify(includedDecision)).not.toContain(
      "Call the closing lawyer."
    )
    expect(JSON.stringify(includedDecision)).not.toContain(sensitiveFileName)
    expect(JSON.stringify(includedDecision)).not.toContain(sensitiveTranscript)
    await expect(
      backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
        humanId: request.humanId,
        submissionId,
        included: true,
        correlationId: "include-alex",
      })
    ).resolves.toMatchObject({ inclusion: { state: "included" } })

    const included = await backend.mutation(
      api.expertSynthesis.listSubmissions,
      {
        humanId: request.humanId,
      }
    )
    expect(included[0]?.inclusion).toMatchObject({
      state: "included",
      decidedBy: { principalId: expect.any(String) },
      decidedAt: expect.any(Number),
    })
    expect(JSON.stringify(included)).not.toContain("Call the closing lawyer.")
    const processing = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-included-alex-evidence",
      }
    )
    expect(processing.canonicalBundle).toContain("Call the closing lawyer.")
    expect(processing.canonicalBundle).toContain(sensitiveFileName)
    expect(processing.canonicalBundle).toContain(sensitiveTranscript)
    const audit = await backend.query(api.contentRequests.listAuditEventsPage, {
      humanId: request.humanId,
      paginationOpts: { numItems: 20, cursor: null },
    })
    expect(audit.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "expert_synthesis.submission_included",
          correlationId: "include-alex",
        }),
      ])
    )
  })

  it("migrates the legacy founder submission into the same explicit selection and processing bundle", async () => {
    const { backend, principal, request, submissionId } = await fixture()
    const founderSubmissionId = await backend.run(async (ctx) => {
      await ctx.db.patch(principal.principalId, {
        displayName: "Elie Founder",
        email: "elie@example.test",
      })
      const documentId = await ctx.db.insert("founderInputDocuments", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        founderPrincipalId: principal.principalId,
        text: "Rebuild the closing timeline before replacing the lender.",
        revision: 3,
        hasMeaningfulDraft: true,
        createdAt: 1,
        updatedAt: 20,
      })
      const founderVersionId = await ctx.db.insert("founderInputVersions", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        documentId,
        text: "Rebuild the closing timeline before replacing the lender.",
        heads: ["founder-head-1"],
        revision: 3,
        actorPrincipalId: principal.principalId,
        actorSubject: identity.subject,
        correlationId: "founder-version",
        occurredAt: 20,
      })
      return ctx.db.insert("founderSubmissions", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        documentId,
        founderVersionId,
        founderPrincipalId: principal.principalId,
        correlationId: "founder-submission",
        submittedAt: 20,
      })
    })
    const founderSourceId = `founder:${founderSubmissionId}`
    const submissions = await backend.mutation(
      api.expertSynthesis.listSubmissions,
      { humanId: request.humanId }
    )
    expect(submissions.map(({ source }) => source)).toEqual([
      "guest",
      "founder",
    ])
    expect(submissions[1]).toMatchObject({
      submissionId: founderSourceId,
      respondent: { displayName: "Elie Founder" },
      inclusion: { state: "undecided" },
    })
    await backend.run(async (ctx) => {
      await ctx.db.patch(principal.principalId, {
        displayName: "Mutated Founder",
        email: "mutated@example.test",
      })
      const legacy = await ctx.db.get(founderSubmissionId)
      const interview = await ctx.db
        .query("expertInterviews")
        .withIndex("by_request", (index) =>
          index.eq("requestId", request.requestId)
        )
        .unique()
      if (!legacy || !interview) throw new Error("Missing migration fixture")
      await ctx.db.patch(legacy.founderVersionId, {
        text: "Mutable legacy text must not leak into the Submission.",
        revision: 99,
      })
      await ctx.db.patch(interview._id, {
        questions: [
          {
            id: "q-mutated",
            question: "Mutated current interview question?",
            motivation: "Must not replace submitted evidence.",
            gapIds: ["gap-1"],
          },
        ],
        updatedAt: 99,
      })
    })
    const immutableReplay = await backend.mutation(
      api.expertSynthesis.listSubmissions,
      { humanId: request.humanId }
    )
    expect(immutableReplay[1]).toMatchObject({
      submissionId: founderSourceId,
      respondent: {
        displayName: "Elie Founder",
        email: "elie@example.test",
      },
      workspaceRevision: 3,
      sourceSummary:
        "1 of 1 batch response complete · founder submission · historical question provenance unavailable",
    })
    expect(
      await backend.run((ctx) =>
        ctx.db
          .query("auditEvents")
          .withIndex("by_request_operation_correlation", (index) =>
            index
              .eq("requestId", request.requestId)
              .eq("operation", "expert_submission.legacy_materialized")
              .eq(
                "correlationId",
                `legacy-expert-submission:${founderSubmissionId}`
              )
          )
          .collect()
      )
    ).toEqual([
      expect.objectContaining({
        actorPrincipalId: principal.principalId,
        credentialId: expect.any(String),
      }),
    ])

    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: false,
      correlationId: "exclude-guest-for-founder-migration",
    })
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId: founderSourceId,
      included: true,
      correlationId: "include-founder-migration",
    })
    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [founderSourceId],
        correlationId: "prepare-legacy-founder-migration",
      }
    )
    const canonicalBundle = JSON.parse(snapshot.canonicalBundle) as {
      selectedSubmissions: Array<{
        submissionId: string
        source: string
        batchText: string
      }>
    }
    expect(canonicalBundle.selectedSubmissions).toEqual([
      expect.objectContaining({
        submissionId: founderSourceId,
        source: "founder",
        batchText: "Rebuild the closing timeline before replacing the lender.",
      }),
    ])
  })

  it("server-attests an ordered conflicting multi-respondent bundle", async () => {
    const { workspace, backend, request, submissionId } = await fixture()
    const secondSubmissionId = await workspace.run(async (ctx) => {
      const principal = await ctx.db.query("principals").first()
      if (!principal) throw new Error("Missing principal")
      const personId = await ctx.db.insert("people", {
        organizationId: identity.org_id,
        displayName: "Blair Expert",
        normalizedDisplayName: "blair expert",
        email: "blair@example.test",
        normalizedEmail: "blair@example.test",
        searchText: "blair expert blair@example.test",
        isFounder: false,
        createdAt: 2,
        updatedAt: 2,
      })
      const grantId = await ctx.db.insert("guestAccessGrants", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        assignedPersonId: personId,
        currentTokenHash: "second-hash",
        tokenVersion: 1,
        expiresAt: 100_000,
        state: "submitted",
        createdByPrincipalId: principal._id,
        createdAt: 2,
        updatedAt: 20,
        latestActivityAt: 20,
      })
      const responseWorkspaceId = await ctx.db.insert("responseWorkspaces", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        grantId,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [
          { questionId: "q-1", text: "Call the lender first." },
        ],
        revision: 1,
        lockedAt: 20,
        createdAt: 2,
        updatedAt: 20,
      })
      return ctx.db.insert("responseSubmissions", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        requestHumanId: request.humanId,
        grantId,
        workspaceId: responseWorkspaceId,
        assignedPersonId: personId,
        respondentDisplayName: "Blair Expert",
        respondentEmail: "blair@example.test",
        workspaceRevision: 1,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [
          { questionId: "q-1", text: "Call the lender first." },
        ],
        questions: [
          {
            questionId: "q-1",
            question: "Who do you call first?",
            motivation: "Expose the recovery sequence.",
            position: 0,
            version: 7,
          },
        ],
        assetSnapshots: [],
        submittedAt: 20,
      })
    })
    for (const [id, correlationId] of [
      [submissionId, "include-alex-conflict"],
      [secondSubmissionId, "include-blair-conflict"],
    ] as const)
      await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
        humanId: request.humanId,
        submissionId: id,
        included: true,
        correlationId,
      })

    await expect(
      backend.mutation(api.expertSynthesis.createProcessingSnapshot, {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-incomplete-selection",
      })
    ).rejects.toThrow("EXPERT_SYNTHESIS_SELECTION_MISMATCH")

    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [secondSubmissionId, submissionId],
        synthesisInstructions: "Preserve the disagreement.",
        correlationId: "prepare-conflicting-multi",
      }
    )
    const canonical = JSON.parse(snapshot.canonicalBundle) as {
      selectedSubmissions: Array<{
        submissionId: string
        questionAnswers: Array<{ text: string }>
      }>
      priorityInstructions: Array<string>
    }
    expect(
      canonical.selectedSubmissions.map(({ submissionId: id }) => id)
    ).toEqual([secondSubmissionId, submissionId])
    expect(
      canonical.selectedSubmissions.map(
        ({ questionAnswers }) => questionAnswers[0]?.text
      )
    ).toEqual(["Call the lender first.", "Call the closing lawyer."])
    expect(canonical.priorityInstructions.at(-1)).toBe(
      "Preserve the disagreement."
    )
    expect(snapshot.payloadDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(snapshot.payloadDigest).not.toBe("a".repeat(64))
    const completionBody = [
      "# Conflicting recovery sequences",
      "",
      "Blair recommends calling the lender first; Alex recommends calling the closing lawyer first.",
    ].join("\n")
    const completion = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      {
        humanId: request.humanId,
        processingToken: snapshot.processingToken,
        submissionIds: [secondSubmissionId, submissionId],
        payloadDigest: snapshot.payloadDigest,
        body: completionBody,
        correlationId: "complete-conflicting-respondents",
      }
    )
    const storedProvenance = await backend.run((ctx) =>
      ctx.db.get(completion.provenance.provenanceId)
    )
    expect(completion.provenance).toMatchObject({
      submissionIds: [secondSubmissionId, submissionId],
      payloadDigest: snapshot.payloadDigest,
      canonicalBundle: snapshot.canonicalBundle,
    })
    expect(storedProvenance).toMatchObject({
      submissionIds: [secondSubmissionId, submissionId],
      canonicalBundle: snapshot.canonicalBundle,
      completionDeliverable: {
        currentCandidateVersionId: completion.provenance.versionId,
        versions: [
          expect.objectContaining({
            versionId: completion.provenance.versionId,
            bodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
        ],
      },
    })
    expect(JSON.stringify(storedProvenance)).not.toContain(completionBody)
    expect(completion.deliverable.versions.at(-1)?.body).toBe(completionBody)
  })

  it("targets only an explicit Deliverable ID and otherwise creates a new Deliverable", async () => {
    const { backend, request, submissionId } = await fixture()
    const deliverable = await backend.mutation(
      api.deliverables.createDerivative,
      {
        humanId: request.humanId,
        kind: "blog_article",
        name: "Expert synthesis",
        body: "# Attributed draft",
        correlationId: "synthesis-deliverable",
      }
    )
    if (!deliverable.currentCandidateVersionId)
      throw new Error("Expected initial Deliverable Version")

    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-for-provenance",
    })
    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-targeted-synthesis",
      }
    )
    const completion = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      {
        humanId: request.humanId,
        deliverableId: deliverable.deliverableId,
        submissionIds: [submissionId],
        payloadDigest: snapshot.payloadDigest,
        processingToken: snapshot.processingToken,
        body: "# New attributed version",
        correlationId: "targeted-synthesis",
      }
    )
    expect(completion.provenance).toMatchObject({
      deliverableId: deliverable.deliverableId,
      submissionIds: [submissionId],
      contextVersionIds: snapshot.contextVersionIds,
      payloadDigest: snapshot.payloadDigest,
    })
    const newSnapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-new-synthesis",
      }
    )
    const created = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        payloadDigest: newSnapshot.payloadDigest,
        processingToken: newSnapshot.processingToken,
        body: "# Independent attributed draft",
        name: "Expert synthesis",
        correlationId: "new-synthesis",
      }
    )
    expect(created.deliverable.deliverableId).not.toBe(
      deliverable.deliverableId
    )
  })

  it("atomically commits one attributed version and replays the exact result", async () => {
    const { backend, request, submissionId } = await fixture()
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-for-atomic-completion",
    })
    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-atomic-synthesis",
      }
    )
    const input = {
      humanId: request.humanId,
      processingToken: snapshot.processingToken,
      submissionIds: [submissionId],
      payloadDigest: snapshot.payloadDigest,
      body: "# Attributed synthesis",
      correlationId: "atomic-synthesis-completion",
    }
    const first = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      input
    )
    const replay = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      input
    )
    expect(replay).toEqual(first)
    await expect(
      backend.mutation(api.expertSynthesis.completeProcessing, {
        ...input,
        payloadDigest: "b".repeat(64),
      })
    ).rejects.toThrow("INVALID_EXPERT_SYNTHESIS_SNAPSHOT")
    expect(first.deliverable.currentCandidateVersionId).toBe(
      first.provenance.versionId
    )

    const stored = await backend.run(async (ctx) => ({
      provenance: await ctx.db
        .query("expertSynthesisProvenance")
        .withIndex("by_request_created_at", (index) =>
          index.eq("requestId", request.requestId)
        )
        .collect(),
      versions: (await ctx.db.query("deliverableVersions").collect()).filter(
        (version) => version.requestId === request.requestId
      ),
      processingSnapshot: await ctx.db.get(snapshot.snapshotId),
    }))
    expect(stored.provenance).toHaveLength(1)
    expect(stored.versions).toHaveLength(1)
    expect(stored.provenance[0]?.versionId).toBe(stored.versions[0]?._id)
    expect(stored.provenance[0]).toMatchObject({
      processingSnapshotId: snapshot.snapshotId,
      payloadDigest: snapshot.payloadDigest,
      canonicalBundle: snapshot.canonicalBundle,
    })
    expect(stored.processingSnapshot?.canonicalBundle).toBe(
      snapshot.canonicalBundle
    )

    await expect(
      backend.mutation(api.expertSynthesis.completeProcessing, {
        ...input,
        body: "# Different body",
      })
    ).rejects.toBeTruthy()
  })

  it("rejects first completion after the included set changes", async () => {
    const { backend, request, submissionId } = await fixture()
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-before-stale-completion",
    })
    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-before-selection-drift",
      }
    )
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: false,
      correlationId: "exclude-after-preparation",
    })

    await expect(
      backend.mutation(api.expertSynthesis.completeProcessing, {
        humanId: request.humanId,
        processingToken: snapshot.processingToken,
        submissionIds: [submissionId],
        payloadDigest: snapshot.payloadDigest,
        body: "# Must not commit",
        correlationId: "complete-after-selection-drift",
      })
    ).rejects.toThrow("EXPERT_SYNTHESIS_SNAPSHOT_STALE")
    expect(
      await backend.run((ctx) =>
        ctx.db.query("expertSynthesisProvenance").collect()
      )
    ).toHaveLength(0)
  })

  it("replays exact preparation after inclusion drift and rebuilds with a new key", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const { backend, request, submissionId } = await fixture()
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-before-round-trip",
    })
    const first = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-round-trip",
      }
    )

    vi.setSystemTime(1_800_000_000_001)
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: false,
      correlationId: "exclude-round-trip",
    })
    vi.setSystemTime(1_800_000_000_002)
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-after-round-trip",
    })

    const replay = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-round-trip",
      }
    )
    expect(replay).toEqual(first)
    const rebuilt = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-round-trip-rebuilt",
      }
    )
    expect(rebuilt.snapshotId).not.toBe(first.snapshotId)
    expect(rebuilt.payloadDigest).not.toBe(first.payloadDigest)
    expect(rebuilt.canonicalBundle).toContain('"decisionId"')
  })

  it("replays exact preparation before request-state checks", async () => {
    const { backend, request, submissionId } = await fixture()
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-before-archived-prepare-replay",
    })
    const input = {
      humanId: request.humanId,
      submissionIds: [submissionId],
      correlationId: "prepare-before-request-archive",
    }
    const first = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      input
    )
    await backend.run(async (ctx) => {
      await ctx.db.patch(request.requestId, {
        retention: "archived",
        archivedAt: Date.now(),
      })
    })

    await expect(
      backend.mutation(api.expertSynthesis.createProcessingSnapshot, input)
    ).resolves.toEqual(first)
    await expect(
      backend.mutation(api.expertSynthesis.createProcessingSnapshot, {
        ...input,
        synthesisInstructions: "Different logical input.",
      })
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSED")
    await expect(
      backend.mutation(api.expertSynthesis.createProcessingSnapshot, {
        ...input,
        correlationId: "new-prepare-after-request-archive",
      })
    ).rejects.toThrow("ARCHIVED_REQUEST")
  })

  it("rejects first completion after the interview package changes", async () => {
    const { workspace, backend, request, submissionId } = await fixture()
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-before-package-drift",
    })
    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-before-package-drift",
      }
    )
    await workspace.run(async (ctx) => {
      const interview = await ctx.db
        .query("expertInterviews")
        .withIndex("by_request", (index) =>
          index.eq("requestId", request.requestId)
        )
        .unique()
      if (!interview) throw new Error("Expert Interview missing")
      await ctx.db.patch(interview._id, {
        operatorInstructions: "A newly saved package instruction.",
        updatedAt: interview.updatedAt + 1,
      })
    })

    await expect(
      backend.mutation(api.expertSynthesis.completeProcessing, {
        humanId: request.humanId,
        processingToken: snapshot.processingToken,
        submissionIds: [submissionId],
        payloadDigest: snapshot.payloadDigest,
        body: "# Must not commit",
        correlationId: "complete-after-package-drift",
      })
    ).rejects.toThrow("EXPERT_SYNTHESIS_SNAPSHOT_STALE")
    expect(
      await backend.run((ctx) =>
        ctx.db.query("expertSynthesisProvenance").collect()
      )
    ).toHaveLength(0)
  })

  it("replays the exact committed projection before expiry, inclusion, request-state, or Deliverable drift checks", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const { backend, request, submissionId } = await fixture()
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: true,
      correlationId: "include-for-drift-replay",
    })
    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [submissionId],
        correlationId: "prepare-drift-replay",
      }
    )
    const input = {
      humanId: request.humanId,
      processingToken: snapshot.processingToken,
      submissionIds: [submissionId],
      payloadDigest: snapshot.payloadDigest,
      body: "# Immutable replay",
      correlationId: "drift-replay",
    }
    const first = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      input
    )
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: false,
      correlationId: "exclude-after-completion",
    })
    await backend.mutation(api.deliverables.createVersion, {
      deliverableId: first.deliverable.deliverableId,
      body: "# Later mutable candidate",
      correlationId: "later-version",
    })
    await backend.run(async (ctx) => {
      await ctx.db.patch(request.requestId, {
        retention: "archived",
        archivedAt: Date.now(),
      })
    })
    vi.setSystemTime(new Date("2026-01-01T03:00:00Z"))

    const replay = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      input
    )
    expect(replay).toEqual(first)
    expect(replay.deliverable.versions).toHaveLength(1)
    expect(replay.deliverable.currentCandidateVersionId).toBe(
      first.provenance.versionId
    )
  })

  it("bridges the founder drafting job into the shared Submission snapshot and completion path", async () => {
    const { workspace, backend, request, submissionId } = await fixture()
    const founder = workspace.withIdentity({
      subject: "expert-founder",
      issuer: identity.issuer,
      org_id: identity.org_id,
      role: "founder",
      jti: "expert-founder-session",
    })
    const agent = workspace.withIdentity({
      subject: "expert-agent",
      issuer: identity.issuer,
      org_id: identity.org_id,
      role: "agent-editor",
      jti: "expert-agent-session",
    })
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    await agent.mutation(api.principals.syncCurrent)
    await backend.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      correlationId: "assign-expert-founder",
    })
    const draft = await founder.mutation(api.founderInputs.saveText, {
      humanId: request.humanId,
      text: "My first call is the lender; the lawyer comes second.",
      correlationId: "save-expert-founder-input",
    })
    await workspace.run(async (ctx) => {
      await ctx.db.patch(draft.documentId, {
        durableHeads: ["expert-founder-durable-head"],
      })
      const document = await ctx.db.get(draft.documentId)
      if (!document) throw new Error("Founder input document missing")
      await ctx.db.insert("founderInputVersions", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        documentId: document._id,
        text: document.text,
        heads: ["expert-founder-durable-head"],
        revision: document.revision,
        actorPrincipalId: founderPrincipal.principalId,
        actorSubject: "expert-founder",
        correlationId: "durable-expert-founder-version",
        occurredAt: Date.now(),
      })
    })
    const queuedJob = await founder.mutation(api.agentJobs.submitFounderInput, {
      humanId: request.humanId,
      heads: ["expert-founder-durable-head"],
      correlationId: "submit-expert-founder-input",
    })
    const submissions = await backend.mutation(
      api.expertSynthesis.listSubmissions,
      { humanId: request.humanId }
    )
    const founderSubmission = submissions.find(
      ({ source }) => source === "founder"
    )
    expect(founderSubmission).toMatchObject({
      source: "founder",
      inclusion: { state: "undecided" },
    })
    if (!founderSubmission) throw new Error("Founder Submission missing")
    await expect(
      backend.mutation(api.expertSynthesis.createProcessingSnapshot, {
        humanId: request.humanId,
        submissionIds: [founderSubmission.submissionId],
        correlationId: "prepare-founder-undecided",
      })
    ).rejects.toThrow("EXPERT_INTERVIEW_SUBMISSION_DECISIONS_REQUIRED")

    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId,
      included: false,
      correlationId: "exclude-guest-before-founder-synthesis",
    })
    await backend.mutation(api.expertSynthesis.setSubmissionInclusion, {
      humanId: request.humanId,
      submissionId: founderSubmission.submissionId,
      included: true,
      correlationId: "include-founder-synthesis",
    })

    const leaseToken = "expert-founder-job-lease"
    const claimed = await agent.mutation(api.agentJobs.claimExpertSynthesis, {
      humanId: request.humanId,
      leaseToken,
      leaseMs: 60_000,
    })
    expect(claimed?.jobId).toBe(queuedJob.jobId)
    expect(claimed?.leaseToken).toBe(leaseToken)
    if (!claimed) throw new Error("Expected claimed Expert Interview job")
    expect(
      (
        await agent.query(api.agentJobs.list, {
          limit: 10,
        })
      ).find(({ jobId }) => jobId === queuedJob.jobId)?.leaseToken
    ).toBeNull()
    await expect(
      agent.query(api.agentJobs.getInput, { jobId: queuedJob.jobId })
    ).resolves.toMatchObject({
      processingModel: "expert_submissions",
      founderInput: null,
      expertSubmissionIds: expect.arrayContaining([
        founderSubmission.submissionId,
      ]),
    })
    await expect(
      agent.mutation(api.agentJobs.complete, {
        jobId: queuedJob.jobId,
        leaseToken,
        leaseGeneration: claimed.leaseGeneration,
        body: "# Legacy bypass",
        correlationId: "legacy-expert-completion",
      })
    ).rejects.toThrow("EXPERT_INTERVIEW_REQUIRES_SYNTHESIS_COMPLETION")

    const snapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [founderSubmission.submissionId],
        synthesisInstructions: "Lead with the first-hour sequence.",
        correlationId: "prepare-founder-synthesis",
      }
    )
    expect(
      (
        JSON.parse(snapshot.canonicalBundle) as {
          selectedSubmissions: Array<{
            answerMode: string
            batchText: string
          }>
        }
      ).selectedSubmissions
    ).toEqual([
      expect.objectContaining({
        answerMode: "batch",
        batchText: "My first call is the lender; the lawyer comes second.",
      }),
    ])
    await expect(
      agent.mutation(api.expertSynthesis.completeProcessing, {
        humanId: request.humanId,
        processingToken: snapshot.processingToken,
        submissionIds: [founderSubmission.submissionId],
        payloadDigest: snapshot.payloadDigest,
        body: "# Missing active founder lease",
        correlationId: "complete-founder-without-required-lease",
      })
    ).rejects.toThrow("EXPERT_INTERVIEW_AGENT_JOB_LEASE_REQUIRED")
    expect(
      await workspace.run((ctx) =>
        ctx.db
          .query("expertSynthesisProvenance")
          .withIndex("by_request_created_at", (index) =>
            index.eq("requestId", request.requestId)
          )
          .collect()
      )
    ).toHaveLength(0)
    const completion = await agent.mutation(
      api.expertSynthesis.completeProcessing,
      {
        humanId: request.humanId,
        processingToken: snapshot.processingToken,
        submissionIds: [founderSubmission.submissionId],
        payloadDigest: snapshot.payloadDigest,
        jobId: queuedJob.jobId,
        leaseToken: claimed.leaseToken!,
        leaseGeneration: claimed.leaseGeneration,
        body: "# Founder-backed expert synthesis",
        correlationId: "complete-founder-synthesis",
      }
    )
    await expect(
      agent.mutation(api.expertSynthesis.completeProcessing, {
        humanId: request.humanId,
        processingToken: snapshot.processingToken,
        submissionIds: [founderSubmission.submissionId],
        payloadDigest: snapshot.payloadDigest,
        body: "# Founder-backed expert synthesis",
        correlationId: "complete-founder-synthesis",
      })
    ).resolves.toEqual(completion)
    const stored = await workspace.run(async (ctx) => {
      const provenance = await ctx.db.get(completion.provenance.provenanceId)
      const processingSnapshot = await ctx.db.get(snapshot.snapshotId)
      const job = await ctx.db.get(queuedJob.jobId)
      const operations = await ctx.db.query("deliverableOperations").collect()
      const audits = await ctx.db.query("auditEvents").collect()
      const operation = operations.find(
        (candidate) => candidate.correlationId === "complete-founder-synthesis"
      )
      const audit = audits.find(
        (candidate) => candidate.operation === "expert_synthesis.completed"
      )
      return { provenance, processingSnapshot, job, operation, audit }
    })
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: request.humanId,
      })
    ).resolves.toMatchObject({ lifecycle: "ready_to_respond" })
    expect(stored.job).toMatchObject({
      status: "completed",
      resultVersionId: completion.provenance.versionId,
    })
    expect(stored.processingSnapshot?.canonicalBundle).toContain(
      '"source":"founder"'
    )
    expect(stored.provenance).toMatchObject({
      processingSnapshotId: snapshot.snapshotId,
      canonicalBundle: stored.processingSnapshot?.canonicalBundle,
      payloadDigest: snapshot.payloadDigest,
    })
    for (const fingerprint of [
      stored.provenance?.inputFingerprint,
      stored.operation?.inputFingerprint,
      stored.audit?.inputFingerprint,
    ]) {
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(fingerprint).not.toContain(leaseToken)
      expect(fingerprint).not.toContain("# Founder-backed expert synthesis")
    }

    const followUpSnapshot = await backend.mutation(
      api.expertSynthesis.createProcessingSnapshot,
      {
        humanId: request.humanId,
        submissionIds: [founderSubmission.submissionId],
        synthesisInstructions: "Create a tighter follow-up version.",
        correlationId: "prepare-founder-follow-up",
      }
    )
    const followUp = await backend.mutation(
      api.expertSynthesis.completeProcessing,
      {
        humanId: request.humanId,
        processingToken: followUpSnapshot.processingToken,
        submissionIds: [founderSubmission.submissionId],
        payloadDigest: followUpSnapshot.payloadDigest,
        deliverableId: completion.deliverable.deliverableId,
        body: "# Founder-backed expert synthesis, version two",
        correlationId: "complete-founder-follow-up-without-job-lease",
      }
    )
    expect(followUp.provenance.versionId).not.toBe(
      completion.provenance.versionId
    )
    expect(
      await workspace.run((ctx) => ctx.db.get(queuedJob.jobId))
    ).toMatchObject({
      status: "completed",
      resultVersionId: completion.provenance.versionId,
    })
  })
})
