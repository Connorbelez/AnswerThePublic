import { describe, expect, it } from "vitest"

import { api } from "../../convex/_generated/api"
import { createChatGptAppHandler } from "@/application/chatgpt-app"
import { createContentRequestService } from "@/application/content-requests"
import {
  completeExpertInterviewProcessingWithLease,
  prepareExpertInterviewProcessing,
} from "@/application/expert-interviews"
import type { ExternalIdentity } from "@/application/workspace-session"
import { createConvexTestContentRequestRepository } from "@/infrastructure/convex-test-content-request-repository.server"
import { getConvexTestWorkspace } from "@/infrastructure/convex-test-workspace.server"

const identity: ExternalIdentity = {
  subject: "ticket-09-mcp-operator",
  organizationId: "org_ticket_09_mcp",
  email: "operator@example.test",
  displayName: "MCP Operator",
  workosRole: "operator-editor",
}

function rpc(params: Record<string, unknown>) {
  return new Request("https://fairlend.test/api/chatgpt/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer production-shaped-test-credential",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      origin: "https://chatgpt.com",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params,
    }),
  })
}

async function seedTwoRespondentInterview() {
  process.env.FAIRLEND_E2E_ORGANIZATION_ID = identity.organizationId
  process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = identity.organizationId
  process.env.EXPERT_SYNTHESIS_SNAPSHOT_SECRET =
    "ticket-09-mcp-snapshot-secret-with-at-least-32-bytes"
  const backend = await getConvexTestWorkspace(identity)
  const request = await backend.mutation(api.contentRequests.createManual, {
    title: `MCP two-respondent synthesis ${crypto.randomUUID()}`,
    origin: "chatgpt_app",
    correlationId: `mcp-request-${crypto.randomUUID()}`,
  })
  await backend.mutation(api.expertInterviews.savePackage, {
    humanId: request.humanId,
    brief: {
      topic: "Recovering a delayed Ontario bridge closing",
      summary: "Compare the first call practitioners make.",
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
        existingCoverage: "Public guidance explains ordinary bridge closings.",
        whyItFallsShort: "It omits the recovery order when dates slip.",
        expertOpportunity: "Compare practitioner first calls.",
        citations: [],
      },
    ],
    questions: [
      {
        id: "question-first-call",
        question: "Who do you call first?",
        motivation: "Expose the real recovery sequence.",
        gapIds: ["gap-recovery"],
      },
    ],
    operatorInstructions: "Preserve material disagreement.",
    correlationId: `mcp-package-${crypto.randomUUID()}`,
  })
  const seeded = await backend.run(async (ctx) => {
    const principal = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index
          .eq("organizationId", identity.organizationId)
          .eq("subject", identity.subject)
      )
      .unique()
    if (!principal) throw new Error("MCP operator principal was not synced")
    const contextItemId = await ctx.db.insert("contextItems", {
      organizationId: identity.organizationId,
      requestId: request.requestId,
      kind: "source_summary",
      title: "Expert interview brief",
      bulletPoints: ["Compare lender-first and lawyer-first recovery paths."],
      citations: [],
      updatedByPrincipalId: principal._id,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert("contextItemVersions", {
      organizationId: identity.organizationId,
      requestId: request.requestId,
      contextItemId,
      ordinal: 1,
      kind: "source_summary",
      title: "Expert interview brief",
      bulletPoints: ["Compare lender-first and lawyer-first recovery paths."],
      citations: [],
      actorPrincipalId: principal._id,
      credentialId: "ticket-09-mcp-operator",
      correlationId: `mcp-context-${crypto.randomUUID()}`,
      createdAt: 1,
    })

    const submissions = []
    for (const respondent of [
      {
        displayName: "Alex Lawyer-First",
        email: "alex-lawyer-first@example.test",
        answer: "Call the closing lawyer first.",
      },
      {
        displayName: "Blair Lender-First",
        email: "blair-lender-first@example.test",
        answer: "Call the lender closing desk first.",
      },
    ]) {
      const personId = await ctx.db.insert("people", {
        organizationId: identity.organizationId,
        displayName: respondent.displayName,
        normalizedDisplayName: respondent.displayName.toLowerCase(),
        email: respondent.email,
        normalizedEmail: respondent.email,
        searchText:
          `${respondent.displayName} ${respondent.email}`.toLowerCase(),
        isFounder: false,
        createdAt: 1,
        updatedAt: 1,
      })
      const grantId = await ctx.db.insert("guestAccessGrants", {
        organizationId: identity.organizationId,
        requestId: request.requestId,
        assignedPersonId: personId,
        currentTokenHash: `hash-${crypto.randomUUID()}`,
        tokenVersion: 1,
        expiresAt: Date.now() + 48 * 60 * 60 * 1_000,
        state: "submitted",
        createdByPrincipalId: principal._id,
        createdAt: 1,
        updatedAt: 2,
        latestActivityAt: 2,
      })
      const workspaceId = await ctx.db.insert("responseWorkspaces", {
        organizationId: identity.organizationId,
        requestId: request.requestId,
        grantId,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [
          { questionId: "question-first-call", text: respondent.answer },
        ],
        revision: 1,
        lockedAt: 2,
        createdAt: 1,
        updatedAt: 2,
      })
      const submissionId = await ctx.db.insert("responseSubmissions", {
        organizationId: identity.organizationId,
        requestId: request.requestId,
        requestHumanId: request.humanId,
        grantId,
        workspaceId,
        assignedPersonId: personId,
        respondentDisplayName: respondent.displayName,
        respondentEmail: respondent.email,
        workspaceRevision: 1,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [
          { questionId: "question-first-call", text: respondent.answer },
        ],
        questions: [
          {
            questionId: "question-first-call",
            question: "Who do you call first?",
            motivation: "Expose the real recovery sequence.",
            position: 0,
            version: 1,
          },
        ],
        assetSnapshots: [],
        submittedAt: 2,
      })
      submissions.push(submissionId)
    }
    return { submissionIds: submissions }
  })
  return { backend, request, ...seeded }
}

