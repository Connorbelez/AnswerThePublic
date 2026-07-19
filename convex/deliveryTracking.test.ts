// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = (subject: string, role: string) => ({
  subject,
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role,
  jti: `${subject}-session`,
})

describe("delivery targets and response receipts", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("archives legacy overflow targets, clears attention, and protects the original", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("overflow-operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Remediate legacy delivery targets",
      origin: "manual",
      correlationId: "overflow-create-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const [original] = await operator.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    const overflowTargetId = await workspace.run(async (ctx) => {
      const principal = await ctx.db.query("principals").first()
      const storedRequest = await ctx.db.get(request.requestId)
      if (!principal || !storedRequest)
        throw new Error("Missing overflow fixture")
      let lastTargetId = original.targetId
      for (let index = 0; index < 50; index += 1)
        lastTargetId = await ctx.db.insert("deliveryTargets", {
          organizationId: storedRequest.organizationId,
          requestId: storedRequest._id,
          deliverableId: primary.deliverableId,
          channel: "legacy",
          destinationLabel: `Legacy destination ${index}`,
          isOriginal: false,
          isRequired: false,
          retention: "active",
          createdByPrincipalId: principal._id,
          createdAt: index,
          updatedAt: index,
        })
      return lastTargetId
    })
    await workspace.mutation(internal.operatorWorkspace.refreshRequest, {
      requestId: request.requestId,
    })
    await expect(
      operator.query(api.operatorWorkspace.list, {
        queue: "attention_required",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).resolves.toMatchObject({
      page: [
        expect.objectContaining({
          attentionReasons: expect.arrayContaining([
            "Legacy delivery target count requires remediation",
          ]),
        }),
      ],
    })
    await expect(
      operator.mutation(api.deliveryTracking.setRetention, {
        targetId: original.targetId,
        retention: "archived",
        correlationId: "archive-original-target",
      })
    ).rejects.toMatchObject({ data: { code: "ORIGINAL_TARGET_REQUIRED" } })

    const archived = await operator.mutation(
      api.deliveryTracking.setRetention,
      {
        targetId: overflowTargetId,
        retention: "archived",
        correlationId: "archive-overflow-target",
      }
    )
    expect(archived.retention).toBe("archived")
    await workspace.run(async (ctx) => {
      const principal = await ctx.db.query("principals").first()
      const storedRequest = await ctx.db.get(request.requestId)
      if (!principal || !storedRequest)
        throw new Error("Missing archived pagination fixture")
      for (let index = 0; index < 55; index += 1)
        await ctx.db.insert("deliveryTargets", {
          organizationId: storedRequest.organizationId,
          requestId: storedRequest._id,
          deliverableId: primary.deliverableId,
          channel: "archive",
          destinationLabel: `Archived destination ${index}`,
          isOriginal: false,
          isRequired: false,
          retention: "archived",
          createdByPrincipalId: principal._id,
          createdAt: 1_000 + index,
          updatedAt: 1_000 + index,
        })
    })
    const firstArchivedPage = await operator.query(
      api.deliveryTracking.listArchived,
      {
        humanId: request.humanId,
        paginationOpts: { numItems: 50, cursor: null },
      }
    )
    expect(firstArchivedPage).toMatchObject({
      page: expect.any(Array),
      isDone: false,
    })
    expect(firstArchivedPage.page).toHaveLength(50)
    const secondArchivedPage = await operator.query(
      api.deliveryTracking.listArchived,
      {
        humanId: request.humanId,
        paginationOpts: {
          numItems: 50,
          cursor: firstArchivedPage.continueCursor,
        },
      }
    )
    expect(secondArchivedPage.page).toHaveLength(6)
    expect(secondArchivedPage.isDone).toBe(true)
    await expect(
      operator.mutation(api.deliveryTracking.setRetention, {
        targetId: overflowTargetId,
        retention: "archived",
        correlationId: "archive-overflow-target",
      })
    ).resolves.toMatchObject({ retention: "archived" })
    const projection = await workspace.run((ctx) =>
      ctx.db
        .query("operatorWorkspaceItems")
        .withIndex("by_request", (index) =>
          index.eq("requestId", request.requestId)
        )
        .unique()
    )
    expect(projection?.attentionReasons).not.toContain(
      "Legacy delivery target count requires remediation"
    )
    await expect(
      operator.mutation(api.deliveryTracking.setRetention, {
        targetId: overflowTargetId,
        retention: "active",
        correlationId: "restore-overflow-target",
      })
    ).rejects.toMatchObject({
      data: { code: "REQUEST_CHILD_LIMIT_REACHED" },
    })
    const audit = await operator.query(api.contentRequests.listAuditEvents, {
      humanId: request.humanId,
    })
    expect(audit.at(-1)?.operation).toBe("delivery_target.archived")
  })

  it("computes Responded from required receipts and preserves reopen history", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Answer a journalist request",
      origin: "manual",
      source: {
        url: "https://example.com/request",
        name: "Original journalist request",
        channel: "journalist",
      },
      correlationId: "create-delivery-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const ready = await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Ready response",
      correlationId: "ready-delivery-version",
    })
    const [original] = await operator.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    expect(original).toMatchObject({ isOriginal: true, isRequired: true })
    const optional = await operator.mutation(
      api.deliveryTracking.createTarget,
      {
        humanId: request.humanId,
        deliverableId: primary.deliverableId,
        channel: "linkedin",
        destinationLabel: "LinkedIn",
        correlationId: "create-optional-target",
      }
    )
    expect(optional.isRequired).toBe(false)

    const originalConfirmation = {
      targetId: original.targetId,
      versionId: ready.promotedVersionId!,
      note: "Posted by Connor",
      correlationId: "confirm-original",
    }
    await operator.mutation(api.deliveryTracking.confirm, originalConfirmation)
    await expect(
      operator.mutation(api.deliveryTracking.confirm, originalConfirmation)
    ).resolves.toMatchObject({ currentReceiptId: expect.any(String) })
    expect(
      (
        await operator.query(api.contentRequests.getByHumanId, {
          humanId: request.humanId,
        })
      )?.lifecycle
    ).toBe("responded")

    const requiredAtCreation = await operator.mutation(
      api.deliveryTracking.createTarget,
      {
        humanId: request.humanId,
        deliverableId: primary.deliverableId,
        channel: "newsletter",
        destinationLabel: "Member newsletter",
        isRequired: true,
        correlationId: "create-required-target",
      }
    )
    expect(
      (
        await operator.query(api.contentRequests.getByHumanId, {
          humanId: request.humanId,
        })
      )?.lifecycle
    ).toBe("ready_to_respond")
    await operator.mutation(api.deliveryTracking.confirm, {
      targetId: requiredAtCreation.targetId,
      versionId: ready.promotedVersionId!,
      correlationId: "confirm-required-target",
    })

    await operator.mutation(api.deliveryTracking.setRequired, {
      targetId: optional.targetId,
      isRequired: true,
      correlationId: "require-linkedin",
    })
    expect(
      (
        await operator.query(api.contentRequests.getByHumanId, {
          humanId: request.humanId,
        })
      )?.lifecycle
    ).toBe("ready_to_respond")
    await operator.mutation(api.deliveryTracking.confirm, {
      targetId: optional.targetId,
      versionId: ready.promotedVersionId!,
      correlationId: "confirm-linkedin",
    })
    expect(
      (
        await operator.query(api.contentRequests.getByHumanId, {
          humanId: request.humanId,
        })
      )?.lifecycle
    ).toBe("responded")

    const reopenedInput = {
      targetId: optional.targetId,
      correlationId: "reopen-linkedin",
    }
    const reopened = await operator.mutation(
      api.deliveryTracking.reopen,
      reopenedInput
    )
    expect(reopened).toMatchObject({ currentReceiptId: null })
    expect(reopened.receiptHistory).toHaveLength(1)
    await expect(
      operator.mutation(api.deliveryTracking.reopen, reopenedInput)
    ).resolves.toMatchObject({ currentReceiptId: null })
    const reopenNotifications = (
      await workspace.run((ctx) => ctx.db.query("notifications").collect())
    ).filter((notification) => notification.type === "delivery_reopened")
    expect(reopenNotifications).toHaveLength(1)
    expect(
      (
        await operator.query(api.contentRequests.getByHumanId, {
          humanId: request.humanId,
        })
      )?.lifecycle
    ).toBe("ready_to_respond")
    const reconfirmed = await operator.mutation(api.deliveryTracking.confirm, {
      targetId: optional.targetId,
      versionId: ready.promotedVersionId!,
      correlationId: "reconfirm-linkedin",
    })
    expect(reconfirmed.receiptHistory).toHaveLength(2)
    const evidence = await workspace.run(async (ctx) => ({
      receipts: await ctx.db.query("deliveryReceipts").collect(),
      events: await ctx.db.query("deliveryReceiptEvents").collect(),
    }))
    expect(evidence.receipts).toHaveLength(4)
    expect(evidence.events.map((event) => event.event)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
      "reopened",
      "confirmed",
    ])
  })

  it("replays successful operations after archival while rejecting fresh archived mutations", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("archive-operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Archive-safe delivery",
      origin: "manual",
      correlationId: "archive-create-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const createInput = {
      humanId: request.humanId,
      deliverableId: primary.deliverableId,
      channel: "linkedin",
      destinationLabel: "LinkedIn",
      correlationId: "archive-create-target",
    }
    const created = await operator.mutation(
      api.deliveryTracking.createTarget,
      createInput
    )
    await workspace.run((ctx) =>
      ctx.db.patch(primary.deliverableId, { retention: "archived" })
    )
    await expect(
      operator.mutation(api.deliveryTracking.createTarget, createInput)
    ).resolves.toMatchObject({ targetId: created.targetId })
    await expect(
      operator.mutation(api.deliveryTracking.createTarget, {
        ...createInput,
        correlationId: "fresh-archived-create",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
    await workspace.run((ctx) =>
      ctx.db.patch(primary.deliverableId, { retention: "active" })
    )

    const requiredInput = {
      targetId: created.targetId,
      isRequired: true,
      correlationId: "archive-set-required",
    }
    await operator.mutation(api.deliveryTracking.setRequired, requiredInput)
    await workspace.run((ctx) =>
      ctx.db.patch(created.targetId, { retention: "archived" })
    )
    await expect(
      operator.mutation(api.deliveryTracking.setRequired, requiredInput)
    ).resolves.toMatchObject({ targetId: created.targetId })
    await expect(
      operator.mutation(api.deliveryTracking.setRequired, {
        ...requiredInput,
        correlationId: "fresh-archived-required",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
  })

  it("repairs missing and archived original targets without disturbing secondary targets", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("migration-operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Repair delivery target",
      origin: "manual",
      source: {
        channel: "A",
        url: "https://www.reddit.com/r/MortgagesCanada/comments/repair",
        name: "Legacy scout source",
      },
      correlationId: "repair-create-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const secondary = await operator.mutation(
      api.deliveryTracking.createTarget,
      {
        humanId: request.humanId,
        deliverableId: primary.deliverableId,
        channel: "linkedin",
        destinationLabel: "LinkedIn",
        correlationId: "repair-secondary",
      }
    )
    const [original] = await operator.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    await workspace.run((ctx) =>
      ctx.db.patch(original.targetId, { retention: "archived" })
    )
    await workspace.mutation(
      internal.migrations.backfillOriginalDeliveryTargets,
      {}
    )
    let repaired = await operator.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    expect(repaired.filter((target) => target.isOriginal)).toHaveLength(1)
    expect(repaired.find((target) => target.isOriginal)).toMatchObject({
      targetId: original.targetId,
      isRequired: true,
      channel: "reddit",
    })
    expect(
      repaired.some((target) => target.targetId === secondary.targetId)
    ).toBe(true)

    const ready = await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Delivered migration response",
      correlationId: "repair-version",
    })
    await operator.mutation(api.deliveryTracking.confirm, {
      targetId: original.targetId,
      versionId: ready.promotedVersionId!,
      correlationId: "repair-confirm-original",
    })
    const duplicateId = await workspace.run(async (ctx) => {
      const principal = await ctx.db.query("principals").first()
      const rawRequest = await ctx.db.get(request.requestId)
      if (!principal || !rawRequest)
        throw new Error("Missing migration fixture")
      return ctx.db.insert("deliveryTargets", {
        organizationId: rawRequest.organizationId,
        requestId: rawRequest._id,
        deliverableId: primary.deliverableId,
        channel: "A",
        destinationLabel: "Duplicate original",
        isOriginal: true,
        isRequired: true,
        retention: "active",
        createdByPrincipalId: principal._id,
        createdAt: 0,
        updatedAt: 0,
      })
    })
    await workspace.mutation(
      internal.migrations.backfillOriginalDeliveryTargets,
      {}
    )
    repaired = await operator.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    expect(repaired.find((target) => target.isOriginal)).toMatchObject({
      targetId: original.targetId,
      currentReceiptId: expect.any(String),
    })
    const archived = await operator.query(api.deliveryTracking.listArchived, {
      humanId: request.humanId,
      paginationOpts: { numItems: 50, cursor: null },
    })
    expect(
      archived.page.find((target) => target.targetId === duplicateId)
    ).toMatchObject({ retention: "archived" })

    await workspace.run((ctx) =>
      ctx.db.patch(original.targetId, {
        isOriginal: false,
        isRequired: false,
        retention: "active",
      })
    )
    await workspace.mutation(
      internal.migrations.backfillOriginalDeliveryTargets,
      {}
    )
    repaired = await operator.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    expect(repaired.filter((target) => target.isOriginal)).toHaveLength(1)
    expect(
      repaired.filter(
        (target) => !target.isOriginal && target.retention === "active"
      )
    ).toHaveLength(2)
  })

  it("locks primary reassignment after any historical delivery receipt", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("primary-lock-operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Primary delivery lock",
      origin: "manual",
      correlationId: "primary-lock-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const derivative = await operator.mutation(
      api.deliverables.createDerivative,
      {
        humanId: request.humanId,
        kind: "linkedin_post",
        name: "LinkedIn post",
        body: "Posted derivative",
        correlationId: "primary-lock-derivative",
      }
    )
    await operator.mutation(api.deliverables.promote, {
      deliverableId: derivative.deliverableId,
      versionId: derivative.currentCandidateVersionId!,
      expectedPromotedVersionId: null,
      correlationId: "primary-lock-promote",
    })
    const target = await operator.mutation(api.deliveryTracking.createTarget, {
      humanId: request.humanId,
      deliverableId: derivative.deliverableId,
      channel: "linkedin",
      destinationLabel: "LinkedIn",
      correlationId: "primary-lock-target",
    })
    await operator.mutation(api.deliveryTracking.confirm, {
      targetId: target.targetId,
      versionId: derivative.currentCandidateVersionId!,
      correlationId: "primary-lock-confirm",
    })
    await operator.mutation(api.deliveryTracking.reopen, {
      targetId: target.targetId,
      correlationId: "primary-lock-reopen",
    })
    await expect(
      operator.mutation(api.deliverables.setPrimary, {
        humanId: request.humanId,
        deliverableId: derivative.deliverableId,
        expectedPrimaryDeliverableId: primary.deliverableId,
        correlationId: "primary-lock-change",
      })
    ).rejects.toMatchObject({
      data: { code: "DELIVERY_TARGET_ALREADY_CONFIRMED" },
    })
  })

  it("requires backend-verified integration success for agent confirmation", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("operator", "operator-editor")
    )
    const agent = workspace.withIdentity(identity("agent", "agent-editor"))
    await operator.mutation(api.principals.syncCurrent)
    await agent.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Agent delivery",
      origin: "manual",
      correlationId: "create-agent-delivery",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const ready = await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Agent-posted response",
      correlationId: "agent-delivery-version",
    })
    const [target] = await agent.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    await expect(
      agent.mutation(api.deliveryTracking.confirm, {
        targetId: target.targetId,
        versionId: ready.promotedVersionId!,
        correlationId: "unverified-agent-confirmation",
      })
    ).rejects.toMatchObject({ data: { code: "HUMAN_CONFIRMATION_REQUIRED" } })
    const integrationSuccessId = await workspace.mutation(
      internal.deliveryTracking.recordIntegrationSuccess,
      {
        organizationId: "org_fairlend",
        targetId: target.targetId,
        versionId: ready.promotedVersionId!,
        provider: "reddit",
        integrationIdentity: "fairlend-official",
        externalReceiptId: "reddit-comment-123",
        succeededAt: 123,
      }
    )
    await workspace.run((ctx) =>
      ctx.db.patch(target.targetId, { retention: "archived" })
    )
    await expect(
      workspace.mutation(internal.deliveryTracking.recordIntegrationSuccess, {
        organizationId: "org_fairlend",
        targetId: target.targetId,
        versionId: ready.promotedVersionId!,
        provider: "reddit",
        integrationIdentity: "fairlend-official",
        externalReceiptId: "reddit-comment-123",
        succeededAt: 123,
      })
    ).resolves.toBe(integrationSuccessId)
    await expect(
      workspace.mutation(internal.deliveryTracking.recordIntegrationSuccess, {
        organizationId: "org_fairlend",
        targetId: target.targetId,
        versionId: ready.promotedVersionId!,
        provider: "reddit",
        integrationIdentity: "fairlend-official",
        externalReceiptId: "reddit-comment-new",
        succeededAt: 124,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
    await workspace.run((ctx) =>
      ctx.db.patch(target.targetId, { retention: "active" })
    )
    const confirmed = await agent.mutation(api.deliveryTracking.confirm, {
      targetId: target.targetId,
      versionId: ready.promotedVersionId!,
      integrationSuccessId,
      correlationId: "verified-agent-confirmation",
    })
    expect(confirmed.currentReceipt).toMatchObject({
      confirmationMethod: "integration",
      integrationIdentity: "fairlend-official",
      externalReceiptId: "reddit-comment-123",
      respondedAt: 123,
    })
  })

  it("replays confirm and reopen outcomes after archival but blocks new operations", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("receipt-archive-operator", "operator-editor")
    )
    await operator.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Receipt replay",
      origin: "manual",
      correlationId: "receipt-replay-request",
    })
    const [primary] = await operator.query(api.deliverables.list, {
      humanId: request.humanId,
    })
    const ready = await operator.mutation(api.deliverables.createVersion, {
      deliverableId: primary.deliverableId,
      body: "Posted response",
      correlationId: "receipt-replay-version",
    })
    const [target] = await operator.query(api.deliveryTracking.list, {
      humanId: request.humanId,
    })
    const confirmInput = {
      targetId: target.targetId,
      versionId: ready.promotedVersionId!,
      correlationId: "receipt-replay-confirm",
    }
    await operator.mutation(api.deliveryTracking.confirm, confirmInput)
    const reopenInput = {
      targetId: target.targetId,
      correlationId: "receipt-replay-reopen",
    }
    await operator.mutation(api.deliveryTracking.reopen, reopenInput)
    await workspace.run((ctx) =>
      ctx.db.patch(target.targetId, { retention: "archived" })
    )
    await expect(
      operator.mutation(api.deliveryTracking.confirm, confirmInput)
    ).resolves.toMatchObject({ targetId: target.targetId })
    await expect(
      operator.mutation(api.deliveryTracking.reopen, reopenInput)
    ).resolves.toMatchObject({ targetId: target.targetId })
    await expect(
      operator.mutation(api.deliveryTracking.confirm, {
        ...confirmInput,
        correlationId: "fresh-archived-confirm",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
    await expect(
      operator.mutation(api.deliveryTracking.reopen, {
        ...reopenInput,
        correlationId: "fresh-archived-reopen",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
  })
})
