import { describe, expect, it, vi } from "vitest"

import {
  agentControlOperations,
  executeAgentControlCommand,
  isAgentControlMutation,
} from "@/application/agent-control-plane"
import { chatGptExecutionToolOperations } from "@/application/chatgpt-app"
import { chatGptOperationArgumentSchemas } from "@/application/chatgpt-operation-schemas"
import type { ContentRequestService } from "@/application/content-requests"
import { runContentRequestsCli } from "@/cli/content-requests"

function service(methods: Record<string, unknown>) {
  return methods as unknown as ContentRequestService
}

describe("Guest Access adapter contracts", () => {
  it("publishes and executes the Person and Guest Access operations through the shared service", async () => {
    expect(agentControlOperations).toEqual(
      expect.arrayContaining([
        "person.search",
        "person.create",
        "guest_access.list",
        "guest_access.create",
      ])
    )
    expect(isAgentControlMutation("person.search")).toBe(false)
    expect(isAgentControlMutation("guest_access.list")).toBe(false)
    expect(isAgentControlMutation("person.create")).toBe(true)
    expect(isAgentControlMutation("guest_access.create")).toBe(true)

    const searchPeople = vi.fn().mockResolvedValue({
      people: [{ personId: "PERSON-1", displayName: "Elie Tchitava" }],
      defaultPersonId: "PERSON-1",
    })
    const createPerson = vi
      .fn()
      .mockResolvedValue({ personId: "PERSON-2", displayName: "Priya Shah" })
    const listGuestAccessGrants = vi
      .fn()
      .mockResolvedValue([{ grantId: "GRANT-1" }, { grantId: "GRANT-2" }])
    const createGuestAccessGrant = vi.fn().mockResolvedValue({
      grant: { grantId: "GRANT-3" },
      token: "one-time-token",
    })
    const shared = service({
      searchPeople,
      createPerson,
      listGuestAccessGrants,
      createGuestAccessGrant,
    })

    await expect(
      executeAgentControlCommand(shared, {
        operation: "person.search",
        arguments: { query: "elie", limit: 10 },
      })
    ).resolves.toMatchObject({ defaultPersonId: "PERSON-1" })
    await expect(
      executeAgentControlCommand(shared, {
        operation: "person.create",
        arguments: {
          humanId: "CR-0241",
          displayName: "Priya Shah",
          email: "priya@example.ca",
          correlationId: "person-priya-1",
        },
      })
    ).resolves.toMatchObject({ personId: "PERSON-2" })
    await expect(
      executeAgentControlCommand(shared, {
        operation: "guest_access.list",
        arguments: { humanId: "CR-0241", cursor: "offset:1", limit: 1 },
      })
    ).resolves.toEqual({
      page: [{ grantId: "GRANT-2" }],
      nextCursor: null,
    })
    await expect(
      executeAgentControlCommand(shared, {
        operation: "guest_access.create",
        arguments: {
          humanId: "CR-0241",
          personId: "PERSON-2",
          correlationId: "grant-priya-1",
        },
      })
    ).resolves.toMatchObject({
      grant: { grantId: "GRANT-3" },
      token: "one-time-token",
    })

    expect(searchPeople).toHaveBeenCalledWith("elie", 10)
    expect(createPerson).toHaveBeenCalledWith({
      humanId: "CR-0241",
      displayName: "Priya Shah",
      email: "priya@example.ca",
      correlationId: "person-priya-1",
    })
    expect(listGuestAccessGrants).toHaveBeenCalledWith("CR-0241")
    expect(createGuestAccessGrant).toHaveBeenCalledWith({
      humanId: "CR-0241",
      personId: "PERSON-2",
      correlationId: "grant-priya-1",
    })
  })

  it("publishes exact MCP schemas in one and only one safety class", () => {
    const expectedClass = {
      "person.search": "content_requests_read",
      "guest_access.list": "content_requests_read",
      "person.create": "content_requests_create",
      "guest_access.create": "content_requests_create",
    } as const
    const exposed = Object.entries(chatGptExecutionToolOperations).flatMap(
      ([toolName, operations]) =>
        operations.map((operation) => ({ toolName, operation }))
    )
    for (const [operation, toolName] of Object.entries(expectedClass)) {
      expect(
        exposed.filter((candidate) => candidate.operation === operation)
      ).toEqual([{ operation, toolName }])
    }

    expect(
      chatGptOperationArgumentSchemas["person.search"].parse({
        query: "elie@fairlend.ca",
        limit: 10,
      })
    ).toEqual({ query: "elie@fairlend.ca", limit: 10 })
    expect(() =>
      chatGptOperationArgumentSchemas["person.create"].parse({
        humanId: "CR-0241",
        displayName: "Priya Shah",
        email: "not-an-email",
      })
    ).toThrow()
    expect(
      chatGptOperationArgumentSchemas["guest_access.create"].parse({
        humanId: "CR-0241",
        personId: "PERSON-2",
      })
    ).toEqual({ humanId: "CR-0241", personId: "PERSON-2" })
  })

  it("maps ergonomic CLI commands to the shared control endpoint", async () => {
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
      ["people-search", "elie@fairlend.ca", "--limit", "10"],
      options
    )
    await runContentRequestsCli(
      [
        "person-create",
        "CR-0241",
        "--name",
        "Priya Shah",
        "--email",
        "priya@example.ca",
        "--idempotency-key",
        "person-priya-1",
      ],
      options
    )
    await runContentRequestsCli(["guest-access-list", "CR-0241"], options)
    await runContentRequestsCli(
      [
        "guest-access-create",
        "CR-0241",
        "--person-id",
        "PERSON-2",
        "--idempotency-key",
        "grant-priya-1",
      ],
      options
    )

    const calls = fetchImpl.mock.calls.map(
      ([url, init]) =>
        [
          url,
          JSON.parse(String((init as RequestInit).body)) as Record<
            string,
            unknown
          >,
        ] as const
    )
    expect(calls.map(([url]) => url)).toEqual(
      Array(4).fill("https://fairlend.test/api/v1/cli/control")
    )
    expect(calls.map(([, body]) => body)).toEqual([
      {
        command: {
          operation: "person.search",
          arguments: { query: "elie@fairlend.ca", limit: 10 },
        },
      },
      {
        command: {
          operation: "person.create",
          arguments: {
            humanId: "CR-0241",
            displayName: "Priya Shah",
            email: "priya@example.ca",
          },
          idempotencyKey: "person-priya-1",
        },
      },
      {
        command: {
          operation: "guest_access.list",
          arguments: { humanId: "CR-0241" },
        },
      },
      {
        command: {
          operation: "guest_access.create",
          arguments: { humanId: "CR-0241", personId: "PERSON-2" },
          idempotencyKey: "grant-priya-1",
        },
      },
    ])
  })
})
