// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = {
  subject: "workspace-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "workspace-session",
}

describe("operator action workspace", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("computes every queue from jobs, conflicts, and delivery evidence", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    const principal = await operator.mutation(api.principals.syncCurrent)
    const founder = workspace.withIdentity({
      ...identity,
      subject: "workspace-founder",
      role: "founder",
      jti: "workspace-founder-session",
    })
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    const create = (title: string, correlationId: string) =>
      operator.mutation(api.contentRequests.createManual, {
        title,
        origin: "manual",
        correlationId,
      })
    const [
      needsElie,
      drafting,
      needsOperator,
      delivered,
      attention,
      importRemediation,
    ] = await Promise.all([
      create("Needs Elie", "queue-needs-elie"),
      create("Agent drafting", "queue-drafting"),
      create("Needs operator", "queue-needs-operator"),
      create("Delivered", "queue-delivered"),
      create("Attention", "queue-attention"),
      create("Import remediation", "queue-import-remediation"),
    ])

    await workspace.run(async (ctx) => {
      await ctx.db.patch(needsOperator.requestId, {
        lifecycle: "ready_to_respond",
        updatedAt: 30,
      })
      await ctx.db.patch(needsElie.requestId, {
        assigneePrincipalId: founderPrincipal.principalId,
      })
      const documentId = await ctx.db.insert("founderInputDocuments", {
        organizationId: identity.org_id,
        requestId: drafting.requestId,
        founderPrincipalId: principal.principalId,
        text: "Founder input",
        revision: 1,
        hasMeaningfulDraft: true,
        createdAt: 10,
        updatedAt: 10,
      })
      const founderVersionId = await ctx.db.insert("founderInputVersions", {
        organizationId: identity.org_id,
        requestId: drafting.requestId,
        documentId,
        text: "Founder input",
        heads: [],
        revision: 1,
        actorPrincipalId: principal.principalId,
        actorSubject: identity.subject,
        correlationId: "queue-founder-version",
        occurredAt: 10,
      })
      await ctx.db.insert("agentJobs", {
        organizationId: identity.org_id,
        requestId: drafting.requestId,
        requestTitle: drafting.title,
        type: "primary_response",
        status: "running",
        founderVersionId,
        contextSnapshot: [],
        attempts: 1,
        maxAttempts: 3,
        leaseGeneration: 1,
        createdAt: 10,
        updatedAt: 20,
      })
      await ctx.db.insert("semanticConflicts", {
        organizationId: identity.org_id,
        requestId: attention.requestId,
        field: "assigneePrincipalId",
        currentValue: principal.principalId,
        proposedValue: principal.principalId,
        expectedValue: "stale-principal",
        status: "open",
        createdByPrincipalId: principal.principalId,
        correlationId: "queue-conflict",
        createdAt: 40,
      })
      await ctx.db.insert("migrationConflicts", {
        organizationId: identity.org_id,
        type: "normalized_source_url_collision",
        requestId: importRemediation.requestId,
        conflictingRequestId: attention.requestId,
        normalizedSourceUrl: "https://example.com/collision",
        resolved: false,
        createdAt: 41,
      })
    })
    for (const request of [
      needsElie,
      drafting,
      needsOperator,
      delivered,
      attention,
      importRemediation,
    ])
      await workspace.mutation(internal.operatorWorkspace.refreshRequest, {
        requestId: request.requestId,
      })

    const [primary] = await operator.query(api.deliverables.list, {
      humanId: delivered.humanId,
    })
    const version = await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Delivered response",
      correlationId: "queue-delivery-version",
    })
    const [target] = await operator.query(api.deliveryTracking.list, {
      humanId: delivered.humanId,
    })
    await operator.mutation(api.deliveryTracking.confirm, {
      targetId: target.targetId,
      versionId: version.promotedVersionId!,
      correlationId: "queue-delivery-confirm",
    })

    const beforeNotifications = await workspace.run((ctx) =>
      ctx.db.query("notifications").collect()
    )
    const result = await operator.query(api.operatorWorkspace.list, {
      paginationOpts: { numItems: 50, cursor: null },
    })
    expect(
      Object.fromEntries(
        result.page.map((item) => [item.request.title, item.queue])
      )
    ).toEqual({
      "Needs Elie": "needs_elie",
      "Agent drafting": "agent_drafting",
      "Needs operator": "needs_operator",
      Delivered: "delivered",
      Attention: "attention_required",
      "Import remediation": "attention_required",
    })
    await expect(
      operator.query(api.operatorWorkspace.list, {
        queue: "needs_elie",
        search: needsElie.humanId.toLowerCase(),
        paginationOpts: { numItems: 50, cursor: null },
      })
    ).resolves.toMatchObject({
      page: [{ request: { humanId: needsElie.humanId } }],
    })
    const afterReadNotifications = await workspace.run((ctx) =>
      ctx.db.query("notifications").collect()
    )
    expect(afterReadNotifications).toHaveLength(beforeNotifications.length)

    await operator.mutation(api.deliveryTracking.reopen, {
      targetId: target.targetId,
      correlationId: "queue-delivery-reopen",
    })
    await expect(
      operator.query(api.operatorWorkspace.list, {
        search: delivered.humanId,
        paginationOpts: { numItems: 50, cursor: null },
      })
    ).resolves.toMatchObject({ page: [{ queue: "attention_required" }] })
    await operator.mutation(api.deliveryTracking.confirm, {
      targetId: target.targetId,
      versionId: version.promotedVersionId!,
      correlationId: "queue-delivery-reconfirm",
    })
    await expect(
      operator.query(api.operatorWorkspace.list, {
        search: delivered.humanId,
        paginationOpts: { numItems: 50, cursor: null },
      })
    ).resolves.toMatchObject({ page: [{ queue: "delivered" }] })
  })

  it("paginates beyond 250 active requests without archived rows consuming the cursor", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    const principal = await operator.mutation(api.principals.syncCurrent)
    const activeIds = await workspace.run(async (ctx) => {
      const ids: Array<Id<"contentRequests">> = []
      for (let index = 0; index < 40; index += 1)
        ids.push(
          await ctx.db.insert("contentRequests", {
            humanId: `CR-ARCHIVED-${String(index).padStart(3, "0")}`,
            organizationId: identity.org_id,
            title: `Archived ${index}`,
            normalizedTitle: `archived ${index}`,
            searchText: `archived ${index}`,
            queueSortKey: `000:${String(index).padStart(4, "0")}`,
            aliases: [],
            origin: "manual",
            priority: "critical",
            lifecycle: "pending",
            disposition: "active",
            retention: "archived",
            aggregateVersion: 1,
            assigneePrincipalId: principal.principalId,
            watcherPrincipalIds: [],
            createdByPrincipalId: principal.principalId,
            createdAt: index,
            updatedAt: index,
          })
        )
      for (let index = 0; index < 260; index += 1)
        ids.push(
          await ctx.db.insert("contentRequests", {
            humanId: `CR-ACTIVE-${String(index).padStart(3, "0")}`,
            organizationId: identity.org_id,
            title: `Active ${index}`,
            normalizedTitle: `active ${index}`,
            searchText: `active ${index}`,
            queueSortKey: `100:${String(index).padStart(4, "0")}`,
            aliases: [],
            origin: "automated_scout",
            priority: "normal",
            lifecycle: "pending",
            disposition: "active",
            retention: "active",
            aggregateVersion: 1,
            assigneePrincipalId: principal.principalId,
            watcherPrincipalIds: [],
            createdByPrincipalId: principal.principalId,
            createdAt: index,
            updatedAt: index,
          })
        )
      return ids
    })
    for (const requestId of activeIds)
      await workspace.mutation(internal.operatorWorkspace.refreshRequest, {
        requestId,
      })

    let cursor: string | null = null
    const humanIds: Array<string> = []
    let done = false
    while (!done) {
      const pageResult: {
        page: Array<{ request: { humanId: string } }>
        continueCursor: string
        isDone: boolean
      } = await operator.query(api.operatorWorkspace.list, {
        paginationOpts: { numItems: 100, cursor },
      })
      humanIds.push(...pageResult.page.map((item) => item.request.humanId))
      cursor = pageResult.continueCursor
      done = pageResult.isDone
    }
    expect(humanIds).toHaveLength(260)
    expect(humanIds.at(-1)).toBe("CR-ACTIVE-259")
    expect(humanIds.some((humanId) => humanId.includes("ARCHIVED"))).toBe(false)
  })

  it("applies exact and channel filters before pagination across the complete workspace", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    const principal = await operator.mutation(api.principals.syncCurrent)
    const special = await operator.mutation(api.contentRequests.createManual, {
      title: "Special destination response",
      origin: "manual",
      correlationId: "workspace-filter-special",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: special.humanId,
    })
    await operator.mutation(api.deliveryTracking.createTarget, {
      humanId: special.humanId,
      deliverableId: primary.deliverableId,
      channel: "industry-forum",
      destinationLabel: "Industry forum",
      correlationId: "workspace-filter-target",
    })

    const requestIds = await workspace.run(async (ctx) => {
      await ctx.db.patch(special.requestId, {
        priority: "high",
        disposition: "expired",
        queueSortKey: "999:workspace-filter-special",
      })
      const ids: Array<Id<"contentRequests">> = [special.requestId]
      for (let index = 0; index < 75; index += 1)
        ids.push(
          await ctx.db.insert("contentRequests", {
            humanId: `CR-NOISE-${String(index).padStart(3, "0")}`,
            organizationId: identity.org_id,
            title: `Noise ${index}`,
            normalizedTitle: `noise ${index}`,
            searchText: `noise ${index}`,
            queueSortKey: `000:${String(index).padStart(4, "0")}`,
            aliases: [],
            origin: "automated_scout",
            priority: "normal",
            lifecycle: "pending",
            disposition: "active",
            retention: "active",
            aggregateVersion: 1,
            assigneePrincipalId: principal.principalId,
            watcherPrincipalIds: [],
            createdByPrincipalId: principal.principalId,
            createdAt: index,
            updatedAt: index,
          })
        )
      return ids
    })
    for (const requestId of requestIds)
      await workspace.mutation(internal.operatorWorkspace.refreshRequest, {
        requestId,
      })

    await expect(
      operator.query(api.operatorWorkspace.list, {
        priority: "high",
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).resolves.toMatchObject({ page: [], isDone: true })
    await expect(
      operator.query(api.operatorWorkspace.list, {
        priority: "high",
        disposition: "expired",
        assigneePrincipalId: principal.principalId,
        deliveryChannel: "industry-forum",
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).resolves.toMatchObject({
      page: [{ request: { humanId: special.humanId } }],
      isDone: true,
    })
    await expect(
      operator.query(api.operatorWorkspace.list, {
        search: special.humanId.toLowerCase(),
        disposition: "expired",
        paginationOpts: { numItems: 1, cursor: null },
      })
    ).resolves.toMatchObject({
      page: [{ request: { humanId: special.humanId } }],
      isDone: true,
    })
    await expect(
      operator.query(api.operatorWorkspace.list, {
        queue: "needs_elie",
        search: special.title,
        disposition: "expired",
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).resolves.toMatchObject({ page: [], isDone: true })
  })

  it("paginates duplicate exact titles and keeps manual or Critical fuzzy matches first", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(identity)
    const principal = await operator.mutation(api.principals.syncCurrent)
    const requestIds = await workspace.run(async (ctx) => {
      const ids: Array<Id<"contentRequests">> = []
      for (let index = 0; index < 25; index += 1)
        ids.push(
          await ctx.db.insert("contentRequests", {
            humanId: `CR-DUPLICATE-${String(index).padStart(3, "0")}`,
            organizationId: identity.org_id,
            title: "Duplicate response heading",
            normalizedTitle: "duplicate response heading",
            searchText: "duplicate response heading mortgage",
            queueSortKey: `000:${String(index).padStart(4, "0")}`,
            aliases: [],
            origin: "manual",
            priority: "critical",
            lifecycle: "pending",
            disposition: "active",
            retention: "active",
            aggregateVersion: 1,
            assigneePrincipalId: principal.principalId,
            watcherPrincipalIds: [],
            createdByPrincipalId: principal.principalId,
            createdAt: index,
            updatedAt: index,
          })
        )
      ids.push(
        await ctx.db.insert("contentRequests", {
          humanId: "CR-AUTOMATED-MORTGAGE",
          organizationId: identity.org_id,
          title: "Automated mortgage answer",
          normalizedTitle: "automated mortgage answer",
          searchText: "automated mortgage answer",
          queueSortKey: "900:automated",
          aliases: [],
          origin: "automated_scout",
          priority: "normal",
          lifecycle: "pending",
          disposition: "active",
          retention: "active",
          aggregateVersion: 1,
          assigneePrincipalId: principal.principalId,
          watcherPrincipalIds: [],
          createdByPrincipalId: principal.principalId,
          createdAt: 100,
          updatedAt: 100,
        })
      )
      for (const [priority, suffix] of [
        ["low", "LOW"],
        ["high", "HIGH"],
      ] as const)
        ids.push(
          await ctx.db.insert("contentRequests", {
            humanId: `CR-AUTOMATED-SERVICING-${suffix}`,
            organizationId: identity.org_id,
            title: `${priority} servicing answer`,
            normalizedTitle: `${priority} servicing answer`,
            searchText: `${priority} servicing answer`,
            queueSortKey: priority === "high" ? "01:01:1" : "01:03:1",
            aliases: [],
            origin: "automated_scout",
            priority,
            lifecycle: "pending",
            disposition: "active",
            retention: "active",
            aggregateVersion: 1,
            assigneePrincipalId: principal.principalId,
            watcherPrincipalIds: [],
            createdByPrincipalId: principal.principalId,
            createdAt: priority === "high" ? 102 : 101,
            updatedAt: priority === "high" ? 102 : 101,
          })
        )
      return ids
    })
    for (const requestId of requestIds)
      await workspace.mutation(internal.operatorWorkspace.refreshRequest, {
        requestId,
      })

    let cursor: string | null = null
    const exactIds: Array<string> = []
    let done = false
    while (!done) {
      const result: {
        page: Array<{ request: { humanId: string } }>
        continueCursor: string
        isDone: boolean
      } = await operator.query(api.operatorWorkspace.list, {
        search: "Duplicate response heading",
        paginationOpts: { numItems: 10, cursor },
      })
      exactIds.push(...result.page.map((item) => item.request.humanId))
      cursor = result.continueCursor
      done = result.isDone
    }
    expect(exactIds).toHaveLength(25)
    expect(new Set(exactIds).size).toBe(25)

    const fuzzy = await operator.query(api.operatorWorkspace.list, {
      search: "mortgage",
      paginationOpts: { numItems: 1, cursor: null },
    })
    expect(fuzzy.page[0]?.request.origin).toBe("manual")
    expect(fuzzy.isDone).toBe(false)

    const automated = await operator.query(api.operatorWorkspace.list, {
      search: "servicing",
      origin: "automated_scout",
      paginationOpts: { numItems: 1, cursor: null },
    })
    expect(automated.page[0]?.request.priority).toBe("high")
    expect(automated.isDone).toBe(false)
  })
})
