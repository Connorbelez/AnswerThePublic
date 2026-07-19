import { describe, expect, it, vi } from "vitest"

import {
  createAgentJobCollectionHandler,
  createAgentJobItemHandler,
  createContentRequestCollectionHandler,
} from "@/application/content-request-http"
import type { ContentRequestService } from "@/application/content-requests"
import { runContentRequestsCli } from "@/cli/content-requests"
import { AuthenticationRequiredError } from "@/application/workspace-session"

function serviceStub(overrides: Partial<ContentRequestService> = {}) {
  return {
    createManual: vi.fn(),
    getByHumanId: vi.fn(),
    list: vi.fn(),
    resolve: vi.fn(),
    assign: vi.fn(),
    open: vi.fn(),
    listAssignablePrincipals: vi.fn(),
    listMyNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    listContext: vi.fn(),
    getContextDeckPreferences: vi.fn(),
    saveContextDeckPreferences: vi.fn(),
    getFounderInput: vi.fn(),
    saveFounderText: vi.fn(),
    pullFounderAutomergeChanges: vi.fn(),
    submitFounderAutomergeChanges: vi.fn(),
    getFounderVersionHistory: vi.fn(),
    listFounderArchivedVersions: vi.fn(),
    restoreFounderArchivedVersion: vi.fn(),
    createFounderVoiceUploadUrl: vi.fn(),
    finalizeFounderVoiceCapture: vi.fn(),
    listFounderVoiceCaptures: vi.fn(),
    retryFounderVoiceCapture: vi.fn(),
    markFounderVoiceTranscriptMerged: vi.fn(),
    discardFounderVoiceCapture: vi.fn(),
    undoFounderInput: vi.fn(),
    redoFounderInput: vi.fn(),
    assertFounderInputSynced: vi.fn(),
    submitFounderInput: vi.fn(),
    listAgentJobs: vi.fn(),
    claimAgentJob: vi.fn(),
    heartbeatAgentJob: vi.fn(),
    getAgentJobInput: vi.fn(),
    completeAgentJob: vi.fn(),
    failAgentJob: vi.fn(),
    proposeAssigneeChange: vi.fn(),
    listOpenSemanticConflicts: vi.fn(),
    resolveSemanticConflict: vi.fn(),
    ...overrides,
  } satisfies ContentRequestService
}

