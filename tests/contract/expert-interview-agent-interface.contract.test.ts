import { describe, expect, it, vi } from "vitest"

import {
  agentControlOperations,
  executeAgentControlCommand,
} from "@/application/agent-control-plane"
import { createChatGptAppHandler } from "@/application/chatgpt-app"
import type {
  ContentContextItem,
  ContentRequest,
  ContentRequestService,
} from "@/application/content-requests"
import {
  buildExpertInterviewResearchPrompt,
  completeExpertInterviewProcessing,
  createExpertInterview,
  prepareExpertInterviewProcessing,
  type CreateExpertInterviewInput,
  type ExpertInterviewSubmissionEvidence,
  type ExpertSynthesisCanonicalBundle,
} from "@/application/expert-interviews"
import { runContentRequestsCli } from "@/cli/content-requests"

function service(methods: Record<string, unknown>) {
  return methods as unknown as ContentRequestService
}

const request = {
  requestId: "request-1",
  humanId: "CR-0241",
  title: "How bridge financing actually works when the timeline breaks",
  aliases: [],
  requestType: "standard",
  origin: "cli",
  priority: "normal",
  lifecycle: "pending",
  disposition: "active",
  retention: "active",
  expiresAt: null,
  expiredAt: null,
  expirationReason: null,
  expirationReviewRequiredAt: null,
  archivedAt: null,
  parentRequestHumanId: null,
  aggregateVersion: 1,
  assignee: {
    principalId: "founder-1",
    subject: "elie@example.com",
    role: "founder",
  },
  watchers: [],
  firstOpenedAt: null,
  latestOpenedAt: null,
  hasFounderDraft: false,
  founderDraftUpdatedAt: null,
  source: null,
  createdAt: 1,
  updatedAt: 1,
} as ContentRequest

const input: CreateExpertInterviewInput = {
  title: request.title,
  brief: {
    topic: "Bridge financing when a bank closing is delayed",
    summary: "A practical Ontario guide to recovering a time-sensitive deal.",
    audience: "Ontario mortgage brokers and borrowers",
    framing: "insider_knowledge",
    fairlendPosture: "Useful first; commercial relevance disclosed.",
    founderContribution: "A real recovery sequence and decision criteria.",
  },
  gaps: [
    {
      id: "gap-1",
      kind: "reality_on_the_ground",
      title: "The official process stops before the recovery work begins",
      existingCoverage: "Guides explain eligibility and standard timelines.",
      whyItFallsShort: "They do not explain a live closing failure.",
      expertOpportunity: "Explain who gets called, in what order, and why.",
      citations: [
        {
          label: "Ontario guidance",
          url: "https://example.test/guidance",
          supports: "Standard disclosure obligations",
        },
      ],
    },
  ],
  questions: [
    {
      id: "q-1",
      question: "What do you do in the first hour after the bank slips?",
      motivation: "Capture the recovery sequence missing from indexed guides.",
      gapIds: ["gap-1"],
    },
  ],
  operatorInstructions: "Use an Ontario broker's point of view.",
  correlationId: "expert-1",
}

function contextItem(
  contextId: string,
  kind: ContentContextItem["kind"],
  title: string,
  bulletPoints: Array<string>
): ContentContextItem {
  return { contextId, kind, title, bulletPoints, citations: [] }
}

