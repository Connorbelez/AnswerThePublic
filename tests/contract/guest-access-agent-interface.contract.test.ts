import { describe, expect, it, vi } from "vitest"

import {
  agentControlOperations,
  executeAgentControlCommand,
  isAgentControlMutation,
  validateAgentControlCommand,
} from "@/application/agent-control-plane"
import { chatGptExecutionToolOperations } from "@/application/chatgpt-app"
import { chatGptOperationArgumentSchemas } from "@/application/chatgpt-operation-schemas"
import type { ContentRequestService } from "@/application/content-requests"
import { runContentRequestsCli } from "@/cli/content-requests"

function service(methods: Record<string, unknown>) {
  return methods as unknown as ContentRequestService
}

describe("Guest Access shared agent interface", () => {
  it("classifies renewal as additive and revocation as consequential across MCP and the shared service", async () => {
    expect(agentControlOperations).toEqual(
      expect.arrayContaining(["guest_access.renew", "guest_access.revoke"])
    )
    expect(chatGptExecutionToolOperations.content_requests_create).toContain(
      "guest_access.renew"
    )
    expect(chatGptExecutionToolOperations.content_requests_confirm).toContain(
      "guest_access.revoke"
    )
    const renewGuestAccessGrant = vi.fn().mockResolvedValue({
      grant: { grantId: "grant-1", tokenVersion: 2 },
      token: "rotated-token",
    })
    const revokeGuestAccessGrant = vi
      .fn()
      .mockResolvedValue({ grantId: "grant-2", state: "revoked" })
    const shared = service({
      renewGuestAccessGrant,
      revokeGuestAccessGrant,
    })
    await expect(
      executeAgentControlCommand(shared, {
        operation: "guest_access.renew",
        arguments: {
          grantId: "grant-1",
          correlationId: "renew-1",
        },
      })
    ).resolves.toMatchObject({ token: "rotated-token" })
    await expect(
      executeAgentControlCommand(shared, {
        operation: "guest_access.revoke",
        arguments: {
          grantId: "grant-2",
          correlationId: "revoke-2",
        },
      })
    ).resolves.toMatchObject({ state: "revoked" })
    expect(renewGuestAccessGrant).toHaveBeenCalledWith({
      grantId: "grant-1",
      correlationId: "renew-1",
    })
    expect(revokeGuestAccessGrant).toHaveBeenCalledWith({
      grantId: "grant-2",
      correlationId: "revoke-2",
    })
  })

  it("maps grant renewal and revocation CLI commands to the canonical control endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => Response.json({ data: {} }))
    const options = {
      fetchImpl,
      env: {
        CONTENT_REQUESTS_API_URL: "https://fairlend.test",
        CONTENT_REQUESTS_ACCESS_TOKEN: "agent-token",
      },
      io: { writeOut: vi.fn(), writeError: vi.fn() },
    }
    await runContentRequestsCli(
      ["guest-renew", "grant-1", "--idempotency-key", "renew-cli-1"],
      options
    )
    await runContentRequestsCli(
      ["guest-revoke", "grant-2", "--idempotency-key", "revoke-cli-2"],
      options
    )
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain(
      '"operation":"guest_access.renew"'
    )
    expect(String(fetchImpl.mock.calls[1]?.[1]?.body)).toContain(
      '"operation":"guest_access.revoke"'
    )
  })

  it("publishes list as read-only and create as an additive idempotent mutation", () => {
    expect(agentControlOperations).toEqual(
      expect.arrayContaining(["guest_access.list", "guest_access.create"])
    )
    expect(isAgentControlMutation("guest_access.list")).toBe(false)
    expect(isAgentControlMutation("guest_access.create")).toBe(true)
    expect(chatGptExecutionToolOperations.content_requests_read).toContain(
      "guest_access.list"
    )
    expect(chatGptExecutionToolOperations.content_requests_create).toContain(
      "guest_access.create"
    )
    expect(
      chatGptExecutionToolOperations.content_requests_confirm
    ).not.toContain("guest_access.create")
  })

  it("validates exact grant arguments and routes both operations through the shared service", async () => {
    const listGuestAccessGrants = vi
      .fn()
      .mockResolvedValue([{ grantId: "grant-1" }])
    const createGuestAccessGrant = vi.fn().mockResolvedValue({
      grant: { grantId: "grant-2" },
      token: "one-time-token",
    })

    await expect(
      executeAgentControlCommand(
        service({ listGuestAccessGrants, createGuestAccessGrant }),
        {
          operation: "guest_access.list",
          arguments: { humanId: "CR-0241" },
        }
      )
    ).resolves.toEqual({
      page: [{ grantId: "grant-1" }],
      nextCursor: null,
    })
    await expect(
      executeAgentControlCommand(
        service({ listGuestAccessGrants, createGuestAccessGrant }),
        {
          operation: "guest_access.create",
          arguments: {
            humanId: "CR-0241",
            personId: "person-1",
            correlationId: "grant-create-1",
          },
          idempotencyKey: "grant-create-1",
        }
      )
    ).resolves.toEqual({
      grant: { grantId: "grant-2" },
      token: "one-time-token",
    })
    expect(listGuestAccessGrants).toHaveBeenCalledWith("CR-0241")
    expect(createGuestAccessGrant).toHaveBeenCalledWith({
      humanId: "CR-0241",
      personId: "person-1",
      correlationId: "grant-create-1",
    })

    expect(() =>
      validateAgentControlCommand({
        operation: "guest_access.create",
        arguments: {
          humanId: "CR-0241",
          correlationId: "missing-person",
        },
      })
    ).toThrow("INVALID_ARGUMENT:personId")
    expect(
      chatGptOperationArgumentSchemas["guest_access.create"].safeParse({
        humanId: "CR-0241",
        personId: "",
      }).success
    ).toBe(false)
  })

  it("maps ergonomic CLI commands to the canonical control endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => Response.json({ data: {} }))
    const options = {
      fetchImpl,
      env: {
        CONTENT_REQUESTS_API_URL: "https://fairlend.test",
        CONTENT_REQUESTS_ACCESS_TOKEN: "agent-token",
      },
      io: { writeOut: vi.fn(), writeError: vi.fn() },
    }

    await runContentRequestsCli(["guest-list", "CR-0241"], options)
    await runContentRequestsCli(
      [
        "guest-create",
        "CR-0241",
        "--person-id",
        "person-1",
        "--idempotency-key",
        "grant-create-cli-1",
      ],
      options
    )

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://fairlend.test/api/v1/cli/control",
      expect.objectContaining({
        body: expect.stringContaining('"operation":"guest_access.list"'),
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://fairlend.test/api/v1/cli/control",
      expect.objectContaining({
        body: expect.stringContaining('"operation":"guest_access.create"'),
      })
    )
    expect(String(fetchImpl.mock.calls[1]?.[1]?.body)).toContain(
      '"idempotencyKey":"grant-create-cli-1"'
    )
  })
})