describe("Content Request adapter contracts", () => {
  it("maps an HTTP manual-create body and correlation ID to the shared service", async () => {
    const createManual = vi.fn().mockResolvedValue({ humanId: "CR-123" })
    const handlers = createContentRequestCollectionHandler(async () =>
      serviceStub({ createManual })
    )
    const response = await handlers.POST({
      request: new Request("https://fairlend.test/api/v1/content-requests", {
        method: "POST",
        headers: { "x-correlation-id": "corr-http-1" },
        body: JSON.stringify({ title: "Direct from HTTP" }),
      }),
    })

    expect(response.status).toBe(201)
    expect(createManual).toHaveBeenCalledWith({
      title: "Direct from HTTP",
      source: undefined,
      aliases: undefined,
      correlationId: "corr-http-1",
    })
    await expect(response.json()).resolves.toEqual({
      data: { humanId: "CR-123" },
    })
  })

  it("returns a disambiguation exit code when CLI fuzzy lookup has candidates", async () => {
    const output: Array<string> = []
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          kind: "candidates",
          candidates: [{ humanId: "CR-1" }, { humanId: "CR-2" }],
        },
      })
    )

    const exitCode = await runContentRequestsCli(
      ["find", "mortgage", "renewal"],
      {
        fetchImpl,
        env: {
          CONTENT_REQUESTS_API_URL: "https://fairlend.test",
          CONTENT_REQUESTS_ACCESS_TOKEN: "test-token",
        },
        io: { writeOut: (value) => output.push(value), writeError: vi.fn() },
      }
    )

    expect(exitCode).toBe(2)
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://fairlend.test/api/v1/cli/content-requests?q=mortgage%20renewal",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
        }),
      })
    )
    expect(JSON.parse(output[0])).toMatchObject({
      data: { kind: "candidates" },
    })
  })

  it("returns safe 4xx errors for invalid query parameters and authentication", async () => {
    const invalidHandlers = createContentRequestCollectionHandler(async () =>
      serviceStub()
    )
    const invalidLimit = await invalidHandlers.GET({
      request: new Request(
        "https://fairlend.test/api/v1/content-requests?limit=not-a-number"
      ),
    })
    expect(invalidLimit.status).toBe(400)
    await expect(invalidLimit.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Query parameters are invalid.",
      },
    })

    const authHandlers = createContentRequestCollectionHandler(async () => {
      throw new AuthenticationRequiredError()
    })
    const unauthorized = await authHandlers.GET({
      request: new Request("https://fairlend.test/api/v1/content-requests"),
    })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required.",
      },
    })
  })

  it("returns machine-readable source-collision remediation details", async () => {
    const handlers = createContentRequestCollectionHandler(async () =>
      serviceStub({
        createManual: vi.fn().mockRejectedValue({
          data: {
            code: "SOURCE_COLLISION_REQUIRES_REMEDIATION",
            requestHumanIds: ["CR-ONE", "CR-TWO"],
          },
        }),
      })
    )
    const response = await handlers.POST({
      request: new Request("https://fairlend.test/api/v1/content-requests", {
        method: "POST",
        body: JSON.stringify({ title: "Collision" }),
      }),
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "SOURCE_COLLISION_REQUIRES_REMEDIATION",
        conflictingRequestIds: ["CR-ONE", "CR-TWO"],
      },
    })
  })

  it("maps agent job claim, immutable input, and completion through HTTP", async () => {
    const claimAgentJob = vi.fn().mockResolvedValue({ jobId: "job-1" })
    const getAgentJobInput = vi.fn().mockResolvedValue({
      job: { jobId: "job-1" },
      founderInput: { versionId: "version-1", text: "Founder input" },
    })
    const completeAgentJob = vi.fn().mockResolvedValue({ status: "completed" })
    const collection = createAgentJobCollectionHandler(async () =>
      serviceStub({ claimAgentJob })
    )
    const item = createAgentJobItemHandler(async () =>
      serviceStub({ getAgentJobInput, completeAgentJob })
    )

    await collection.POST({
      request: new Request("https://fairlend.test/api/v1/agent-jobs", {
        method: "POST",
        body: JSON.stringify({
          action: "claim",
          leaseToken: "lease-1",
          leaseMs: 60_000,
        }),
      }),
    })
    await item.GET({
      request: new Request("https://fairlend.test/api/v1/agent-jobs/job-1"),
      params: { jobId: "job-1" },
    })
    await item.POST({
      request: new Request("https://fairlend.test/api/v1/agent-jobs/job-1", {
        method: "POST",
        headers: { "x-correlation-id": "complete-1" },
        body: JSON.stringify({
          action: "complete",
          leaseToken: "lease-1",
          leaseGeneration: 1,
          body: "Ready response",
        }),
      }),
      params: { jobId: "job-1" },
    })

    expect(claimAgentJob).toHaveBeenCalledWith("lease-1", 60_000)
    expect(getAgentJobInput).toHaveBeenCalledWith("job-1")
    expect(completeAgentJob).toHaveBeenCalledWith(
      "job-1",
      "lease-1",
      "Ready response",
      "complete-1",
      1
    )
  })

  it.each([
    ["NOT_FOUND", 404],
    ["LEASE_LOST", 409],
    ["RESOURCE_ACCESS_DENIED", 403],
  ])("maps job domain error %s to HTTP %s", async (code, status) => {
    const item = createAgentJobItemHandler(async () =>
      serviceStub({
        getAgentJobInput: vi.fn().mockRejectedValue({ data: { code } }),
      })
    )
    const response = await item.GET({
      request: new Request("https://fairlend.test/api/v1/agent-jobs/job-1"),
      params: { jobId: "job-1" },
    })
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
  })
})