async function processingSnapshot(inputValue: {
  selectedSubmissions: Array<ExpertInterviewSubmissionEvidence>
  context: Array<ContentContextItem>
  priorityInstructions: Array<string>
}) {
  const expertInterview = {
    expertInterviewId: "expert-1",
    requestHumanId: request.humanId,
    brief: input.brief,
    gaps: input.gaps,
    questions: input.questions,
    operatorInstructions: input.operatorInstructions ?? null,
    createdAt: 1,
    updatedAt: 1,
  }
  const contextVersions = inputValue.context.map((entry, index) => ({
    ...entry,
    contextVersionId: `context-version-${index + 1}`,
    ordinal: 1,
    createdAt: index + 1,
  }))
  const canonicalBundle = JSON.stringify({
    version: 1,
    request: {
      requestId: request.requestId,
      humanId: request.humanId,
      title: request.title,
      requestType: "expert_interview",
    },
    expertInterview,
    contextVersions,
    selectedSubmissions: inputValue.selectedSubmissions,
    selectionDecisions: inputValue.selectedSubmissions.map((entry) => ({
      decisionId: `decision-${entry.submissionId}`,
      submissionId: entry.submissionId,
      state: "included",
      decidedBy: { principalId: "operator-1", displayName: "Operator" },
      decidedAt: 20,
    })),
    existingDeliverables: [],
    priorityInstructions: inputValue.priorityInstructions,
  } satisfies ExpertSynthesisCanonicalBundle)
  const payloadDigest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalBundle)
      )
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")
  return {
    snapshotId: "snapshot-1",
    processingToken: "signed-processing-snapshot",
    submissionIds: inputValue.selectedSubmissions.map(
      ({ submissionId }) => submissionId
    ),
    contextVersionIds: contextVersions.map(
      ({ contextVersionId }) => contextVersionId
    ),
    payloadDigest,
    canonicalBundle,
    issuedAt: 100,
    expiresAt: 200,
  }
}

