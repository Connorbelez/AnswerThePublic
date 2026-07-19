// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = (subject: string, role: string) => ({
  subject,
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role,
  jti: `${subject}-session`,
})

describe("product metrics", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("returns aggregate-only funnel, reliability, and rewrite metrics", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("metrics-operator", "operator-editor")
    )
    const founder = workspace.withIdentity(
      identity("metrics-founder", "founder")
    )
    const agent = workspace.withIdentity(
      identity("metrics-agent", "agent-editor")
    )
    const operatorPrincipal = await operator.mutation(
      api.principals.syncCurrent
    )
    await founder.mutation(api.principals.syncCurrent)
    await agent.mutation(api.principals.syncCurrent)
    const first = await operator.mutation(api.contentRequests.createManual, {
      title: "First private metrics request",
      origin: "manual",
      correlationId: "metrics-create-first",
    })
    const second = await operator.mutation(api.contentRequests.createManual, {
      title: "Second private metrics request",
      origin: "manual",
      correlationId: "metrics-create-second",
    })

    await workspace.run(async (ctx) => {
      const requests = await ctx.db.query("contentRequests").collect()
      const byHumanId = new Map(
        requests.map((request) => [request.humanId, request])
      )
      const events = [
        [first.humanId, "founder_input.submitted", 1_000],
        [second.humanId, "founder_input.submitted", 2_000],
        [first.humanId, "agent_job.completed", 3_000],
        [first.humanId, "deliverable.version_created", 4_000],
        [second.humanId, "agent_job.completed", 6_000],
        [first.humanId, "delivery_receipt.confirmed", 8_000],
        [second.humanId, "agent_job.retry_scheduled", 8_500],
        [second.humanId, "agent_job.failed", 9_000],
        [second.humanId, "content_request.expired", 9_500],
      ] as const
      for (const [humanId, operation, occurredAt] of events) {
        const request = byHumanId.get(humanId)
        if (!request) throw new Error("Metrics request missing")
        await ctx.db.insert("auditEvents", {
          organizationId: "org_fairlend",
          requestId: request._id,
          requestHumanId: request.humanId,
          actorPrincipalId: operatorPrincipal.principalId,
          credentialId: "must-not-leak-credential",
          operation,
          correlationId: `must-not-leak-${occurredAt}`,
          occurredAt,
          afterVersion: 1,
        })
      }
    })

    const metrics = await operator.query(api.productMetrics.get, {
      from: 500,
      to: 10_000,
    })
    expect(metrics).toMatchObject({
      from: 500,
      to: 10_000,
      truncated: false,
      founderSubmissions: 2,
      readyResponses: 2,
      deliveries: 1,
      expirations: 1,
      failures: 1,
      retriesScheduled: 1,
      rewrittenResponses: 1,
      rewriteRate: 0.5,
      medianFounderToReadyMs: 3_000,
      medianReadyToDeliveryMs: 5_000,
    })
    const serialized = JSON.stringify(metrics)
    expect(serialized).not.toContain(first.humanId)
    expect(serialized).not.toContain(second.humanId)
    expect(serialized).not.toContain("must-not-leak")
    await expect(
      founder.query(api.productMetrics.get, { from: 500, to: 10_000 })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(
      agent.query(api.productMetrics.get, { from: 500, to: 10_000 })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
  })
})
