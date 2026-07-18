// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "user_operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "credential_operator_session",
}

async function operatorBackend() {
  const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
  await backend.mutation(api.principals.syncCurrent)
  return backend
}

describe("Content Request workflow contract", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("creates a minimal manual request as Critical and retrieves it by stable ID", async () => {
    const backend = await operatorBackend()

    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Explain a portable mortgage",
      origin: "manual",
      correlationId: "corr-create-001",
    })

    expect(created).toMatchObject({
      title: "Explain a portable mortgage",
      origin: "manual",
      priority: "critical",
      lifecycle: "pending",
      source: null,
    })
    expect(created.humanId).toMatch(/^CR-[A-Z0-9]+$/)
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: created.humanId,
      })
    ).resolves.toEqual(created)
  })

  it("preserves supplied original source material and audits creation", async () => {
    const backend = await operatorBackend()
    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Answer a first-time buyer question",
      origin: "manual",
      source: {
        question: "  Can I qualify while self-employed?\n",
        body: "\nThe original community post, preserved verbatim.  ",
        url: "https://community.example/questions/42",
        name: "Community forum",
        channel: "forum",
      },
      correlationId: "corr-create-002",
    })

    expect(created.source).toEqual({
      question: "  Can I qualify while self-employed?\n",
      body: "\nThe original community post, preserved verbatim.  ",
      url: "https://community.example/questions/42",
      name: "Community forum",
      channel: "forum",
    })
    await expect(
      backend.query(api.contentRequests.listAuditEvents, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject([
      {
        operation: "content_request.created",
        correlationId: "corr-create-002",
        requestHumanId: created.humanId,
        credentialId: "credential_operator_session",
        beforeVersion: null,
        afterVersion: 1,
      },
    ])
  })

  it("ranks exact ID above title and returns ambiguous fuzzy candidates", async () => {
    const backend = await operatorBackend()
    const calculator = await backend.mutation(
      api.contentRequests.createManual,
      {
        title: "Mortgage renewal calculator",
        origin: "manual",
        source: { channel: "calculator" },
        correlationId: "corr-create-003",
      }
    )
    const options = await backend.mutation(api.contentRequests.createManual, {
      title: "Mortgage renewal options",
      origin: "manual",
      source: { name: "Reddit", channel: "community" },
      aliases: ["renewal choices"],
      correlationId: "corr-create-004",
    })

    await expect(
      backend.query(api.contentRequests.resolve, {
        query: calculator.humanId.toLowerCase(),
      })
    ).resolves.toMatchObject({
      kind: "resolved",
      matchedBy: "exact_id",
      request: { humanId: calculator.humanId },
    })
    await expect(
      backend.query(api.contentRequests.resolve, {
        query: "  MORTGAGE renewal OPTIONS ",
      })
    ).resolves.toMatchObject({
      kind: "resolved",
      matchedBy: "exact_title",
      request: { humanId: options.humanId },
    })

    const ambiguous = await backend.query(api.contentRequests.resolve, {
      query: "mortgage renewal",
    })
    expect(ambiguous.kind).toBe("candidates")
    if (ambiguous.kind !== "candidates") throw new Error("Expected candidates")
    expect(ambiguous.candidates.map((candidate) => candidate.humanId)).toEqual([
      calculator.humanId,
      options.humanId,
    ])
    await expect(
      backend.query(api.contentRequests.resolve, { query: "Reddit community" })
    ).resolves.toMatchObject({
      kind: "candidates",
      candidates: [{ humanId: options.humanId }],
    })
  })

  it("rejects manual creation by the founder role", async () => {
    const backend = convexTest(schema, modules).withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
    })
    await backend.mutation(api.principals.syncCurrent)

    await expect(
      backend.mutation(api.contentRequests.createManual, {
        title: "Founder cannot self-assign operator work",
        origin: "manual",
        correlationId: "corr-denied-001",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(backend.query(api.contentRequests.list, {})).resolves.toEqual(
      []
    )
  })
})