describe("expert-interview local-agent interface", () => {
  it("publishes prompt-first creation and completed-processing operations", () => {
    expect(agentControlOperations).toEqual(
      expect.arrayContaining([
        "expert_interview.research_prompt",
        "expert_interview.create",
        "expert_interview.processing_input",
        "expert_interview.complete_processing",
      ])
    )
    const prompt = buildExpertInterviewResearchPrompt({
      topic: "Bridge financing",
      operatorInstructions: "Prioritize Ontario-specific evidence.",
    })
    expect(prompt).toContain("OPERATOR-DIRECTED PRIORITY INSTRUCTIONS")
    expect(prompt).toContain("Prioritize Ontario-specific evidence.")
    expect(prompt).toContain("CreateExpertInterviewInput-compatible JSON")
  })

  it("creates a Critical request and persists the brief, gaps, motivations, and agent instructions", async () => {
    const createManual = vi.fn().mockResolvedValue(request)
    const update = vi.fn().mockResolvedValue({
      ...request,
      requestType: "expert_interview",
      priority: "critical",
    })
    const saveExpertInterviewPackage = vi.fn().mockResolvedValue({
      expertInterviewId: "expert-1",
      requestHumanId: request.humanId,
      ...input,
      createdAt: 1,
      updatedAt: 1,
    })
    const upsertContext = vi.fn().mockImplementation(
      async (
        value: Omit<ContentContextItem, "contextId"> & {
          correlationId: string
        }
      ) => ({ ...value, contextId: value.correlationId })
    )
    const currentRequest = {
      ...request,
      requestType: "expert_interview" as const,
      priority: "critical" as const,
      aggregateVersion: 6,
      updatedAt: 6,
    }
    const result = await createExpertInterview(
      service({
        createManual,
        update,
        saveExpertInterviewPackage,
        upsertContext,
        getByHumanId: vi.fn().mockResolvedValue(currentRequest),
      }),
      input
    )

    expect(createManual).toHaveBeenCalledWith(
      expect.objectContaining({
        title: input.title,
        correlationId: "expert-1:request",
        source: expect.objectContaining({ channel: "expert_interview" }),
      })
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        humanId: "CR-0241",
        priority: "critical",
      })
    )
    expect(saveExpertInterviewPackage).toHaveBeenCalledWith({
      humanId: "CR-0241",
      brief: input.brief,
      gaps: input.gaps,
      questions: input.questions,
      operatorInstructions: input.operatorInstructions,
      correlationId: "expert-1:package",
    })
    expect(upsertContext).toHaveBeenCalledTimes(4)
    expect(upsertContext).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Interview question · q-1",
        bulletPoints: expect.arrayContaining([
          expect.stringContaining("Question:"),
          expect.stringContaining("Motivation:"),
        ]),
      })
    )
    expect(result.request.priority).toBe("critical")
    expect(result.request.requestType).toBe("expert_interview")
    expect(result.request.aggregateVersion).toBe(6)
    expect(result.expertInterview.package.operatorInstructions).toBe(
      "Use an Ontario broker's point of view."
    )
    expect(result.next.prepareProcessing).toBe(
      "expert_interview.processing_input"
    )
  })

  it("rejects an invalid complete package before creating a request", async () => {
    const createManual = vi.fn()
    await expect(
      createExpertInterview(service({ createManual }), {
        ...input,
        brief: {
          ...input.brief,
          framing:
            "unsupported" as CreateExpertInterviewInput["brief"]["framing"],
        },
      })
    ).rejects.toThrow("INVALID_EXPERT_INTERVIEW_FRAMING")
    expect(createManual).not.toHaveBeenCalled()
  })

  it("rejects oversized nested package data before invoking any mutation", async () => {
    const createManual = vi.fn()
    await expect(
      createExpertInterview(service({ createManual }), {
        ...input,
        brief: {
          ...input.brief,
          summary: "x".repeat(10_001),
        },
      })
    ).rejects.toThrow("EXPERT_INTERVIEW_TEXT_TOO_LONG")
    expect(createManual).not.toHaveBeenCalled()
  })

  it("classifies processing from the durable request and package instead of context titles", async () => {
    const createExpertSynthesisProcessingSnapshot = vi
      .fn()
      .mockRejectedValue(new Error("NOT_AN_EXPERT_INTERVIEW"))

    await expect(
      prepareExpertInterviewProcessing(
        service({
          getByHumanId: vi.fn().mockResolvedValue({
            ...request,
            title: "A title with no expert-interview convention",
            requestType: "standard",
          }),
          createExpertSynthesisProcessingSnapshot,
        }),
        {
          humanId: request.humanId,
          submissionIds: ["submission-1"],
          correlationId: "prepare-non-expert",
        }
      )
    ).rejects.toThrow("NOT_AN_EXPERT_INTERVIEW")
    expect(createExpertSynthesisProcessingSnapshot).toHaveBeenCalledWith({
      humanId: request.humanId,
      submissionIds: ["submission-1"],
      synthesisInstructions: undefined,
      correlationId: "prepare-non-expert",
    })
  })

  it("returns a response-aware synthesis prompt and persists the processed draft with attribution", async () => {
    const contexts = [
      contextItem("brief-1", "source_summary", "Expert interview brief", [
        "Topic: Bridge financing",
      ]),
      contextItem(
        "gap-1",
        "missing_research",
        "Knowledge gap · gap-1 · Recovery sequence",
        ["Expert opportunity: explain the live sequence"]
      ),
      contextItem("question-1", "talking_points", "Interview question · q-1", [
        "Question: What happens first?",
        "Motivation: Capture the sequence.",
      ]),
    ]
    const immutableSubmission = {
      submissionId: "submission-1",
      source: "guest" as const,
      requestHumanId: "CR-0241",
      respondent: {
        personId: "person-founder",
        displayName: "Elie Tchitava",
        email: "elie@fairlend.ca",
      },
      workspaceRevision: 3,
      answerMode: "one_by_one" as const,
      batchText: "",
      questionAnswers: [
        {
          questionId: "q-1",
          text: "I call the closing lawyer first, then confirm the exact shortfall.",
        },
      ],
      questions: [
        {
          questionId: "q-1",
          question: "What happens first?",
          motivation: "Capture the sequence.",
          position: 0,
          version: 1,
        },
      ],
      assets: [],
      progress: { completed: 1, total: 1 },
      sourceSummary: "1 of 1 answers complete",
      inclusion: {
        state: "included" as const,
        decidedBy: {
          principalId: "operator-1",
          displayName: "Operator",
        },
        decidedAt: 20,
      },
      submittedAt: 20,
    }
    const completedDeliverable = {
      deliverableId: "deliverable-1",
      requestHumanId: "CR-0241",
      kind: "blog_article",
      name: "Expert interview article draft",
      isPrimary: false,
      currentCandidateVersionId: "deliverable-version-1",
      promotedVersionId: null,
      versions: [],
      createdAt: 1,
      updatedAt: 1,
    } as const
    const frozenSnapshot = await processingSnapshot({
      selectedSubmissions: [immutableSubmission],
      context: contexts,
      priorityInstructions: [
        input.operatorInstructions!,
        "Lead with the first-hour checklist.",
      ],
    })
    const commitExpertSynthesis = vi.fn().mockResolvedValue({
      deliverable: completedDeliverable,
      provenance: {
        provenanceId: "provenance-1",
        deliverableId: "deliverable-1",
        versionId: "deliverable-version-1",
        processingSnapshotId: frozenSnapshot.snapshotId,
        submissionIds: ["submission-1"],
        contextVersionIds: frozenSnapshot.contextVersionIds,
        payloadDigest: frozenSnapshot.payloadDigest,
        canonicalBundle: frozenSnapshot.canonicalBundle,
      },
    })
    const methods = {
      getByHumanId: vi.fn().mockResolvedValue({
        ...request,
        requestType: "expert_interview",
        priority: "critical",
      }),
      getExpertInterview: vi.fn().mockResolvedValue({
        expertInterviewId: "expert-1",
        requestHumanId: request.humanId,
        brief: input.brief,
        gaps: input.gaps,
        questions: input.questions,
        operatorInstructions: input.operatorInstructions ?? null,
        createdAt: 1,
        updatedAt: 1,
      }),
      listContext: vi.fn().mockResolvedValue(contexts),
      listExpertInterviewSubmissions: vi
        .fn()
        .mockResolvedValue([immutableSubmission]),
      listExpertInterviewContextVersionIds: vi
        .fn()
        .mockResolvedValue(["context-version-1"]),
      createExpertSynthesisProcessingSnapshot: vi
        .fn()
        .mockResolvedValue(frozenSnapshot),
      listDeliverables: vi.fn().mockResolvedValue([]),
      commitExpertSynthesis,
    }
    const processing = await prepareExpertInterviewProcessing(
      service(methods),
      {
        humanId: "CR-0241",
        submissionIds: ["submission-1"],
        synthesisInstructions: "Lead with the first-hour checklist.",
        correlationId: "prepare-response-aware-synthesis",
      }
    )
    expect(processing.prompt).toContain(
      immutableSubmission.questions[0]!.question
    )
    expect(processing.prompt).not.toContain(input.questions[0].question)
    expect(processing.prompt.indexOf(input.operatorInstructions!)).toBeLessThan(
      processing.prompt.indexOf("SYNTHESIS RULES")
    )
    expect(processing.prompt).toContain("Lead with the first-hour checklist.")
    expect(
      processing.selectedSubmissions[0]?.questionAnswers[0]?.text
    ).toContain("closing lawyer")

    const completed = await completeExpertInterviewProcessing(
      service(methods),
      {
        humanId: "CR-0241",
        submissionIds: ["submission-1"],
        processingToken: processing.processingSnapshot.processingToken,
        payloadDigest: processing.payloadDigest,
        body: "# Draft\n\nPublication-ready copy.",
        correlationId: "process-1",
      }
    )
    expect(commitExpertSynthesis).toHaveBeenCalledWith({
      humanId: "CR-0241",
      submissionIds: ["submission-1"],
      processingToken: "signed-processing-snapshot",
      payloadDigest: processing.payloadDigest,
      body: "# Draft\n\nPublication-ready copy.",
      correlationId: "process-1",
    })
    expect(completed.attribution).toEqual({
      submissionIds: ["submission-1"],
      contextVersionIds: frozenSnapshot.contextVersionIds,
      payloadDigest: frozenSnapshot.payloadDigest,
      provenanceId: "provenance-1",
      questionContextIds: ["question-1"],
      gapContextIds: ["gap-1"],
    })
    expect(methods.getByHumanId).not.toHaveBeenCalled()
    expect(methods.listContext).not.toHaveBeenCalled()
  })

  it("maps the ergonomic CLI commands to the same prompt-bearing control operations", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => Response.json({ data: {} }))
    const options = {
      fetchImpl,
      env: {
        CONTENT_REQUESTS_API_URL: "https://fairlend.test",
        CONTENT_REQUESTS_ACCESS_TOKEN: "agent-token",
      },
      readFile: vi
        .fn()
        .mockImplementation(async (path: string) =>
          path.endsWith(".json")
            ? JSON.stringify(input)
            : "# Completed interview draft"
        ),
      io: { writeOut: vi.fn(), writeError: vi.fn() },
    }
    await runContentRequestsCli(
      [
        "expert-research-prompt",
        "--topic",
        "Bridge financing",
        "--instructions",
        "Ontario first",
      ],
      options
    )
    await runContentRequestsCli(
      [
        "expert-create",
        "--file",
        "expert.json",
        "--idempotency-key",
        "expert-create-1",
      ],
      options
    )
    await runContentRequestsCli(
      [
        "expert-processing-complete",
        "CR-0241",
        "--submissions",
        "submission-1",
        "--processing-token",
        "signed-processing-snapshot",
        "--payload-digest",
        "a".repeat(64),
        "--job-id",
        "job-founder-1",
        "--lease-token",
        "active-founder-lease",
        "--lease-generation",
        "3",
        "--file",
        "draft.md",
        "--idempotency-key",
        "expert-process-1",
      ],
      options
    )

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://fairlend.test/api/v1/cli/control",
      expect.objectContaining({
        body: expect.stringContaining("expert_interview.research_prompt"),
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://fairlend.test/api/v1/cli/control",
      expect.objectContaining({
        body: expect.stringContaining("expert_interview.create"),
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://fairlend.test/api/v1/cli/control",
      expect.objectContaining({
        body: expect.stringContaining("expert_interview.complete_processing"),
      })
    )
  })

  it("executes the research prompt through the generic MCP/HTTP operation contract", async () => {
    const result = await executeAgentControlCommand(service({}), {
      operation: "expert_interview.research_prompt",
      arguments: { topic: "Bridge financing", geography: "Ontario" },
    })
    expect(result).toEqual(
      expect.objectContaining({
        nextOperation: "expert_interview.create",
        prompt: expect.stringContaining("Geography: Ontario"),
      })
    )
  })

  it("publishes native MCP prompts for research and completed-interview synthesis", async () => {
    const app = createChatGptAppHandler(
      async () => service({ list: vi.fn().mockResolvedValue([]) }),
      {
        confirmationSecret: "test-confirmation-secret-that-is-long-enough",
      }
    )
    const request = (method: string, params?: Record<string, unknown>) =>
      new Request("https://fairlend.test/api/chatgpt/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer agent",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          origin: "https://chatgpt.com",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      })
    const listResponse = await app.POST({
      request: request("prompts/list"),
    })
    expect(listResponse.status).toBe(200)
    const list = (await listResponse.json()) as {
      result: { prompts: Array<{ name: string }> }
    }
    expect(list.result.prompts.map(({ name }) => name)).toEqual([
      "expert_interview_research",
      "expert_interview_synthesis",
    ])

    const promptResponse = await app.POST({
      request: request("prompts/get", {
        name: "expert_interview_research",
        arguments: {
          topic: "Bridge financing",
          operatorInstructions: "Ontario first",
        },
      }),
    })
    const prompt = (await promptResponse.json()) as {
      result: { messages: Array<{ content: { text: string } }> }
    }
    expect(prompt.result.messages[0]?.content.text).toContain("Ontario first")
    expect(prompt.result.messages[0]?.content.text).toContain(
      "OPERATOR-DIRECTED PRIORITY"
    )
  })
})
