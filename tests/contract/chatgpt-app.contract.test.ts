import { describe, expect, it, vi } from "vitest"

import {
  chatGptExecutionToolOperations,
  consequentialChatGptOperations,
  createChatGptAppHandler,
} from "@/application/chatgpt-app"
import { agentControlOperations } from "@/application/agent-control-plane"
import type { ContentRequestService } from "@/application/content-requests"
import { AuthenticationRequiredError } from "@/application/workspace-session"

const confirmationSecret = "test-confirmation-secret-that-is-long-enough"

function service(methods: Record<string, unknown>) {
  return methods as unknown as ContentRequestService
}

function rpc(
  method: string,
  params?: Record<string, unknown>,
  options: {
    id?: number | null
    origin?: string
    version?: string
    authorization?: string
  } = {}
) {
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params }
  if (options.id !== null) body.id = options.id ?? 1
  return new Request("https://fairlend.test/api/chatgpt/mcp", {
    method: "POST",
    headers: {
      authorization: options.authorization ?? "Bearer workos-installation-key",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      origin: options.origin ?? "https://chatgpt.com",
      ...(options.version ? { "mcp-protocol-version": options.version } : {}),
    },
    body: JSON.stringify(body),
  })
}

type ToolResultBody = {
  result: {
    isError?: boolean
    content: Array<{ type: string; text: string }>
    structuredContent: {
      ok: boolean
      operation?: string
      data?: unknown
      error?: { code: string }
    }
  }
}

function handler(methods: Record<string, unknown>, now = 1_800_000_000_000) {
  return createChatGptAppHandler(
    async () => service({ list: vi.fn().mockResolvedValue([]), ...methods }),
    { confirmationSecret, now: () => now }
  )
}

async function toolList(methods: Record<string, unknown> = {}) {
  const response = await handler(methods).POST({ request: rpc("tools/list") })
  expect(response.status).toBe(200)
  return (await response.json()) as {
    result: {
      tools: Array<{
        name: string
        inputSchema: Record<string, unknown>
        annotations: Record<string, boolean>
      }>
    }
  }
}

function findOperationBranch(
  value: unknown,
  operation: string
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOperationBranch(item, operation)
      if (found) return found
    }
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (typeof properties === "object" && properties !== null) {
    const operationSchema = (properties as Record<string, unknown>).operation
    if (
      typeof operationSchema === "object" &&
      operationSchema !== null &&
      ((operationSchema as Record<string, unknown>).const === operation ||
        (Array.isArray((operationSchema as Record<string, unknown>).enum) &&
          (
            (operationSchema as Record<string, unknown>).enum as Array<unknown>
          )[0] === operation))
    )
      return record
  }
  for (const child of Object.values(record)) {
    const found = findOperationBranch(child, operation)
    if (found) return found
  }
  return null
}

