// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = {
  subject: "share-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "share-session",
}

describe("revocable public request views", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.PUBLIC_SHARE_TOKEN_SECRET =
      "test-only-public-share-secret-at-least-32-bytes"
  })

  it("publishes only selected snapshots and revokes access immediately", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    const principal = await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Public mortgage answer",
      origin: "manual",
      correlationId: "share-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Approved public answer",
      correlationId: "share-version",
    })
    const contextId = await workspace.run(async (ctx) => {
      const runId = await ctx.db.insert("ingestionRuns", {
        organizationId: identity.org_id,
        reportIdentity: "share-report",
        idempotencyKey: "share-report",
        reportHash: "hash",
        rawMarkdown: "private raw report",
        demandLedgerMarkdown: "private demand ledger",
        parserVersion: "test",
        status: "applied",
        createdByPrincipalId: principal.principalId,
        createdAt: 1,
        result: {
          created: 0,
          updated: 0,
          manualPreserved: 0,
          requestHumanIds: [],
        },
      })
      await ctx.db.insert("founderInputDocuments", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        founderPrincipalId: principal.principalId,
        text: "PRIVATE_FOUNDER_SECRET",
        revision: 1,
        hasMeaningfulDraft: true,
        createdAt: 1,
        updatedAt: 1,
      })
      return ctx.db.insert("contextItems", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        kind: "talking_points",
        title: "Talking points",
        bulletPoints: ["Public fact"],
        citations: [
          { label: "Source", url: "https://example.com", supports: "Fact" },
        ],
        ingestionRunId: runId,
        createdAt: 1,
        updatedAt: 1,
      })
    })
    const privateContextId = await workspace.run(async (ctx) => {
      const run = await ctx.db.query("ingestionRuns").first()
      if (!run) throw new Error("Missing ingestion fixture")
      return ctx.db.insert("contextItems", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        kind: "operator_cue",
        title: "Internal operator cue",
        bulletPoints: ["PRIVATE_OPERATOR_SECRET"],
        citations: [],
        ingestionRunId: run._id,
        createdAt: 2,
        updatedAt: 2,
      })
    })
    await expect(
      operator.mutation(api.publicShares.create, {
        humanId: request.humanId,
        contextItemIds: [privateContextId],
        deliverableIds: [],
        correlationId: "private-context-share",
      })
    ).rejects.toMatchObject({
      data: { code: "PRIVATE_CONTEXT_NOT_SHAREABLE" },
    })
    const created = await operator.mutation(api.publicShares.create, {
      humanId: request.humanId,
      contextItemIds: [contextId],
      deliverableIds: [primary.deliverableId],
      correlationId: "create-share",
    })
    await expect(
      operator.mutation(api.publicShares.create, {
        humanId: request.humanId,
        contextItemIds: [contextId],
        deliverableIds: [primary.deliverableId],
        correlationId: "create-share",
      })
    ).resolves.toEqual(created)
    await expect(
      operator.mutation(api.publicShares.create, {
        humanId: request.humanId,
        contextItemIds: [contextId],
        deliverableIds: [],
        correlationId: "create-share",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    expect(created.token).toMatch(/^[a-f0-9]{64}$/)
    const view = await workspace.mutation(api.publicShares.view, {
      token: created.token,
    })
    expect(view).toMatchObject({
      request: { humanId: request.humanId, title: request.title },
      briefSections: [
        { title: "Talking points", bulletPoints: ["Public fact"] },
      ],
      deliverables: [{ body: "Approved public answer" }],
    })
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain("PRIVATE_FOUNDER_SECRET")
    expect(serialized).not.toContain("private raw report")
    expect(serialized).not.toMatch(/job|audit|candidate|credential/i)
    await workspace.mutation(api.publicShares.view, { token: created.token })
    const accesses = await workspace.run((ctx) =>
      ctx.db.query("publicShareAccesses").collect()
    )
    expect(accesses).toHaveLength(1)
    expect(accesses[0].count).toBe(1)
    await expect(
      workspace.mutation(api.publicShares.view, { token: "malformed" })
    ).resolves.toBeNull()
    await operator.mutation(api.publicShares.revoke, {
      shareId: created.share.shareId as Id<"publicShares">,
      correlationId: "revoke-share",
    })
    await expect(
      workspace.mutation(api.publicShares.view, { token: created.token })
    ).resolves.toBeNull()
  })

  it("enforces optional expiry and promoted-version selection", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Expiring share",
      origin: "manual",
      correlationId: "expiring-share-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    await expect(
      operator.mutation(api.publicShares.create, {
        humanId: request.humanId,
        contextItemIds: [],
        deliverableIds: [primary.deliverableId],
        correlationId: "unpromoted-share",
      })
    ).rejects.toMatchObject({ data: { code: "PROMOTED_VERSION_REQUIRED" } })
    await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Public response",
      correlationId: "expiring-share-version",
    })
    for (const invalidExpiry of [0, Date.now() - 1, Number.MAX_SAFE_INTEGER])
      await expect(
        operator.mutation(api.publicShares.create, {
          humanId: request.humanId,
          contextItemIds: [],
          deliverableIds: [primary.deliverableId],
          expiresAt: invalidExpiry,
          correlationId: `invalid-expiry-${invalidExpiry}`,
        })
      ).rejects.toMatchObject({ data: { code: "INVALID_SHARE_EXPIRY" } })
    const expiresAt = Date.now() + 60_000
    const created = await operator.mutation(api.publicShares.create, {
      humanId: request.humanId,
      contextItemIds: [],
      deliverableIds: [primary.deliverableId],
      expiresAt,
      correlationId: "expiring-share",
    })
    await workspace.run((ctx) =>
      ctx.db.patch(request.requestId, {
        title: "Unapproved changed title",
        priority: "low",
      })
    )
    await expect(
      workspace.mutation(api.publicShares.view, {
        token: created.token,
      })
    ).resolves.toMatchObject({
      request: { title: "Expiring share", priority: "critical" },
    })
    await workspace.run((ctx) =>
      ctx.db.patch(created.share.shareId, { expiresAt: Date.now() - 1 })
    )
    await expect(
      workspace.mutation(api.publicShares.view, { token: created.token })
    ).resolves.toBeNull()
  })

  it("rejects snapshots above the explicit document budget", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    const principal = await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Oversized public snapshot",
      origin: "manual",
      correlationId: "oversized-share-request",
    })
    const contextId = await workspace.run(async (ctx) => {
      const runId = await ctx.db.insert("ingestionRuns", {
        organizationId: identity.org_id,
        reportIdentity: "oversized-report",
        idempotencyKey: "oversized-report",
        reportHash: "hash",
        rawMarkdown: "report",
        demandLedgerMarkdown: "ledger",
        parserVersion: "test",
        status: "applied",
        createdByPrincipalId: principal.principalId,
        createdAt: 1,
        result: {
          created: 0,
          updated: 0,
          manualPreserved: 0,
          requestHumanIds: [],
        },
      })
      return ctx.db.insert("contextItems", {
        organizationId: identity.org_id,
        requestId: request.requestId,
        kind: "talking_points",
        title: "Oversized talking points",
        bulletPoints: ["x".repeat(500_001)],
        citations: [],
        ingestionRunId: runId,
        createdAt: 1,
        updatedAt: 1,
      })
    })
    await expect(
      operator.mutation(api.publicShares.create, {
        humanId: request.humanId,
        contextItemIds: [contextId],
        deliverableIds: [],
        correlationId: "oversized-share",
      })
    ).rejects.toMatchObject({ data: { code: "SHARE_SNAPSHOT_TOO_LARGE" } })
  })

  it("retires expired grants before enforcing the active-link cap", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    const principal = await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Expired grant cleanup",
      origin: "manual",
      correlationId: "expired-grants-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Replacement public response",
      correlationId: "expired-grants-version",
    })
    await workspace.run(async (ctx) => {
      for (let index = 0; index < 50; index += 1)
        await ctx.db.insert("publicShares", {
          organizationId: identity.org_id,
          requestId: request.requestId,
          tokenHash: `expired-token-${index}`,
          requestSnapshot: {
            humanId: request.humanId,
            title: request.title,
            priority: "critical",
            createdAt: 1,
          },
          briefSections: [],
          deliverables: [],
          expiresAt: Date.now() - 1,
          active: true,
          createdByPrincipalId: principal.principalId,
          createdAt: index,
          updatedAt: index,
        })
    })
    await expect(
      operator.mutation(api.publicShares.create, {
        humanId: request.humanId,
        contextItemIds: [],
        deliverableIds: [primary.deliverableId],
        correlationId: "replacement-share",
      })
    ).resolves.toMatchObject({ share: { revokedAt: null } })
    const active = await workspace.run((ctx) =>
      ctx.db
        .query("publicShares")
        .withIndex("by_request_active_created_at", (index) =>
          index.eq("requestId", request.requestId).eq("active", true)
        )
        .collect()
    )
    expect(active).toHaveLength(1)
  })

  it("atomically rejects a share when selected context changed after approval", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Context-bound public share",
      origin: "manual",
      correlationId: "create-context-bound-share",
    })
    const first = await operator.mutation(api.scoutIngestions.upsertContext, {
      humanId: request.humanId,
      kind: "talking_points",
      title: "Approved talking points",
      bulletPoints: ["Original approved point"],
      citations: [],
      correlationId: "context-before-approval",
    })
    const approved = await operator.query(api.contentRequests.getByHumanId, {
      humanId: request.humanId,
    })
    await operator.mutation(api.scoutIngestions.upsertContext, {
      humanId: request.humanId,
      kind: "talking_points",
      title: "Approved talking points",
      bulletPoints: ["Changed after approval"],
      citations: [],
      correlationId: "context-after-approval",
    })
    await expect(
      operator.mutation(api.publicShares.create, {
        humanId: request.humanId,
        contextItemIds: [first.contextId],
        deliverableIds: [],
        correlationId: "stale-context-share",
        expectedAggregateVersion: approved!.aggregateVersion,
      })
    ).rejects.toMatchObject({ data: { code: "CONFIRMATION_STALE" } })
    const shares = await operator.mutation(api.publicShares.list, {
      humanId: request.humanId,
    })
    expect(shares).toEqual([])
  })
})
