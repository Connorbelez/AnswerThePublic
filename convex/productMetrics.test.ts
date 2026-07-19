// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import { aggregateProductMetricEvents } from "./productMetrics"
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
    const third = await operator.mutation(api.contentRequests.createManual, {
      title: "Non-job ready response",
      origin: "manual",
      correlationId: "metrics-create-third",
    })
    const fourth = await operator.mutation(api.contentRequests.createManual, {
      title: "Terminal drafting failure",
      origin: "manual",
      correlationId: "metrics-create-fourth",
    })

    await workspace.run(async (ctx) => {
      const requests = await ctx.db.query("contentRequests").collect()
      const byHumanId = new Map(
        requests.map((request) => [request.humanId, request])
      )
      const events = [
        [first.humanId, "content_request.created", 500, undefined],
        [first.humanId, "content_request.opened", 700, undefined],
        [first.humanId, "founder_input.submitted", 1_000, undefined],
        [second.humanId, "content_request.created", 1_000, undefined],
        [second.humanId, "content_request.opened", 1_500, undefined],
        [second.humanId, "founder_input.submitted", 2_000, undefined],
        [first.humanId, "agent_job.completed", 3_000, undefined],
        [second.humanId, "agent_job.completed", 6_000, undefined],
        [
          first.humanId,
          "delivery_receipt.confirmed",
          8_000,
          {
            responseCompleted: true,
            deliveryBeforeExpiration: true,
            agentDraftDelivered: true,
            substantialOperatorRewrite: true,
          },
        ],
        [
          second.humanId,
          "delivery_receipt.confirmed",
          8_500,
          {
            responseCompleted: true,
            deliveryBeforeExpiration: false,
            agentDraftDelivered: true,
            substantialOperatorRewrite: false,
          },
        ],
        [second.humanId, "agent_job.retry_scheduled", 8_750, undefined],
        [fourth.humanId, "agent_job.failed", 9_000, undefined],
        [second.humanId, "content_request.expired", 9_500, undefined],
        [third.humanId, "content_request.ready_response", 5_000, undefined],
        [third.humanId, "deliverable.version_created", 7_000, undefined],
      ] as const
      for (const [humanId, operation, occurredAt, productMetric] of events) {
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
          productMetric,
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
      readyResponses: 3,
      firstOpens: 2,
      deliveries: 2,
      expirations: 1,
      failures: 1,
      retriesScheduled: 1,
      draftingCompletions: 2,
      draftingFailureRate: 1 / 3,
      deliveriesWithExpiration: 2,
      deliveriesBeforeExpiration: 1,
      deliveryBeforeExpirationRate: 1 / 2,
      agentDraftDeliveries: 2,
      rewrittenResponses: 1,
      rewriteRate: 1 / 2,
      deliveredWithoutSubstantialRewriteRate: 1 / 2,
      medianCreationToFirstOpenMs: 350,
      medianCreationToFounderSubmissionMs: 750,
      medianFounderToReadyMs: 3_000,
      medianReadyToDeliveryMs: 3_750,
    })
    const serialized = JSON.stringify(metrics)
    expect(serialized).not.toContain(first.humanId)
    expect(serialized).not.toContain(second.humanId)
    expect(serialized).not.toContain(third.humanId)
    expect(serialized).not.toContain("must-not-leak")
    await expect(
      founder.query(api.productMetrics.get, { from: 500, to: 10_000 })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(
      agent.query(api.productMetrics.get, { from: 500, to: 10_000 })
    ).resolves.toMatchObject({
      founderSubmissions: metrics.founderSubmissions,
      readyResponses: metrics.readyResponses,
      deliveries: metrics.deliveries,
      rewriteRate: metrics.rewriteRate,
    })
  }, 10_000)

  it("defaults to 30 days and rejects unsafe or oversized windows", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("metrics-boundary-operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const before = Date.now()
    const metrics = await operator.query(api.productMetrics.get, {})
    const after = Date.now()
    expect(metrics.to).toBeGreaterThanOrEqual(before)
    expect(metrics.to).toBeLessThanOrEqual(after)
    expect(metrics.from).toBe(metrics.to - 30 * 24 * 60 * 60 * 1_000)
    expect(metrics).toMatchObject({
      truncated: false,
      founderSubmissions: 0,
      readyResponses: 0,
      deliveries: 0,
      rewriteRate: 0,
    })
    await expect(
      operator.query(api.productMetrics.get, {
        from: Number.MAX_SAFE_INTEGER + 1,
        to: Number.MAX_SAFE_INTEGER + 2,
      })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
    await expect(
      operator.query(api.productMetrics.get, {
        from: 1,
        to: 1 + 367 * 24 * 60 * 60 * 1_000,
      })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
    await expect(
      operator.query(api.productMetrics.get, { from: 2, to: 1 })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
  })

  it("does not classify an undelivered direct edit as an agent-draft rewrite", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("metrics-direct-operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Directly drafted response",
      origin: "manual",
      correlationId: "metrics-direct-create",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const from = Date.now() - 1
    await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary!.deliverableId,
      body: "Initial directly drafted response.",
      correlationId: "metrics-direct-ready",
    })
    await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary!.deliverableId,
      body: "Rewritten directly drafted response.",
      correlationId: "metrics-direct-rewrite",
    })
    await expect(
      operator.query(api.productMetrics.get, {
        from,
        to: Date.now() + 1,
      })
    ).resolves.toMatchObject({
      readyResponses: 1,
      agentDraftDeliveries: 0,
      rewrittenResponses: 0,
      rewriteRate: 0,
      deliveredWithoutSubstantialRewriteRate: 0,
    })
  })

  it("bounds aggregation at 10,000 events and marks the result truncated", () => {
    const page = Array.from({ length: 10_001 }, (_, index) => ({
      requestId: `request-${index}` as never,
      operation: "founder_input.submitted",
      occurredAt: index,
    }))
    expect(
      aggregateProductMetricEvents(page, {
        from: 0,
        to: 10_001,
        generatedAt: 10_002,
      })
    ).toMatchObject({
      truncated: true,
      founderSubmissions: 10_000,
      readyResponses: 0,
    })
  })
})
