import { describe, expect, it, vi } from "vitest"

import {
  createAgentJobCollectionHandler,
  createAgentJobItemHandler,
  createContentRequestCollectionHandler,
  createDeliverableCollectionHandler,
  createDeliverableItemHandler,
  createDeliveryTargetCollectionHandler,
  createDeliveryTargetItemHandler,
  createSemanticConflictCollectionHandler,
  createSemanticConflictItemHandler,
} from "@/application/content-request-http"
import type { ContentRequestService } from "@/application/content-requests"
import { runContentRequestsCli } from "@/cli/content-requests"
import { AuthenticationRequiredError } from "@/application/workspace-session"

function serviceStub(overrides: Partial<ContentRequestService> = {}) {
  return {
    createManual: vi.fn(),
    getByHumanId: vi.fn(),
    list: vi.fn(),
    listPage: vi.fn(),
    listOperatorWorkspace: vi.fn(),
    resolve: vi.fn(),
    update: vi.fn(),
    assign: vi.fn(),
    open: vi.fn(),
    setExpiration: vi.fn(),
    expire: vi.fn(),
    restoreExpired: vi.fn(),
    archive: vi.fn(),
    restoreArchived: vi.fn(),
    createFollowUp: vi.fn(),
    getRelations: vi.fn(),
    listAssignablePrincipals: vi.fn(),
    listMyNotifications: vi.fn(),
    listMyNotificationsPage: vi.fn(),
    markNotificationRead: vi.fn(),
    listAuditEvents: vi.fn(),
    listContext: vi.fn(),
    upsertContext: vi.fn(),
    listContextVersions: vi.fn(),
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
    listAgentJobsPage: vi.fn(),
    claimAgentJob: vi.fn(),
    heartbeatAgentJob: vi.fn(),
    getAgentJobInput: vi.fn(),
    completeAgentJob: vi.fn(),
    failAgentJob: vi.fn(),
    listDeliverables: vi.fn(),
    createDerivativeDeliverable: vi.fn(),
    createDeliverableVersion: vi.fn(),
    promoteDeliverableVersion: vi.fn(),
    setPrimaryDeliverable: vi.fn(),
    listDeliveryTargets: vi.fn(),
    listArchivedDeliveryTargets: vi.fn(),
    createDeliveryTarget: vi.fn(),
    setDeliveryTargetRequired: vi.fn(),
    setDeliveryTargetRetention: vi.fn(),
    listPublicShares: vi.fn(),
    createPublicShare: vi.fn(),
    revokePublicShare: vi.fn(),
    confirmDeliveryTarget: vi.fn(),
    reopenDeliveryTarget: vi.fn(),
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

  it("maps deliverable candidate creation and promotion through the shared service", async () => {
    const createDeliverableVersion = vi.fn().mockResolvedValue({
      deliverableId: "deliverable-1",
      currentCandidateVersionId: "version-2",
      promotedVersionId: "version-1",
    })
    const promoteDeliverableVersion = vi.fn().mockResolvedValue({
      deliverableId: "deliverable-1",
      promotedVersionId: "version-2",
    })
    const item = createDeliverableItemHandler(async () =>
      serviceStub({ createDeliverableVersion, promoteDeliverableVersion })
    )
    await item.POST({
      request: new Request(
        "https://fairlend.test/api/v1/deliverables/deliverable-1",
        {
          method: "POST",
          body: JSON.stringify({
            action: "create_version",
            body: "Candidate body",
            correlationId: "candidate-2",
          }),
        }
      ),
      params: { deliverableId: "deliverable-1" },
    })
    await item.POST({
      request: new Request(
        "https://fairlend.test/api/v1/deliverables/deliverable-1",
        {
          method: "POST",
          body: JSON.stringify({
            action: "promote",
            versionId: "version-2",
            expectedPromotedVersionId: "version-1",
            correlationId: "promote-2",
          }),
        }
      ),
      params: { deliverableId: "deliverable-1" },
    })
    expect(createDeliverableVersion).toHaveBeenCalledWith({
      deliverableId: "deliverable-1",
      body: "Candidate body",
      changeSummary: undefined,
      correlationId: "candidate-2",
    })
    expect(promoteDeliverableVersion).toHaveBeenCalledWith({
      deliverableId: "deliverable-1",
      versionId: "version-2",
      expectedPromotedVersionId: "version-1",
      correlationId: "promote-2",
    })

    const listDeliverables = vi.fn().mockResolvedValue([])
    const collection = createDeliverableCollectionHandler(async () =>
      serviceStub({ listDeliverables })
    )
    await collection.GET({
      request: new Request(
        "https://fairlend.test/api/v1/content-requests/CR-1/deliverables"
      ),
      params: { requestId: "CR-1" },
    })
    expect(listDeliverables).toHaveBeenCalledWith("CR-1")
  })

  it("preserves deliverable idempotency and compare-and-propose values in the CLI", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ data: {} })))
    const options = {
      fetchImpl,
      env: {
        CONTENT_REQUESTS_API_URL: "https://fairlend.test",
        CONTENT_REQUESTS_ACCESS_TOKEN: "test-token",
      },
      io: { writeOut: vi.fn(), writeError: vi.fn() },
    }
    await runContentRequestsCli(
      [
        "promote",
        "deliverable-1",
        "--version-id",
        "version-2",
        "--expected-version-id",
        "version-1",
        "--idempotency-key",
        "stable-promotion",
      ],
      options
    )
    const request = fetchImpl.mock.calls[0][1] as RequestInit
    expect(JSON.parse(request.body as string)).toEqual({
      action: "promote",
      versionId: "version-2",
      expectedPromotedVersionId: "version-1",
      correlationId: "stable-promotion",
    })
  })

  it("maps a post-delivery primary reassignment to HTTP 409", async () => {
    const collection = createDeliverableCollectionHandler(async () =>
      serviceStub({
        setPrimaryDeliverable: vi.fn().mockRejectedValue({
          data: { code: "DELIVERED_PRIMARY_LOCKED" },
        }),
      })
    )
    const response = await collection.POST({
      request: new Request(
        "https://fairlend.test/api/v1/content-requests/CR-1/deliverables",
        {
          method: "POST",
          body: JSON.stringify({
            action: "set_primary",
            deliverableId: "deliverable-2",
            expectedPrimaryDeliverableId: "deliverable-1",
            correlationId: "locked-primary",
          }),
        }
      ),
      params: { requestId: "CR-1" },
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DELIVERED_PRIMARY_LOCKED" },
    })
  })

  it("lists and resolves durable semantic conflicts through HTTP and CLI", async () => {
    const conflict = {
      conflictId: "conflict-1",
      requestHumanId: "CR-1",
      field: "primaryDeliverableId" as const,
      currentValue: "deliverable-1",
      proposedValue: "deliverable-2",
      expectedValue: "deliverable-0",
      status: "open" as const,
      correlationId: "stale-primary",
      createdAt: 1,
      resolvedValue: null,
      resolvedAt: null,
    }
    const listOpenSemanticConflicts = vi.fn().mockResolvedValue([conflict])
    const resolveSemanticConflict = vi.fn().mockResolvedValue({
      ...conflict,
      conflictId: "rebased-conflict",
      currentValue: "deliverable-3",
    })
    const collection = createSemanticConflictCollectionHandler(async () =>
      serviceStub({ listOpenSemanticConflicts })
    )
    const item = createSemanticConflictItemHandler(async () =>
      serviceStub({ resolveSemanticConflict })
    )
    const listed = await collection.GET({
      request: new Request(
        "https://fairlend.test/api/v1/content-requests/CR-1/semantic-conflicts"
      ),
      params: { requestId: "CR-1" },
    })
    expect(listOpenSemanticConflicts).toHaveBeenCalledWith("CR-1")
    await expect(listed.json()).resolves.toEqual({ data: [conflict] })

    const resolved = await item.POST({
      request: new Request(
        "https://fairlend.test/api/v1/semantic-conflicts/conflict-1",
        {
          method: "POST",
          body: JSON.stringify({
            action: "resolve",
            selectedValue: "deliverable-2",
            correlationId: "resolve-conflict",
          }),
        }
      ),
      params: { conflictId: "conflict-1" },
    })
    expect(resolveSemanticConflict).toHaveBeenCalledWith({
      conflictId: "conflict-1",
      selectedValue: "deliverable-2",
      correlationId: "resolve-conflict",
    })
    await expect(resolved.json()).resolves.toMatchObject({
      data: { conflictId: "rebased-conflict", status: "open" },
    })

    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ data: conflict }))
    await runContentRequestsCli(
      [
        "conflict-resolve",
        "conflict-1",
        "--value",
        "deliverable-2",
        "--idempotency-key",
        "stable-resolution",
      ],
      {
        fetchImpl,
        env: {
          CONTENT_REQUESTS_API_URL: "https://fairlend.test",
          CONTENT_REQUESTS_ACCESS_TOKEN: "test-token",
        },
        io: { writeOut: vi.fn(), writeError: vi.fn() },
      }
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://fairlend.test/api/v1/semantic-conflicts/conflict-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "resolve",
          selectedValue: "deliverable-2",
          correlationId: "stable-resolution",
        }),
      })
    )
  })

  it.each([
    ["FOUNDER_INPUT_HANDOFF_REQUIRED", 409],
    ["ASSIGNEE_NOT_FOUND", 404],
  ])(
    "preserves actionable semantic resolution error %s as HTTP %s",
    async (code, status) => {
      const item = createSemanticConflictItemHandler(async () =>
        serviceStub({
          resolveSemanticConflict: vi
            .fn()
            .mockRejectedValue({ data: { code } }),
        })
      )
      const response = await item.POST({
        request: new Request(
          "https://fairlend.test/api/v1/semantic-conflicts/conflict-1",
          {
            method: "POST",
            body: JSON.stringify({
              action: "resolve",
              selectedValue: "principal-2",
            }),
          }
        ),
        params: { conflictId: "conflict-1" },
      })
      expect(response.status).toBe(status)
      await expect(response.json()).resolves.toMatchObject({ error: { code } })
    }
  )

  it("maps delivery target creation, retention, confirmation, and reopen through shared adapters", async () => {
    const createDeliveryTarget = vi
      .fn()
      .mockResolvedValue({ targetId: "target-2" })
    const confirmDeliveryTarget = vi
      .fn()
      .mockResolvedValue({ currentReceiptId: "receipt-1" })
    const reopenDeliveryTarget = vi
      .fn()
      .mockResolvedValue({ currentReceiptId: null })
    const setDeliveryTargetRetention = vi
      .fn()
      .mockResolvedValue({ retention: "archived" })
    const listArchivedDeliveryTargets = vi.fn().mockResolvedValue({
      page: [{ targetId: "target-archived" }],
      nextCursor: "next-archived",
    })
    const collection = createDeliveryTargetCollectionHandler(async () =>
      serviceStub({ createDeliveryTarget, listArchivedDeliveryTargets })
    )
    const item = createDeliveryTargetItemHandler(async () =>
      serviceStub({
        confirmDeliveryTarget,
        reopenDeliveryTarget,
        setDeliveryTargetRetention,
      })
    )
    const created = await collection.POST({
      request: new Request(
        "https://fairlend.test/api/v1/content-requests/CR-1/delivery-targets",
        {
          method: "POST",
          body: JSON.stringify({
            action: "create",
            deliverableId: "deliverable-1",
            channel: "linkedin",
            destinationLabel: "LinkedIn",
            correlationId: "create-target",
          }),
        }
      ),
      params: { requestId: "CR-1" },
    })
    expect(created.status).toBe(201)
    expect(createDeliveryTarget).toHaveBeenCalledWith({
      humanId: "CR-1",
      deliverableId: "deliverable-1",
      channel: "linkedin",
      destinationLabel: "LinkedIn",
      destinationUrl: undefined,
      isRequired: undefined,
      correlationId: "create-target",
    })
    const archivedPage = await collection.GET({
      request: new Request(
        "https://fairlend.test/api/v1/content-requests/CR-1/delivery-targets?retention=archived&cursor=cursor-1"
      ),
      params: { requestId: "CR-1" },
    })
    expect(listArchivedDeliveryTargets).toHaveBeenCalledWith("CR-1", "cursor-1")
    await expect(archivedPage.json()).resolves.toMatchObject({
      data: { nextCursor: "next-archived" },
    })
    await item.POST({
      request: new Request(
        "https://fairlend.test/api/v1/delivery-targets/target-2",
        {
          method: "POST",
          body: JSON.stringify({
            action: "set_retention",
            retention: "archived",
            correlationId: "archive-target",
          }),
        }
      ),
      params: { targetId: "target-2" },
    })
    expect(setDeliveryTargetRetention).toHaveBeenCalledWith({
      targetId: "target-2",
      retention: "archived",
      correlationId: "archive-target",
    })
    await item.POST({
      request: new Request(
        "https://fairlend.test/api/v1/delivery-targets/target-2",
        {
          method: "POST",
          body: JSON.stringify({
            action: "confirm",
            versionId: "version-1",
            note: "Posted",
            correlationId: "confirm-target",
          }),
        }
      ),
      params: { targetId: "target-2" },
    })
    expect(confirmDeliveryTarget).toHaveBeenCalledWith({
      targetId: "target-2",
      versionId: "version-1",
      note: "Posted",
      integrationSuccessId: undefined,
      correlationId: "confirm-target",
    })
    await item.POST({
      request: new Request(
        "https://fairlend.test/api/v1/delivery-targets/target-2",
        {
          method: "POST",
          body: JSON.stringify({
            action: "reopen",
            correlationId: "reopen-target",
          }),
        }
      ),
      params: { targetId: "target-2" },
    })
    expect(reopenDeliveryTarget).toHaveBeenCalledWith({
      targetId: "target-2",
      correlationId: "reopen-target",
    })

    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ data: {} })))
    await runContentRequestsCli(
      [
        "target-confirm",
        "target-2",
        "--version-id",
        "version-1",
        "--idempotency-key",
        "stable-confirm",
      ],
      {
        fetchImpl,
        env: {
          CONTENT_REQUESTS_API_URL: "https://fairlend.test",
          CONTENT_REQUESTS_ACCESS_TOKEN: "token",
        },
        io: { writeOut: vi.fn(), writeError: vi.fn() },
      }
    )
    expect(
      JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    ).toMatchObject({
      action: "confirm",
      versionId: "version-1",
      correlationId: "stable-confirm",
    })
    await runContentRequestsCli(
      [
        "target-retention",
        "target-2",
        "--retention",
        "archived",
        "--idempotency-key",
        "stable-archive",
      ],
      {
        fetchImpl,
        env: {
          CONTENT_REQUESTS_API_URL: "https://fairlend.test",
          CONTENT_REQUESTS_ACCESS_TOKEN: "token",
        },
        io: { writeOut: vi.fn(), writeError: vi.fn() },
      }
    )
    expect(
      JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string)
    ).toMatchObject({
      action: "set_retention",
      retention: "archived",
      correlationId: "stable-archive",
    })
  })

  it.each([
    "DELIVERY_TARGET_RETENTION_UNCHANGED",
    "REQUEST_CHILD_LIMIT_REACHED",
  ])("maps delivery retention conflict %s to HTTP 409", async (code) => {
    const item = createDeliveryTargetItemHandler(async () =>
      serviceStub({
        setDeliveryTargetRetention: vi
          .fn()
          .mockRejectedValue({ data: { code } }),
      })
    )
    const response = await item.POST({
      request: new Request(
        "https://fairlend.test/api/v1/delivery-targets/target-2",
        {
          method: "POST",
          body: JSON.stringify({
            action: "set_retention",
            retention: "archived",
          }),
        }
      ),
      params: { targetId: "target-2" },
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
  })
})
