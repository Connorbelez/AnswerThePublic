import { describe, expect, it, vi } from "vitest"

import { createAgentControlHandler } from "@/application/agent-control-http"
import {
  agentControlOperations,
  executeAgentControlCommand,
} from "@/application/agent-control-plane"
import type { ContentRequestService } from "@/application/content-requests"
import { runContentRequestsCli } from "@/cli/content-requests"

function service(methods: Record<string, unknown>) {
  return methods as unknown as ContentRequestService
}

describe("agent control-plane contract", () => {
  it("exposes the V1 workflow while withholding immutable founder/source writes", () => {
    expect(agentControlOperations).toEqual(
      expect.arrayContaining([
        "request.workspace",
        "request.resolve",
        "request.create",
        "request.update",
        "request.archive",
        "request.restore_archived",
        "job.claim",
        "job.complete",
        "context.upsert",
        "context.versions",
        "deliverable.version",
        "deliverable.promote",
        "target.confirm",
        "share.create",
        "audit.list",
        "metrics.get",
      ])
    )
    expect(agentControlOperations).not.toContain("request.delete")
    expect(agentControlOperations).not.toContain("source.update")
    expect(agentControlOperations).not.toContain("founder.save")
  })

  it("uses the shared service for fuzzy resolution and compact field selection", async () => {
    const resolve = vi.fn().mockResolvedValue({
      kind: "resolved",
      request: { humanId: "CR-101", title: "Renewal", source: "private" },
    })
    await expect(
      executeAgentControlCommand(service({ resolve }), {
        operation: "request.resolve",
        arguments: { query: "renewal" },
        fields: ["kind", "request"],
      })
    ).resolves.toEqual({
      kind: "resolved",
      request: { humanId: "CR-101", title: "Renewal", source: "private" },
    })
    expect(resolve).toHaveBeenCalledWith("renewal")
  })

  it("exposes aggregate product metrics as a validated read operation", async () => {
    const getProductMetrics = vi.fn().mockResolvedValue({
      founderSubmissions: 4,
      readyResponses: 3,
      deliveries: 2,
      rewriteRate: 1 / 3,
    })
    await expect(
      executeAgentControlCommand(service({ getProductMetrics }), {
        operation: "metrics.get",
        arguments: { from: 1_000, to: 2_000 },
      })
    ).resolves.toMatchObject({ deliveries: 2 })
    expect(getProductMetrics).toHaveBeenCalledWith({
      from: 1_000,
      to: 2_000,
    })
    await expect(
      executeAgentControlCommand(service({ getProductMetrics }), {
        operation: "metrics.get",
        arguments: { from: 2_000, to: 1_000 },
      })
    ).rejects.toMatchObject({ field: "to" })
  })

  it("executes bounded bulk commands in order and injects stable idempotency keys", async () => {
    const archive = vi.fn().mockResolvedValue({ humanId: "CR-101" })
    const getByHumanId = vi.fn().mockResolvedValue({ humanId: "CR-101" })
    const list = vi.fn().mockResolvedValue([])
    const handler = createAgentControlHandler(async () =>
      service({ archive, getByHumanId, list })
    )
    const response = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        headers: {
          authorization: "Bearer agent",
          "x-idempotency-key": "batch-1",
        },
        body: JSON.stringify({
          commands: [
            {
              operation: "request.get",
              arguments: { humanId: "CR-101" },
            },
            {
              operation: "request.archive",
              arguments: { humanId: "CR-101" },
              idempotencyKey: "archive-101",
            },
          ],
        }),
      }),
    })

    expect(response.status).toBe(200)
    expect(getByHumanId).toHaveBeenCalledBefore(archive)
    expect(archive).toHaveBeenCalledWith("CR-101", "archive-101")
    await expect(response.json()).resolves.toEqual({
      data: [
        { index: 0, ok: true, data: { humanId: "CR-101" } },
        { index: 1, ok: true, data: { humanId: "CR-101" } },
      ],
    })
  })

  it("rejects malformed typed values before a destructive mutation", async () => {
    const setExpiration = vi.fn()
    const handler = createAgentControlHandler(async () =>
      service({ setExpiration })
    )
    const response = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        body: JSON.stringify({
          command: {
            operation: "request.set_expiration",
            arguments: { humanId: "CR-1", expiresAt: "tomorrow" },
          },
        }),
      }),
    })

    expect(response.status).toBe(400)
    expect(setExpiration).not.toHaveBeenCalled()
  })

  it("reports each bulk outcome without hiding earlier commits", async () => {
    const archive = vi
      .fn()
      .mockResolvedValueOnce({ humanId: "CR-1" })
      .mockRejectedValueOnce({ data: { code: "INVALID_TRANSITION" } })
    const handler = createAgentControlHandler(async () =>
      service({ archive, list: vi.fn().mockResolvedValue([]) })
    )
    const response = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        headers: { "x-idempotency-key": "archive-batch" },
        body: JSON.stringify({
          commands: ["CR-1", "CR-2"].map((humanId) => ({
            operation: "request.archive",
            arguments: { humanId },
          })),
        }),
      }),
    })

    expect(response.status).toBe(207)
    expect(archive).toHaveBeenNthCalledWith(1, "CR-1", "archive-batch:0")
    expect(archive).toHaveBeenNthCalledWith(2, "CR-2", "archive-batch:1")
    await expect(response.json()).resolves.toMatchObject({
      data: [
        { index: 0, ok: true },
        {
          index: 1,
          ok: false,
          status: 409,
          error: { code: "INVALID_TRANSITION" },
        },
      ],
    })
  })

  it("treats bulk authentication failures as request-level failures", async () => {
    const archive = vi.fn()
    const handler = createAgentControlHandler(async () =>
      service({
        list: vi.fn().mockRejectedValue({ data: { code: "UNAUTHENTICATED" } }),
        archive,
      })
    )
    const response = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        headers: { "x-idempotency-key": "unauthenticated-batch" },
        body: JSON.stringify({
          commands: [
            {
              operation: "request.archive",
              arguments: { humanId: "CR-1" },
            },
          ],
        }),
      }),
    })

    expect(response.status).toBe(401)
    expect(archive).not.toHaveBeenCalled()
  })

  it("uses the stable command idempotency key as the job claim lease token", async () => {
    const claimAgentJob = vi.fn().mockResolvedValue({ jobId: "job-1" })
    const handler = createAgentControlHandler(async () =>
      service({ claimAgentJob })
    )
    const request = (leaseToken: string) =>
      new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        body: JSON.stringify({
          command: {
            operation: "job.claim",
            idempotencyKey: "claim-attempt-1",
            arguments: { leaseToken, leaseMs: 300_000 },
          },
        }),
      })

    expect((await handler.POST({ request: request("random-a") })).status).toBe(
      200
    )
    expect((await handler.POST({ request: request("random-b") })).status).toBe(
      200
    )
    expect(claimAgentJob).toHaveBeenNthCalledWith(1, "claim-attempt-1", 300_000)
    expect(claimAgentJob).toHaveBeenNthCalledWith(2, "claim-attempt-1", 300_000)
  })

  it("rejects conflicting nested and top-level idempotency keys", async () => {
    const handler = createAgentControlHandler(async () => service({}))
    const response = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        body: JSON.stringify({
          command: {
            operation: "request.archive",
            idempotencyKey: "authoritative",
            arguments: { humanId: "CR-1", correlationId: "conflicting" },
          },
        }),
      }),
    })
    expect(response.status).toBe(400)
  })

  it("authenticates discovery instead of returning capabilities to junk credentials", async () => {
    const handler = createAgentControlHandler(async () =>
      service({
        list: vi.fn().mockRejectedValue({ data: { code: "UNAUTHENTICATED" } }),
      })
    )
    const response = await handler.GET({
      request: new Request("https://fairlend.test/api/v1/control", {
        headers: { authorization: "Bearer junk" },
      }),
    })
    expect(response.status).toBe(401)
  })

  it("preserves ambiguity metadata even under compact projection", async () => {
    const resolve = vi.fn().mockResolvedValue({
      kind: "candidates",
      candidates: [{ humanId: "CR-1" }, { humanId: "CR-2" }],
    })
    await expect(
      executeAgentControlCommand(service({ resolve }), {
        operation: "request.resolve",
        arguments: { query: "mortgage" },
        fields: ["request"],
      })
    ).resolves.toEqual({
      kind: "candidates",
      candidates: [{ humanId: "CR-1" }, { humanId: "CR-2" }],
    })
  })

  it("preserves stable domain error codes for agent recovery", async () => {
    const handler = createAgentControlHandler(async () =>
      service({
        createPublicShare: vi.fn().mockRejectedValue({
          data: { code: "PRIVATE_CONTEXT_NOT_SHAREABLE" },
        }),
      })
    )
    const response = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        body: JSON.stringify({
          command: {
            operation: "share.create",
            idempotencyKey: "share-1",
            arguments: {
              humanId: "CR-1",
              contextItemIds: ["private-context"],
              deliverableIds: [],
            },
          },
        }),
      }),
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PRIVATE_CONTEXT_NOT_SHAREABLE" },
    })
  })

  it("returns compact cursor pages for collection operations", async () => {
    const listPage = vi.fn().mockResolvedValue({
      page: [
        { humanId: "CR-5", title: "Five", source: "private" },
        { humanId: "CR-6", title: "Six", source: "private" },
      ],
      nextCursor: "convex-cursor-2",
    })
    await expect(
      executeAgentControlCommand(service({ listPage }), {
        operation: "request.list",
        arguments: { limit: 2, cursor: "convex-cursor-1" },
        fields: ["humanId", "title"],
      })
    ).resolves.toEqual({
      page: [
        { humanId: "CR-5", title: "Five" },
        { humanId: "CR-6", title: "Six" },
      ],
      nextCursor: "convex-cursor-2",
    })
    expect(listPage).toHaveBeenCalledWith("convex-cursor-1", 2)
  })

  it("composes page item fields with explicitly selected cursor metadata", async () => {
    const listPage = vi.fn().mockResolvedValue({
      page: [{ humanId: "CR-5", title: "Five", source: "private" }],
      nextCursor: "convex-cursor-2",
    })
    await expect(
      executeAgentControlCommand(service({ listPage }), {
        operation: "request.list",
        fields: ["page", "humanId", "title", "nextCursor"],
      })
    ).resolves.toEqual({
      page: [{ humanId: "CR-5", title: "Five" }],
      nextCursor: "convex-cursor-2",
    })
  })

  it("rejects unknown operations and invalid required arguments as 400 errors", async () => {
    const handler = createAgentControlHandler(async () => service({}))
    const unknown = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        body: JSON.stringify({ command: { operation: "request.delete" } }),
      }),
    })
    const invalid = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/control", {
        method: "POST",
        body: JSON.stringify({
          command: { operation: "request.get", arguments: {} },
        }),
      }),
    })
    expect(unknown.status).toBe(400)
    expect(invalid.status).toBe(400)
    await expect(unknown.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    })
  })

  it("maps generic and bulk CLI calls onto the control endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => Response.json({ data: [] }))
    const env = {
      CONTENT_REQUESTS_API_URL: "https://fairlend.test",
      CONTENT_REQUESTS_ACCESS_TOKEN: "workos-installation-token",
    }
    await runContentRequestsCli(
      [
        "control",
        "request.workspace",
        "--json",
        '{"queue":"needs_operator","limit":10}',
        "--fields",
        "page,continueCursor",
      ],
      { fetchImpl, env, io: { writeOut: vi.fn(), writeError: vi.fn() } }
    )
    await runContentRequestsCli(["bulk", "--file", "commands.json"], {
      fetchImpl,
      env,
      readFile: async () =>
        JSON.stringify([
          { operation: "request.get", arguments: { humanId: "CR-1" } },
        ]),
      io: { writeOut: vi.fn(), writeError: vi.fn() },
    })

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://fairlend.test/api/v1/cli/control",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"operation":"request.workspace"'),
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://fairlend.test/api/v1/cli/control",
      expect.objectContaining({ body: expect.stringContaining('"commands"') })
    )
  })

  it("returns exit code 3 when any bulk command fails", async () => {
    const errors: Array<string> = []
    const exitCode = await runContentRequestsCli(
      ["bulk", "--file", "commands.json"],
      {
        fetchImpl: async () =>
          Response.json(
            {
              data: [
                { index: 0, ok: true, data: {} },
                {
                  index: 1,
                  ok: false,
                  error: { code: "INVALID_TRANSITION" },
                },
              ],
            },
            { status: 207 }
          ),
        env: {
          CONTENT_REQUESTS_API_URL: "https://fairlend.test",
          CONTENT_REQUESTS_ACCESS_TOKEN: "agent-token",
        },
        readFile: async () =>
          JSON.stringify([
            { operation: "request.get", arguments: { humanId: "CR-1" } },
          ]),
        io: { writeOut: vi.fn(), writeError: (value) => errors.push(value) },
      }
    )
    expect(exitCode).toBe(3)
    expect(errors).toEqual(["One or more bulk commands failed."])
  })
})