describe("Expert Synthesis MCP and backend integration", () => {
  it("processes and persists two attributable respondents through JSON-RPC, the shared service, and Convex", async () => {
    const { backend, request, submissionIds } =
      await seedTwoRespondentInterview()
    const repository = await createConvexTestContentRequestRepository(identity)
    const service = createContentRequestService(repository, "chatgpt_app")
    const app = createChatGptAppHandler(async () => service, {
      confirmationSecret:
        "ticket-09-mcp-confirmation-secret-with-at-least-32-bytes",
    })
    const call = async (
      operation: string,
      argumentsValue: Record<string, unknown>,
      idempotencyKey: string
    ) => {
      const response = await app.POST({
        request: rpc({
          name:
            operation === "expert_interview.submission_selection"
              ? "content_requests_update"
              : "content_requests_create",
          arguments: {
            command: {
              operation,
              arguments: argumentsValue,
              idempotencyKey,
            },
          },
        }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        result: {
          isError?: boolean
          structuredContent: {
            ok: boolean
            data: Record<string, unknown>
          }
        }
      }
      if (!body.result?.structuredContent)
        throw new Error(`Unexpected MCP response: ${JSON.stringify(body)}`)
      return body
    }

    const summaries = await call(
      "expert_interview.submissions",
      { humanId: request.humanId },
      `mcp-list-${request.humanId}`
    )
    const summaryPayload = JSON.stringify(
      summaries.result.structuredContent.data
    )
    expect(summaryPayload).not.toContain("Call the closing lawyer first.")
    expect(summaryPayload).not.toContain("Call the lender closing desk first.")
    expect(summaryPayload).not.toContain("questionAnswers")
    expect(summaryPayload).not.toContain("batchText")
    expect(summaryPayload).not.toContain('"assets"')

    for (const [index, submissionId] of submissionIds.entries()) {
      const selection = await call(
        "expert_interview.submission_selection",
        {
          humanId: request.humanId,
          submissionId,
          included: true,
        },
        `mcp-select-${request.humanId}-${index}`
      )
      expect(selection.result.structuredContent.ok).toBe(true)
      expect(
        JSON.stringify(selection.result.structuredContent.data)
      ).not.toContain("Call the")
    }

    const processing = await call(
      "expert_interview.processing_input",
      {
        humanId: request.humanId,
        submissionIds,
        synthesisInstructions: "Preserve the first-call disagreement.",
      },
      `mcp-prepare-${request.humanId}`
    )
    const processingData = processing.result.structuredContent.data as {
      payloadDigest: string
      processingSnapshot: {
        processingToken: string
        canonicalBundle: string
      }
    }
    expect(processingData.processingSnapshot.canonicalBundle).toContain(
      "Alex Lawyer-First"
    )
    expect(processingData.processingSnapshot.canonicalBundle).toContain(
      "Blair Lender-First"
    )

    const completionBody =
      "# Attributed recovery sequence\n\nAlex calls the lawyer first; Blair calls the lender closing desk first."
    const completion = await call(
      "expert_interview.complete_processing",
      {
        humanId: request.humanId,
        submissionIds,
        processingToken: processingData.processingSnapshot.processingToken,
        payloadDigest: processingData.payloadDigest,
        body: completionBody,
      },
      `mcp-complete-${request.humanId}`
    )
    const completionData = completion.result.structuredContent.data as {
      deliverable: { versions: Array<{ body: string }> }
      attribution: {
        submissionIds: Array<string>
        provenanceId: string
      }
    }
    expect(completionData.attribution.submissionIds).toEqual(submissionIds)
    expect(completionData.deliverable.versions.at(-1)?.body).toBe(
      completionBody
    )

    const persisted = await backend.run(async (ctx) => {
      const provenance = await ctx.db
        .query("expertSynthesisProvenance")
        .withIndex("by_request_created_at", (index) =>
          index.eq("requestId", request.requestId)
        )
        .unique()
      const version = provenance ? await ctx.db.get(provenance.versionId) : null
      return { provenance, version }
    })
    expect(persisted.provenance?.submissionIds).toEqual(submissionIds)
    expect(persisted.version?.body).toBe(completionBody)
    expect(JSON.stringify(persisted.provenance)).not.toContain(completionBody)
  })

  it("conditionally claims a queued founder job through the real service and repository before completing", async () => {
    const { backend, request, submissionIds } =
      await seedTwoRespondentInterview()
    const repository = await createConvexTestContentRequestRepository(identity)
    const service = createContentRequestService(repository, "chatgpt_app")
    for (const [index, submissionId] of submissionIds.entries())
      await service.setExpertInterviewSubmissionInclusion({
        humanId: request.humanId,
        submissionId,
        included: true,
        correlationId: `conditional-claim-select-${request.humanId}-${index}`,
      })
    const processing = await prepareExpertInterviewProcessing(service, {
      humanId: request.humanId,
      submissionIds,
      synthesisInstructions: "Keep both practitioner sequences attributable.",
      correlationId: `conditional-claim-prepare-${request.humanId}`,
    })
    const queuedJobId = await backend.run(async (ctx) => {
      const principal = await ctx.db
        .query("principals")
        .withIndex("by_organization_subject", (index) =>
          index
            .eq("organizationId", identity.organizationId)
            .eq("subject", identity.subject)
        )
        .unique()
      if (!principal) throw new Error("MCP operator principal was not synced")
      const now = Date.now()
      const documentId = await ctx.db.insert("founderInputDocuments", {
        organizationId: identity.organizationId,
        requestId: request.requestId,
        founderPrincipalId: principal._id,
        text: "Founder evidence queued for synthesis.",
        revision: 1,
        hasMeaningfulDraft: true,
        createdAt: now,
        updatedAt: now,
      })
      const founderVersionId = await ctx.db.insert("founderInputVersions", {
        organizationId: identity.organizationId,
        requestId: request.requestId,
        documentId,
        text: "Founder evidence queued for synthesis.",
        heads: ["conditional-claim-head"],
        revision: 1,
        actorPrincipalId: principal._id,
        actorSubject: principal.subject,
        correlationId: `conditional-claim-founder-version-${request.humanId}`,
        occurredAt: now,
      })
      return ctx.db.insert("agentJobs", {
        organizationId: identity.organizationId,
        requestId: request.requestId,
        requestTitle: request.title,
        type: "primary_response",
        status: "queued",
        founderVersionId,
        contextSnapshot: [],
        attempts: 0,
        maxAttempts: 3,
        leaseGeneration: 0,
        claimableAt: now,
        createdAt: now,
        updatedAt: now,
      })
    })
    const leaseToken = `conditional-claim-lease-${crypto.randomUUID()}`
    const completionBody =
      "# Conditional founder-job completion\n\nBoth respondents remain attributable."
    const completionInput = {
      humanId: request.humanId,
      submissionIds,
      processingToken: processing.processingSnapshot.processingToken,
      payloadDigest: processing.payloadDigest,
      body: completionBody,
      correlationId: `conditional-claim-complete-${request.humanId}`,
    }
    await expect(
      service.commitExpertSynthesis(completionInput)
    ).rejects.toThrow("EXPERT_INTERVIEW_AGENT_JOB_LEASE_REQUIRED")
    const completed = await completeExpertInterviewProcessingWithLease(
      service,
      {
        ...completionInput,
        jobLeaseToken: leaseToken,
      }
    )

    expect(completed.deliverable.versions.at(-1)?.body).toBe(completionBody)
    const persisted = await backend.run(async (ctx) => {
      const job = await ctx.db.get(queuedJobId)
      const leaseEvents = await ctx.db
        .query("agentJobLeaseEvents")
        .withIndex("by_job_occurred_at", (index) =>
          index.eq("jobId", queuedJobId)
        )
        .collect()
      const version = job?.resultVersionId
        ? await ctx.db.get(job.resultVersionId)
        : null
      return { job, leaseEvents, version }
    })
    expect(persisted.job).toMatchObject({
      status: "completed",
      attempts: 1,
      leaseGeneration: 1,
    })
    expect(persisted.job?.leaseToken).toBeUndefined()
    expect(persisted.leaseEvents).toEqual([
      expect.objectContaining({ event: "claimed", leaseGeneration: 1 }),
    ])
    expect(persisted.version).toMatchObject({
      sourceJobId: queuedJobId,
      body: completionBody,
    })
  })
})