async function callTool(
  name: string,
  input: Record<string, unknown>,
  methods: Record<string, unknown>,
  options: { now?: number; authorization?: string } = {}
) {
  const response = await handler(methods, options.now).POST({
    request: rpc(
      "tools/call",
      { name, arguments: { command: input } },
      options
    ),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as ToolResultBody
}

describe("private ChatGPT App contract", () => {
  it("partitions the complete shared registry and publishes exact per-operation schemas", async () => {
    const exposed = Object.values(chatGptExecutionToolOperations).flat()
    expect(new Set(exposed)).toEqual(new Set(agentControlOperations))
    expect(exposed).toHaveLength(agentControlOperations.length)

    const tools = (await toolList()).result.tools
    expect(tools.map((tool) => tool.name)).toEqual([
      "content_requests_read",
      "content_requests_create",
      "content_requests_update",
      "content_requests_preview",
      "content_requests_confirm",
    ])
    for (const [toolName, operations] of Object.entries(
      chatGptExecutionToolOperations
    )) {
      const schema = tools.find((tool) => tool.name === toolName)!.inputSchema
      for (const operation of operations) {
        const branch = findOperationBranch(schema, operation)
        expect(branch, operation).not.toBeNull()
      }
    }
    const getBranch = findOperationBranch(
      tools.find((tool) => tool.name === "content_requests_read")!.inputSchema,
      "request.get"
    )!
    const argumentsSchema = (
      getBranch.properties as Record<string, Record<string, unknown>>
    ).arguments
    expect(JSON.stringify(argumentsSchema)).toContain("humanId")
    expect(JSON.stringify(argumentsSchema)).toContain(
      "Stable Content Request ID"
    )
  })

  it("publishes accurate safety and idempotency annotations", async () => {
    const tools = (await toolList()).result.tools
    const annotations = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.annotations])
    )
    expect(annotations.content_requests_read).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    })
    expect(annotations.content_requests_create).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
    })
    expect(annotations.content_requests_update).toMatchObject({
      destructiveHint: true,
      idempotentHint: false,
    })
    expect(annotations.content_requests_confirm).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    })
    expect(consequentialChatGptOperations).toEqual(
      expect.arrayContaining([
        "request.archive",
        "request.expire",
        "deliverable.promote",
        "target.confirm",
        "share.create",
        "share.revoke",
        "conflict.resolve",
        "job.fail",
      ])
    )
  })

  it("binds confirmation challenges to the exact action, credential, and expiry", async () => {
    const getByHumanId = vi
      .fn()
      .mockImplementation(async (humanId: string) => ({
        humanId,
        title: humanId === "CR-1" ? "Renewal answer" : "Another request",
        priority: "critical",
        lifecycle: "ready_to_respond",
        disposition: "active",
        retention: "active",
        aggregateVersion: 4,
        updatedAt: 1_799_999_999_000,
      }))
    const archive = vi.fn().mockResolvedValue({
      humanId: "CR-1",
      title: "Renewal answer",
    })
    const preview = await callTool(
      "content_requests_preview",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-1" },
        idempotencyKey: "archive-cr-1",
        scopeHumanId: "CR-1",
      },
      { archive, getByHumanId }
    )
    const previewData = preview.result.structuredContent.data as {
      confirmationToken: string
    }
    expect(preview.result.isError).toBe(false)
    expect(archive).not.toHaveBeenCalled()

    const altered = await callTool(
      "content_requests_confirm",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-2" },
        idempotencyKey: "archive-cr-1",
        confirmationToken: previewData.confirmationToken,
        scopeHumanId: "CR-2",
      },
      { archive, getByHumanId }
    )
    expect(altered.result.structuredContent.error?.code).toBe(
      "CONFIRMATION_REQUIRED"
    )
    expect(archive).not.toHaveBeenCalled()

    const wrongCredential = await callTool(
      "content_requests_confirm",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-1" },
        idempotencyKey: "archive-cr-1",
        confirmationToken: previewData.confirmationToken,
        scopeHumanId: "CR-1",
      },
      { archive, getByHumanId },
      { authorization: "Bearer another-agent-installation" }
    )
    expect(wrongCredential.result.structuredContent.error?.code).toBe(
      "CONFIRMATION_REQUIRED"
    )

    const expired = await callTool(
      "content_requests_confirm",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-1" },
        idempotencyKey: "archive-cr-1",
        confirmationToken: previewData.confirmationToken,
        scopeHumanId: "CR-1",
      },
      { archive, getByHumanId },
      { now: 1_800_000_000_000 + 5 * 60 * 1_000 + 1 }
    )
    expect(expired.result.structuredContent.error?.code).toBe(
      "CONFIRMATION_REQUIRED"
    )
    expect(archive).not.toHaveBeenCalled()

    const confirmed = await callTool(
      "content_requests_confirm",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-1" },
        idempotencyKey: "archive-cr-1",
        confirmationToken: previewData.confirmationToken,
        scopeHumanId: "CR-1",
      },
      { archive, getByHumanId }
    )
    expect(archive).toHaveBeenCalledWith("CR-1", "archive-cr-1", 4)
    expect(confirmed.result.structuredContent).toMatchObject({
      ok: true,
      operation: "request.archive",
      data: { humanId: "CR-1" },
    })
    expect(confirmed.result.content[1]?.text).toContain('"ok":true')
  })

  it("passes the approved aggregate version into the atomic mutation guard", async () => {
    const requestState = (aggregateVersion: number) => ({
      humanId: "CR-1",
      title: "Renewal answer",
      priority: "critical",
      lifecycle: "ready_to_respond",
      disposition: "active",
      retention: "active",
      aggregateVersion,
      updatedAt: aggregateVersion,
    })
    const preview = await callTool(
      "content_requests_preview",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-1" },
        idempotencyKey: "archive-after-review",
        scopeHumanId: "CR-1",
      },
      { getByHumanId: vi.fn().mockResolvedValue(requestState(4)) }
    )
    const token = (
      preview.result.structuredContent.data as { confirmationToken: string }
    ).confirmationToken
    const archive = vi
      .fn()
      .mockRejectedValue({ data: { code: "CONFIRMATION_STALE" } })
    const confirm = await callTool(
      "content_requests_confirm",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-1" },
        idempotencyKey: "archive-after-review",
        scopeHumanId: "CR-1",
        confirmationToken: token,
      },
      { archive }
    )
    expect(confirm.result.structuredContent.error?.code).toBe(
      "CONFIRMATION_STALE"
    )
    expect(archive).toHaveBeenCalledWith("CR-1", "archive-after-review", 4)
  })

  it("allows an exact confirmed-action retry to reach durable idempotency", async () => {
    const getByHumanId = vi.fn().mockResolvedValue({
      humanId: "CR-1",
      title: "Renewal answer",
      priority: "critical",
      lifecycle: "ready_to_respond",
      disposition: "active",
      retention: "active",
      aggregateVersion: 4,
      updatedAt: 40,
    })
    const preview = await callTool(
      "content_requests_preview",
      {
        operation: "request.archive",
        arguments: { humanId: "CR-1" },
        idempotencyKey: "archive-ambiguous-response",
        scopeHumanId: "CR-1",
      },
      { getByHumanId }
    )
    const confirmationToken = (
      preview.result.structuredContent.data as { confirmationToken: string }
    ).confirmationToken
    const archive = vi.fn().mockResolvedValue({
      humanId: "CR-1",
      title: "Renewal answer",
      retention: "archived",
    })
    const command = {
      operation: "request.archive",
      arguments: { humanId: "CR-1" },
      idempotencyKey: "archive-ambiguous-response",
      scopeHumanId: "CR-1",
      confirmationToken,
    }
    const first = await callTool("content_requests_confirm", command, {
      archive,
    })
    const retry = await callTool("content_requests_confirm", command, {
      archive,
    })
    expect(first.result.structuredContent.ok).toBe(true)
    expect(retry.result.structuredContent.ok).toBe(true)
    expect(archive).toHaveBeenNthCalledWith(
      1,
      "CR-1",
      "archive-ambiguous-response",
      4
    )
    expect(archive).toHaveBeenNthCalledWith(
      2,
      "CR-1",
      "archive-ambiguous-response",
      4
    )
  })

  it("resolves target confirmation previews into destination and exact content", async () => {
    const getByHumanId = vi.fn().mockResolvedValue({
      humanId: "CR-1",
      title: "Renewal answer",
      priority: "critical",
      lifecycle: "ready_to_respond",
      disposition: "active",
      retention: "active",
      aggregateVersion: 4,
      updatedAt: 50,
    })
    const deliverable = {
      deliverableId: "DEL-1",
      requestHumanId: "CR-1",
      kind: "reddit_reply",
      name: "Founder-approved reply",
      isPrimary: true,
      currentCandidateVersionId: "VER-1",
      promotedVersionId: "VER-1",
      versions: [
        {
          versionId: "VER-1",
          body: "The exact approved response body.",
          ordinal: 3,
          createdByPrincipalId: "agent-1",
          sourceJobId: null,
          changeSummary: "Founder input incorporated",
          createdAt: 40,
        },
      ],
      createdAt: 10,
      updatedAt: 40,
    }
    const target = {
      targetId: "TARGET-1",
      requestHumanId: "CR-1",
      deliverableId: "DEL-1",
      channel: "Reddit",
      destinationLabel: "r/PersonalFinanceCanada",
      destinationUrl: "https://reddit.com/r/PersonalFinanceCanada/post",
      isOriginal: true,
      isRequired: true,
      retention: "active",
      currentReceiptId: null,
      currentReceipt: null,
      receiptHistory: [],
      createdAt: 20,
      updatedAt: 30,
    }
    const preview = await callTool(
      "content_requests_preview",
      {
        operation: "target.confirm",
        arguments: { targetId: "TARGET-1", versionId: "VER-1" },
        idempotencyKey: "confirm-target-1",
        scopeHumanId: "CR-1",
      },
      {
        getByHumanId,
        listDeliverables: vi.fn().mockResolvedValue([deliverable]),
        listDeliveryTargets: vi.fn().mockResolvedValue([target]),
      }
    )
    expect(preview.result.content[0]?.text).toContain("r/PersonalFinanceCanada")
    expect(preview.result.content[0]?.text).toContain(
      "The exact approved response body."
    )
    expect(preview.result.structuredContent.data).toMatchObject({
      snapshot: {
        request: { humanId: "CR-1", title: "Renewal answer" },
        deliverable: { name: "Founder-approved reply" },
        version: { versionId: "VER-1", ordinal: 3 },
        target: { targetId: "TARGET-1", channel: "Reddit" },
      },
    })
  })

  it("previews omitted job failure retry behavior using the execution default", async () => {
    const preview = await callTool(
      "content_requests_preview",
      {
        operation: "job.fail",
        arguments: {
          jobId: "JOB-1",
          leaseToken: "lease-1",
          errorCode: "MODEL_TIMEOUT",
          leaseGeneration: 2,
        },
        idempotencyKey: "fail-job-1",
        scopeHumanId: "CR-1",
      },
      {
        getByHumanId: vi.fn().mockResolvedValue({
          humanId: "CR-1",
          title: "Renewal answer",
          priority: "critical",
          lifecycle: "in_progress",
          disposition: "active",
          retention: "active",
          aggregateVersion: 4,
          updatedAt: 40,
        }),
        getAgentJobInput: vi.fn().mockResolvedValue({
          job: {
            jobId: "JOB-1",
            requestHumanId: "CR-1",
            status: "running",
            attempts: 1,
            maxAttempts: 3,
            leaseGeneration: 2,
            updatedAt: 30,
          },
        }),
      }
    )
    expect(preview.result.content[0]?.text).toContain("retryable")
    expect(preview.result.structuredContent.data).toMatchObject({
      snapshot: { transient: true },
    })
  })

  it("restores an archived target through preview and confirm", async () => {
    const archivedTarget = {
      targetId: "TARGET-ARCHIVED",
      requestHumanId: "CR-1",
      deliverableId: "DEL-1",
      channel: "LinkedIn",
      destinationLabel: "Founder profile",
      destinationUrl: "https://linkedin.com/in/elie",
      isOriginal: false,
      isRequired: false,
      retention: "archived",
      currentReceiptId: null,
      currentReceipt: null,
      receiptHistory: [],
      createdAt: 10,
      updatedAt: 20,
    }
    const preview = await callTool(
      "content_requests_preview",
      {
        operation: "target.set_retention",
        arguments: { targetId: "TARGET-ARCHIVED", retention: "active" },
        idempotencyKey: "restore-target",
        scopeHumanId: "CR-1",
      },
      {
        getByHumanId: vi.fn().mockResolvedValue({
          humanId: "CR-1",
          title: "Renewal answer",
          priority: "critical",
          lifecycle: "ready_to_respond",
          disposition: "active",
          retention: "active",
          aggregateVersion: 9,
          updatedAt: 90,
        }),
        listDeliveryTargets: vi.fn().mockResolvedValue([]),
        listArchivedDeliveryTargets: vi.fn().mockResolvedValue({
          page: [archivedTarget],
          nextCursor: null,
        }),
      }
    )
    expect(preview.result.content[0]?.text).toContain("Founder profile")
    const confirmationToken = (
      preview.result.structuredContent.data as { confirmationToken: string }
    ).confirmationToken
    const setDeliveryTargetRetention = vi
      .fn()
      .mockResolvedValue({ ...archivedTarget, retention: "active" })
    const confirm = await callTool(
      "content_requests_confirm",
      {
        operation: "target.set_retention",
        arguments: { targetId: "TARGET-ARCHIVED", retention: "active" },
        idempotencyKey: "restore-target",
        scopeHumanId: "CR-1",
        confirmationToken,
      },
      { setDeliveryTargetRetention }
    )
    expect(confirm.result.structuredContent.ok).toBe(true)
    expect(setDeliveryTargetRetention).toHaveBeenCalledWith({
      targetId: "TARGET-ARCHIVED",
      retention: "active",
      correlationId: "restore-target",
      expectedAggregateVersion: 9,
    })
  })

  it("resolves promotion and public-share previews into reviewable selections", async () => {
    const getByHumanId = vi.fn().mockResolvedValue({
      humanId: "CR-1",
      title: "Renewal answer",
      priority: "critical",
      lifecycle: "founder_complete",
      disposition: "active",
      retention: "active",
      aggregateVersion: 8,
      updatedAt: 80,
    })
    const deliverable = {
      deliverableId: "DEL-1",
      requestHumanId: "CR-1",
      kind: "reddit_reply",
      name: "Final Reddit reply",
      isPrimary: true,
      currentCandidateVersionId: "VER-2",
      promotedVersionId: "VER-2",
      versions: [
        {
          versionId: "VER-2",
          body: "A copy-ready final answer.",
          ordinal: 2,
          createdByPrincipalId: "agent-1",
          sourceJobId: null,
          changeSummary: "Polished",
          createdAt: 70,
        },
      ],
      createdAt: 10,
      updatedAt: 70,
    }
    const methods = {
      getByHumanId,
      listDeliverables: vi.fn().mockResolvedValue([deliverable]),
      listContext: vi.fn().mockResolvedValue([
        {
          contextId: "CTX-1",
          kind: "talking_points",
          title: "Key talking points",
          bulletPoints: ["Explain the renewal trigger"],
          citations: [],
        },
      ]),
    }
    const promotion = await callTool(
      "content_requests_preview",
      {
        operation: "deliverable.promote",
        arguments: {
          deliverableId: "DEL-1",
          versionId: "VER-2",
          expectedPromotedVersionId: "VER-2",
        },
        idempotencyKey: "promote-ver-2",
        scopeHumanId: "CR-1",
      },
      methods
    )
    expect(promotion.result.content[0]?.text).toContain("Final Reddit reply")
    expect(promotion.result.content[0]?.text).toContain(
      "A copy-ready final answer."
    )

    const share = await callTool(
      "content_requests_preview",
      {
        operation: "share.create",
        arguments: {
          humanId: "CR-1",
          contextItemIds: ["CTX-1"],
          deliverableIds: ["DEL-1"],
        },
        idempotencyKey: "share-cr-1",
        scopeHumanId: "CR-1",
      },
      methods
    )
    expect(share.result.content[0]?.text).toContain("Key talking points")
    expect(share.result.content[0]?.text).toContain("Final Reddit reply")
    expect(share.result.structuredContent.data).toMatchObject({
      snapshot: {
        context: [{ contextId: "CTX-1" }],
        deliverables: [{ deliverableId: "DEL-1" }],
      },
    })
  })

  it("states when stale deliverable expectations will create conflicts", async () => {
    const deliverables = [
      {
        deliverableId: "DEL-CURRENT",
        requestHumanId: "CR-1",
        kind: "article",
        name: "Current primary",
        isPrimary: true,
        currentCandidateVersionId: "VER-CURRENT",
        promotedVersionId: "VER-CURRENT",
        versions: [
          {
            versionId: "VER-CURRENT",
            body: "Current copy",
            ordinal: 1,
            createdByPrincipalId: "agent-1",
            sourceJobId: null,
            changeSummary: null,
            createdAt: 10,
          },
        ],
        createdAt: 10,
        updatedAt: 10,
      },
      {
        deliverableId: "DEL-NEW",
        requestHumanId: "CR-1",
        kind: "article",
        name: "New candidate",
        isPrimary: false,
        currentCandidateVersionId: "VER-NEW",
        promotedVersionId: "VER-CURRENT",
        versions: [
          {
            versionId: "VER-NEW",
            body: "New copy",
            ordinal: 2,
            createdByPrincipalId: "agent-1",
            sourceJobId: null,
            changeSummary: null,
            createdAt: 20,
          },
        ],
        createdAt: 20,
        updatedAt: 20,
      },
    ]
    const methods = {
      getByHumanId: vi.fn().mockResolvedValue({
        humanId: "CR-1",
        title: "Renewal answer",
        priority: "critical",
        lifecycle: "ready_to_respond",
        disposition: "active",
        retention: "active",
        aggregateVersion: 5,
        updatedAt: 50,
      }),
      listDeliverables: vi.fn().mockResolvedValue(deliverables),
    }
    const promotion = await callTool(
      "content_requests_preview",
      {
        operation: "deliverable.promote",
        arguments: {
          deliverableId: "DEL-NEW",
          versionId: "VER-NEW",
          expectedPromotedVersionId: "VER-OLD",
        },
        idempotencyKey: "stale-promotion",
        scopeHumanId: "CR-1",
      },
      methods
    )
    const primary = await callTool(
      "content_requests_preview",
      {
        operation: "deliverable.set_primary",
        arguments: {
          humanId: "CR-1",
          deliverableId: "DEL-NEW",
          expectedPrimaryDeliverableId: "DEL-OLD",
        },
        idempotencyKey: "stale-primary",
        scopeHumanId: "CR-1",
      },
      methods
    )
    expect(promotion.result.content[0]?.text).toContain(
      "attention-required promotion conflict"
    )
    expect(primary.result.content[0]?.text).toContain(
      "attention-required primary-deliverable conflict"
    )
    expect(promotion.result.structuredContent.data).toMatchObject({
      snapshot: { expectedOutcome: "attention_required" },
    })
    expect(primary.result.structuredContent.data).toMatchObject({
      snapshot: { expectedOutcome: "attention_required" },
    })

    const alreadySelected = deliverables.map((deliverable) =>
      deliverable.deliverableId === "DEL-NEW"
        ? {
            ...deliverable,
            isPrimary: true,
            promotedVersionId: "VER-NEW",
          }
        : { ...deliverable, isPrimary: false }
    )
    const appliedMethods = {
      ...methods,
      listDeliverables: vi.fn().mockResolvedValue(alreadySelected),
    }
    const alreadyPromoted = await callTool(
      "content_requests_preview",
      {
        operation: "deliverable.promote",
        arguments: {
          deliverableId: "DEL-NEW",
          versionId: "VER-NEW",
          expectedPromotedVersionId: "VER-OLD",
        },
        idempotencyKey: "already-promoted",
        scopeHumanId: "CR-1",
      },
      appliedMethods
    )
    const alreadyPrimary = await callTool(
      "content_requests_preview",
      {
        operation: "deliverable.set_primary",
        arguments: {
          humanId: "CR-1",
          deliverableId: "DEL-NEW",
          expectedPrimaryDeliverableId: "DEL-OLD",
        },
        idempotencyKey: "already-primary",
        scopeHumanId: "CR-1",
      },
      appliedMethods
    )
    expect(alreadyPromoted.result.content[0]?.text).toContain(
      "already promoted"
    )
    expect(alreadyPrimary.result.content[0]?.text).toContain(
      "already the primary"
    )
    expect(alreadyPromoted.result.structuredContent.data).toMatchObject({
      snapshot: { expectedOutcome: "already_applied" },
    })
    expect(alreadyPrimary.result.structuredContent.data).toMatchObject({
      snapshot: { expectedOutcome: "already_applied" },
    })
  })

  it("surfaces fuzzy ambiguity in both human and machine content", async () => {
    const resolve = vi.fn().mockResolvedValue({
      kind: "candidates",
      candidates: [
        { humanId: "CR-1", title: "Renewal one" },
        { humanId: "CR-2", title: "Renewal two" },
      ],
    })
    const body = await callTool(
      "content_requests_read",
      {
        operation: "request.resolve",
        arguments: { query: "renewal" },
      },
      { resolve }
    )

    expect(body.result.content[0]?.text).toContain("2 possible matches")
    expect(body.result.content[1]?.text).toContain('"kind":"candidates"')
    expect(body.result.structuredContent.data).toMatchObject({
      kind: "candidates",
      candidates: [{ humanId: "CR-1" }, { humanId: "CR-2" }],
    })
  })

  it("never executes request-only tools sent as JSON-RPC notifications", async () => {
    const createManual = vi.fn()
    const response = await handler({ createManual }).POST({
      request: rpc(
        "tools/call",
        {
          name: "content_requests_create",
          arguments: {
            command: {
              operation: "request.create",
              arguments: { title: "Must not execute" },
              idempotencyKey: "notification-create",
            },
          },
        },
        { id: null }
      ),
    })

    expect(response.status).toBe(202)
    expect(await response.text()).toBe("")
    expect(createManual).not.toHaveBeenCalled()
  })

  it("returns no JSON-RPC response for ordinary notifications", async () => {
    const response = await handler({}).POST({
      request: rpc(
        "notifications/cancelled",
        { requestId: 1, reason: "User cancelled" },
        { id: null }
      ),
    })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe("")
  })

  it("enforces protocol, media, and Origin headers on every transport method", async () => {
    const unsupported = await handler({}).POST({
      request: rpc("tools/list", undefined, { version: "1900-01-01" }),
    })
    const badMediaRequest = rpc("tools/list")
    badMediaRequest.headers.set("content-type", "text/plain")
    const badMedia = await handler({}).POST({ request: badMediaRequest })
    const badGetOrigin = await handler({}).GET({
      request: new Request("https://fairlend.test/api/chatgpt/mcp", {
        headers: {
          authorization: "Bearer workos-installation-key",
          accept: "text/event-stream",
          origin: "https://attacker.example",
        },
      }),
    })

    expect(unsupported.status).toBe(400)
    expect(badMedia.status).toBeGreaterThanOrEqual(400)
    expect(badGetOrigin.status).toBe(403)
  })

  it("authenticates and authorizes before parsing an untrusted body", async () => {
    const app = createChatGptAppHandler(
      async () => {
        throw new AuthenticationRequiredError()
      },
      { confirmationSecret }
    )
    const response = await app.POST({
      request: new Request("https://fairlend.test/api/chatgpt/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer revoked",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          origin: "https://chatgpt.com",
        },
        body: "not json",
      }),
    })
    expect(response.status).toBe(401)
  })

  it("maps stable domain errors without leaking exception details", async () => {
    const createManual = vi.fn().mockRejectedValue({
      data: { code: "IDEMPOTENCY_KEY_REUSED", secret: "do-not-leak" },
    })
    const body = await callTool(
      "content_requests_create",
      {
        operation: "request.create",
        arguments: { title: "A request" },
        idempotencyKey: "reused-key",
      },
      { createManual }
    )
    expect(body.result.structuredContent.error?.code).toBe(
      "IDEMPOTENCY_KEY_REUSED"
    )
    expect(JSON.stringify(body)).not.toContain("do-not-leak")
  })

  it("rejects missing mutation idempotency before service execution", async () => {
    const createManual = vi.fn()
    const body = await callTool(
      "content_requests_create",
      {
        operation: "request.create",
        arguments: { title: "No retry key" },
      },
      { createManual }
    )
    expect(body.result.isError).toBe(true)
    expect(createManual).not.toHaveBeenCalled()
  })
})
